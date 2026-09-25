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

export const runCalendarAttendanceSync = async (now = new Date()) => {
  const { start, end } = calendarAttendanceSyncWindow(now);
  // Select by start date: at 04:00 today, process the sessions scheduled
  // yesterday. The end-time condition avoids changing attendance for a rare
  // overnight session that has not actually finished yet.
  const calendars = await prisma.calendar.findMany({
    where: {
      start_time: { gte: start, lt: end },
      end_time: { lte: getVietnamWallClockDate(now) },
      OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (!calendars.length) return { start, end, calendars: 0, processed: 0, updated: 0, skipped: 0 };

  const result = await syncCalendarAttendance(calendars.map((calendar) => Number(calendar.id)));
  return { start, end, calendars: calendars.length, ...result };
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
      lastDate = date;
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
