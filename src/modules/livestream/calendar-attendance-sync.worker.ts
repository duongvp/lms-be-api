import prisma from '../../lib/prisma';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { logger } from '../../utils/logger';
import { syncCalendarAttendance } from './livestream.service';

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const CHECK_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

export const calendarAttendanceSyncWindow = (now = new Date()) => {
  const end = getVietnamWallClockDate(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
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

export const runCalendarAttendanceSync = async (
  now = new Date(),
  client: typeof prisma = prisma,
  sync: typeof syncCalendarAttendance = syncCalendarAttendance
) => {
  const { start, end } = calendarAttendanceSyncWindow(now);
  await client.$executeRaw`
    UPDATE calendar_attendance_sync_runs
    SET status='interrupted', active_key=NULL, finished_at=NOW(3), heartbeat_at=NOW(3),
      errors_json='[{"calendar_id":0,"message":"Tiến trình backend bị ngắt trước khi hoàn tất"}]'
    WHERE active_key='global' AND heartbeat_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)
  `;

  try {
    await client.$executeRaw`
      INSERT INTO calendar_attendance_sync_runs (active_key, window_start, window_end)
      VALUES ('global', ${start}, ${end})
    `;
  } catch (error: any) {
    const duplicate = String(error?.meta?.code) === '1062'
      || String(error?.message || '').includes('Duplicate entry');
    if (duplicate) return { started: false, message: 'Một lượt đồng bộ trạng thái học đang chạy' };
    throw error;
  }

  const [activeRun] = await client.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM calendar_attendance_sync_runs WHERE active_key='global' LIMIT 1
  `;
  const runId = activeRun.id;
  let calendarsTotal = 0;
  let calendarsProcessed = 0;
  let studentsUpdated = 0;
  let hocmaiUpdated = 0;
  const errors: Array<{ calendar_id: number; message: string }> = [];

  try {
    // The database stores Vietnam business time as UTC wall-clock values.
    const calendars = await client.calendar.findMany({
      where: {
        start_time: { gte: start, lt: end },
        end_time: { lte: getVietnamWallClockDate(now) },
        OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    calendarsTotal = calendars.length;
    await client.$executeRaw`
      UPDATE calendar_attendance_sync_runs
      SET calendars_total=${calendarsTotal}, heartbeat_at=NOW(3)
      WHERE id=${runId}
    `;

    for (const calendar of calendars) {
      try {
        // Isolate a failed calendar so the remaining lessons are still synced.
        const result = await sync([calendar.id]);
        calendarsProcessed += result.processed;
        studentsUpdated += result.updated;
        hocmaiUpdated += result.details[0]?.hocmai_updated ?? 0;
      } catch (error: any) {
        errors.push({ calendar_id: calendar.id, message: error?.message || 'Lỗi đồng bộ không xác định' });
      }
      const errorsJson = errors.length ? JSON.stringify(errors) : null;
      await client.$executeRaw`
        UPDATE calendar_attendance_sync_runs
        SET calendars_processed=${calendarsProcessed}, students_updated=${studentsUpdated},
          hocmai_updated=${hocmaiUpdated}, calendars_failed=${errors.length},
          errors_json=${errorsJson}, heartbeat_at=NOW(3)
        WHERE id=${runId}
      `;
    }

    const status = errors.length ? 'completed_with_errors' : 'completed';
    await client.$executeRaw`
      UPDATE calendar_attendance_sync_runs
      SET status=${status}, active_key=NULL, heartbeat_at=NOW(3), finished_at=NOW(3)
      WHERE id=${runId}
    `;
    return {
      started: true, status, start, end, calendars: calendarsTotal,
      processed: calendarsProcessed, updated: studentsUpdated, hocmaiUpdated,
      failed: errors.length, errors,
    };
  } catch (error: any) {
    const message = error?.message || 'Không thể đồng bộ trạng thái học';
    const errorsJson = JSON.stringify([...errors, { calendar_id: 0, message }]);
    await client.$executeRaw`
      UPDATE calendar_attendance_sync_runs
      SET status='failed', active_key=NULL, calendars_total=${calendarsTotal},
        calendars_processed=${calendarsProcessed}, students_updated=${studentsUpdated},
        hocmai_updated=${hocmaiUpdated}, calendars_failed=${errors.length + 1},
        errors_json=${errorsJson}, heartbeat_at=NOW(3), finished_at=NOW(3)
      WHERE id=${runId}
    `.catch(() => undefined);
    throw error;
  }
};

export const getCalendarAttendanceSyncStatus = async (client: typeof prisma = prisma) => {
  let available = true;
  let rows: Array<{
    id: bigint; status: string; window_start: Date; window_end: Date;
    calendars_total: number; calendars_processed: number; students_updated: number;
    hocmai_updated: number; calendars_failed: number; errors_json: string | null;
    heartbeat_at: Date; started_at: Date; finished_at: Date | null;
  }> = [];
  try {
    rows = await client.$queryRaw`
      SELECT id, status, window_start, window_end, calendars_total,
        calendars_processed, students_updated, hocmai_updated, calendars_failed,
        errors_json, heartbeat_at, started_at, finished_at
      FROM calendar_attendance_sync_runs ORDER BY id DESC LIMIT 7
    `;
  } catch (error: any) {
    const missingTable = String(error?.meta?.code) === '1146'
      || String(error?.message || '').includes("doesn't exist");
    if (!missingTable) throw error;
    available = false;
  }
  const history = rows.map((row) => {
    let errors: Array<{ calendar_id: number; message: string }> = [];
    try {
      const parsed = JSON.parse(row.errors_json || '[]');
      if (Array.isArray(parsed)) errors = parsed;
    } catch { /* A malformed old log should not break the dashboard. */ }
    return {
      id: String(row.id), status: row.status,
      windowStart: row.window_start, windowEnd: row.window_end,
      calendarsTotal: Number(row.calendars_total),
      calendarsProcessed: Number(row.calendars_processed),
      studentsUpdated: Number(row.students_updated),
      hocmaiUpdated: Number(row.hocmai_updated),
      calendarsFailed: Number(row.calendars_failed), errors,
      heartbeatAt: row.heartbeat_at,
      startedAt: row.started_at, finishedAt: row.finished_at,
    };
  });
  return {
    available,
    enabled: process.env.CALENDAR_ATTENDANCE_CRON_ENABLED?.toLowerCase() !== 'false',
    hour: 4, minute: 0, timeZone: TIMEZONE,
    latest: history[0] ?? null,
    history,
  };
};

export const createCalendarAttendanceSyncCheck = (
  sync: (now: Date) => Promise<unknown> = runCalendarAttendanceSync,
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
    if (parts.hour !== '04' || parts.minute !== '00' || lastDate === date || running) return;

    running = true;
    try {
      const result = await sync(current);
      if (!(result && typeof result === 'object' && 'started' in result && result.started === false)) {
        lastDate = date;
      }
      onSuccess(result);
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
};

export const startCalendarAttendanceSyncWorker = () => {
  if (timer || process.env.CALENDAR_ATTENDANCE_CRON_ENABLED?.toLowerCase() === 'false') {
    return () => undefined;
  }

  const check = createCalendarAttendanceSyncCheck(
    runCalendarAttendanceSync,
    () => new Date(),
    (result) => logger.info('Calendar attendance sync completed', result),
    (error) => logger.error(
      'Calendar attendance sync failed:',
      error instanceof Error ? error.message : error
    )
  );
  void check();
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  timer.unref();
  logger.info(`Calendar attendance sync cron enabled at 04:00 (${TIMEZONE})`);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
};
