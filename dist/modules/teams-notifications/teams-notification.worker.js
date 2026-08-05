"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTeamsNotificationWorker = exports.processTeamsNotificationOutbox = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const logger_1 = require("../../utils/logger");
const teams_notification_card_1 = require("./teams-notification.card");
const teams_notification_config_1 = require("./teams-notification.config");
let running = false;
let timer = null;
const parsePayload = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const sendWebhook = async (destination, payload, timeoutMs) => {
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
            body: JSON.stringify((0, teams_notification_card_1.buildTeamsAdaptiveCard)(payload)),
            signal: controller.signal,
        });
        if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            throw new Error(`Teams webhook ${response.status}: ${responseText.slice(0, 500)}`);
        }
    }
    finally {
        clearTimeout(timeout);
    }
};
const claimRow = async (id) => {
    const claimed = await prisma_1.default.$executeRaw `
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
const processTeamsNotificationOutbox = async () => {
    if (running || !(0, teams_notification_config_1.isTeamsNotificationEnabled)())
        return;
    const destinations = (0, teams_notification_config_1.getTeamsWebhookDestinations)();
    if (!destinations.length)
        return;
    const destinationByName = new Map(destinations.map((item) => [item.name, item]));
    const config = (0, teams_notification_config_1.getTeamsWorkerConfig)();
    running = true;
    try {
        const rows = await prisma_1.default.$queryRaw `
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
            if (!await claimRow(row.id))
                continue;
            const attempts = Number(row.attempts) + 1;
            try {
                const destination = destinationByName.get(row.destination);
                if (!destination) {
                    throw new Error(`Không còn cấu hình Teams destination '${row.destination}'`);
                }
                await sendWebhook(destination, parsePayload(row.payload), config.requestTimeoutMs);
                await prisma_1.default.$executeRaw `
          UPDATE teams_notification_outbox
          SET status = 1, attempts = ${attempts}, sent_at = NOW(3),
              locked_at = NULL, last_error = NULL, updated_at = NOW(3)
          WHERE id = ${row.id} AND status = 3
        `;
            }
            catch (error) {
                const finalFailure = attempts >= config.maxAttempts;
                const retryDelaySeconds = Math.min(300, 5 * (2 ** Math.max(0, attempts - 1)));
                const nextAttemptAt = new Date(Date.now() + retryDelaySeconds * 1000);
                const message = String(error?.message || error).slice(0, 2_000);
                await prisma_1.default.$executeRaw `
          UPDATE teams_notification_outbox
          SET status = ${finalFailure ? 4 : 2}, attempts = ${attempts},
              next_attempt_at = ${nextAttemptAt}, locked_at = NULL,
              last_error = ${message}, updated_at = NOW(3)
          WHERE id = ${row.id} AND status = 3
        `;
                logger_1.logger.error(`Teams notification ${row.id.toString()} failed: ${message}`);
            }
        }
    }
    catch (error) {
        // Migration chưa chạy hoặc DB tạm thời lỗi không được làm dừng API.
        logger_1.logger.error('Teams notification worker error:', error?.message || error);
    }
    finally {
        running = false;
    }
};
exports.processTeamsNotificationOutbox = processTeamsNotificationOutbox;
const startTeamsNotificationWorker = () => {
    if (timer || !(0, teams_notification_config_1.isTeamsNotificationEnabled)())
        return () => undefined;
    let destinations;
    try {
        destinations = (0, teams_notification_config_1.getTeamsWebhookDestinations)();
    }
    catch (error) {
        logger_1.logger.error('Teams notification config error:', error.message);
        return () => undefined;
    }
    if (!destinations.length) {
        logger_1.logger.info('Teams notifications are disabled: no webhook destinations configured');
        return () => undefined;
    }
    const { pollIntervalMs } = (0, teams_notification_config_1.getTeamsWorkerConfig)();
    void (0, exports.processTeamsNotificationOutbox)();
    timer = setInterval(() => void (0, exports.processTeamsNotificationOutbox)(), pollIntervalMs);
    timer.unref();
    logger_1.logger.info(`Teams notification worker started for ${destinations.length} destination(s)`);
    return () => {
        if (timer)
            clearInterval(timer);
        timer = null;
    };
};
exports.startTeamsNotificationWorker = startTeamsNotificationWorker;
