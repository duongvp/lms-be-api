import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { backfillMissingCalendarTeachingUsers } from './livestream.service';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const CHECK_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

export const calendarTeachingUserSyncWindow = (now = new Date()) => {
  const start = getVietnamWallClockDate(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
};

const vietnamTimeParts = (now: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value])
);

export const runCalendarTeachingUserSync = async (now = new Date()) => {
  const { start, end } = calendarTeachingUserSyncWindow(now);
  await prisma.$executeRaw`
    UPDATE calendar_teaching_user_sync_runs
    SET status='interrupted', active_key=NULL,
      errors_json='[{"calendar_id":0,"message":"Tiến trình backend bị ngắt trước khi hoàn tất"}]',
      finished_at=NOW(3)
    WHERE active_key='global' AND started_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)
  `;

  try {
    await prisma.$executeRaw`
      INSERT INTO calendar_teaching_user_sync_runs (active_key, window_start, window_end)
      VALUES ('global', ${start}, ${end})
    `;
  } catch (error: any) {
    const duplicate = String(error?.meta?.code) === '1062'
      || String(error?.message || '').includes('Duplicate entry');
    if (duplicate) return { started: false, message: 'Một lượt quét user nhân sự đang chạy' };
    throw error;
  }

  const [activeRun] = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM calendar_teaching_user_sync_runs WHERE active_key='global' LIMIT 1
  `;
  const runId = activeRun.id;

  try {
    const calendars = await prisma.calendar.findMany({
      where: {
        start_time: { gte: start, lt: end },
        OR: [
          { lesson_status: null },
          { lesson_status: { not: 1 } },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const result = calendars.length === 0
      ? { scanned: 0, created: 0, updated: 0, failed: 0, errors: [] }
      : await backfillMissingCalendarTeachingUsers(
        calendars.map((calendar) => Number(calendar.id))
      );
    const status = result.failed > 0 ? 'completed_with_errors' : 'completed';
    const errorsJson = result.errors.length ? JSON.stringify(result.errors) : null;
    await prisma.$executeRaw`
      UPDATE calendar_teaching_user_sync_runs
      SET status=${status}, active_key=NULL, scanned=${result.scanned}, created=${result.created},
        updated=${result.updated}, failed=${result.failed}, errors_json=${errorsJson}, finished_at=NOW(3)
      WHERE id=${runId}
    `;
    return { started: true, ...result, start, end };
  } catch (error: any) {
    const message = error?.message || 'Không thể quét user nhân sự';
    const errorsJson = JSON.stringify([{ calendar_id: 0, message }]);
    await prisma.$executeRaw`
      UPDATE calendar_teaching_user_sync_runs
      SET status='failed', active_key=NULL, errors_json=${errorsJson}, finished_at=NOW(3)
      WHERE id=${runId}
    `.catch(() => undefined);
    throw error;
  }
};

export const getCalendarTeachingUserSyncStatus = async () => {
  let latest: any = null;
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, status, window_start, window_end, scanned, created, updated, failed,
        errors_json, started_at, finished_at
      FROM calendar_teaching_user_sync_runs
      ORDER BY id DESC LIMIT 1
    `;
    latest = rows[0] || null;
  } catch (error: any) {
    const missingTable = String(error?.meta?.code) === '1146'
      || String(error?.message || '').includes("doesn't exist");
    if (!missingTable) throw error;
  }
  let errors: Array<{ calendar_id: number; message: string }> = [];
  if (latest?.errors_json) {
    try {
      const parsed = JSON.parse(String(latest.errors_json));
      if (Array.isArray(parsed)) errors = parsed;
    } catch {
      errors = [];
    }
  }
  return {
    enabled: process.env.CALENDAR_TEACHING_USER_CRON_ENABLED?.toLowerCase() !== 'false',
    hour: 3,
    minute: 0,
    timeZone: TIMEZONE,
    windowDays: 7,
    latest: latest ? {
      id: String(latest.id),
      status: latest.status,
      windowStart: latest.window_start,
      windowEnd: latest.window_end,
      scanned: Number(latest.scanned),
      created: Number(latest.created),
      updated: Number(latest.updated),
      failed: Number(latest.failed),
      errors,
      startedAt: latest.started_at,
      finishedAt: latest.finished_at,
    } : null,
  };
};

export const createCalendarTeachingUserSyncCheck = (
  sync: (now: Date) => Promise<unknown> = runCalendarTeachingUserSync,
  now: () => Date = () => new Date(),
  onSuccess: (result: unknown) => void = () => undefined,
  onError: (error: unknown) => void = () => undefined
) => {
  let lastDate = '';
  let running = false;

  return async () => {
    const current = now();
    const parts = vietnamTimeParts(current);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.hour !== '03' || parts.minute !== '00' || lastDate === date || running) return;

    running = true;
    try {
      const result = await sync(current);
      lastDate = date;
      onSuccess(result);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
};

export const startCalendarTeachingUserSyncWorker = () => {
  if (timer || process.env.CALENDAR_TEACHING_USER_CRON_ENABLED?.toLowerCase() === 'false') {
    return () => undefined;
  }

  const check = createCalendarTeachingUserSyncCheck(
    runCalendarTeachingUserSync,
    () => new Date(),
    (result) => logger.info('Calendar teaching user sync completed', result),
    (error) => logger.error(
      'Calendar teaching user sync failed:',
      error instanceof Error ? error.message : error
    )
  );
  void check();
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  timer.unref();
  logger.info(`Calendar teaching user sync cron enabled at 03:00 (${TIMEZONE})`);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
};
