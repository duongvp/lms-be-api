import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { buildTeamsAdaptiveCard } from './teams-notification.card';
import {
  getTeamsWebhookDestinations,
  getTeamsWorkerConfig,
  isTeamsNotificationEnabled,
} from './teams-notification.config';
import { CalendarNotificationPayload, TeamsWebhookDestination } from './teams-notification.types';

type OutboxRow = {
  id: bigint;
  destination: string;
  payload: CalendarNotificationPayload | string;
  attempts: number;
};

let running = false;
let timer: NodeJS.Timeout | null = null;

const parsePayload = (value: OutboxRow['payload']): CalendarNotificationPayload => (
  typeof value === 'string' ? JSON.parse(value) : value
);

const sendWebhook = async (
  destination: TeamsWebhookDestination,
  payload: CalendarNotificationPayload,
  timeoutMs: number
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = destination.token || process.env.TEAMS_WEBHOOK_BEARER_TOKEN?.trim();
    const response = await fetch(destination.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(buildTeamsAdaptiveCard(payload)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(`Teams webhook ${response.status}: ${responseText.slice(0, 500)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
};

const claimRow = async (id: bigint) => {
  const claimed = await prisma.$executeRaw`
    UPDATE teams_notification_outbox
    SET status = 3, locked_at = NOW(3), updated_at = NOW(3)
    WHERE id = ${id}
      AND (
        status IN (0, 2)
        OR (status = 3 AND locked_at < DATE_SUB(NOW(3), INTERVAL 5 MINUTE))
      )
  `;
  return Number(claimed) === 1;
};

export const processTeamsNotificationOutbox = async () => {
  if (running || !isTeamsNotificationEnabled()) return;
  const destinations = getTeamsWebhookDestinations();
  if (!destinations.length) return;
  const destinationByName = new Map(destinations.map((item) => [item.name, item]));
  const config = getTeamsWorkerConfig();
  running = true;

  try {
    const rows = await prisma.$queryRaw<OutboxRow[]>`
      SELECT id, destination, payload, attempts
      FROM teams_notification_outbox
      WHERE (
        (status IN (0, 2) AND next_attempt_at <= NOW(3))
        OR (status = 3 AND locked_at < DATE_SUB(NOW(3), INTERVAL 5 MINUTE))
      )
      ORDER BY id ASC
      LIMIT ${config.batchSize}
    `;

    for (const row of rows) {
      if (!await claimRow(row.id)) continue;
      const attempts = Number(row.attempts) + 1;
      try {
        const destination = destinationByName.get(row.destination);
        if (!destination) {
          throw new Error(`Không còn cấu hình Teams destination '${row.destination}'`);
        }
        await sendWebhook(destination, parsePayload(row.payload), config.requestTimeoutMs);
        await prisma.$executeRaw`
          UPDATE teams_notification_outbox
          SET status = 1, attempts = ${attempts}, sent_at = NOW(3),
              locked_at = NULL, last_error = NULL, updated_at = NOW(3)
          WHERE id = ${row.id} AND status = 3
        `;
      } catch (error: any) {
        const finalFailure = attempts >= config.maxAttempts;
        const retryDelaySeconds = Math.min(300, 5 * (2 ** Math.max(0, attempts - 1)));
        const nextAttemptAt = new Date(Date.now() + retryDelaySeconds * 1000);
        const message = String(error?.message || error).slice(0, 2_000);
        await prisma.$executeRaw`
          UPDATE teams_notification_outbox
          SET status = ${finalFailure ? 4 : 2}, attempts = ${attempts},
              next_attempt_at = ${nextAttemptAt}, locked_at = NULL,
              last_error = ${message}, updated_at = NOW(3)
          WHERE id = ${row.id} AND status = 3
        `;
        logger.error(`Teams notification ${row.id.toString()} failed: ${message}`);
      }
    }
  } catch (error: any) {
    // Migration chưa chạy hoặc DB tạm thời lỗi không được làm dừng API.
    logger.error('Teams notification worker error:', error?.message || error);
  } finally {
    running = false;
  }
};

export const startTeamsNotificationWorker = () => {
  if (timer || !isTeamsNotificationEnabled()) return () => undefined;
  let destinations: TeamsWebhookDestination[];
  try {
    destinations = getTeamsWebhookDestinations();
  } catch (error: any) {
    logger.error('Teams notification config error:', error.message);
    return () => undefined;
  }
  if (!destinations.length) {
    logger.info('Teams notifications are disabled: no webhook destinations configured');
    return () => undefined;
  }

  const { pollIntervalMs } = getTeamsWorkerConfig();
  void processTeamsNotificationOutbox();
  timer = setInterval(() => void processTeamsNotificationOutbox(), pollIntervalMs);
  timer.unref();
  logger.info(`Teams notification worker started for ${destinations.length} destination(s)`);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
};
