import prisma from '../../lib/prisma';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { logger } from '../../utils/logger';
import { enqueueStudentSyncTeamsSummary } from '../teams-notifications';
import { fetchCalendarRegisteredStudents, markCalendarsStudentSynced, syncCalendarStudents, type HocmaiUser } from './calendar-student-sync.service';

const CHECK_INTERVAL_MS = 30_000;
const START_HOUR = 17;
const END_HOUR = 23;
let timer: NodeJS.Timeout | null = null;

const vietnamTimeParts = (now: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value])
);

export const calendarStudentSyncWindow = (now = new Date()) => {
  const start = getVietnamWallClockDate(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, current: getVietnamWallClockDate(now) };
};

export const calendarStudentSyncRegisteredAt = (now = new Date()) => {
  const date = getVietnamWallClockDate(now);
  return [String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), date.getUTCFullYear()].join('/');
};

export const calendarStudentSyncCalendarWhere = (start: Date, end: Date) => ({
  start_time: { gte: start, lt: end },
  OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
});

export const runCalendarStudentSync = async (now = new Date()) => {
  const { start, end } = calendarStudentSyncWindow(now);
  await prisma.$executeRaw`
    UPDATE calendar_student_sync_runs
    SET status='interrupted', active_key=NULL, finished_at=NOW(3),
      errors_json='[{"code":"system","message":"Tiến trình backend bị ngắt trước khi hoàn tất"}]'
    WHERE active_key='global' AND started_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)
  `;
  try {
    await prisma.$executeRaw`
      INSERT INTO calendar_student_sync_runs (active_key, window_start, window_end)
      VALUES ('global', ${start}, ${end})
    `;
  } catch (error: any) {
    const duplicate = String(error?.meta?.code) === '1062' || String(error?.message || '').includes('Duplicate entry');
    if (duplicate) return { started: false, message: 'Một lượt đồng bộ học viên tự động đang chạy' };
    throw error;
  }
  const [activeRun] = await prisma.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM calendar_student_sync_runs WHERE active_key='global' LIMIT 1
  `;
  const runId = activeRun.id;
  const registeredAt = calendarStudentSyncRegisteredAt(now);
  let calendarsTotal = 0;
  let programs = 0;
  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ code: string; message: string }> = [];
  try {
    // Thời gian lịch được lưu theo Vietnam wall-clock; quét mọi buổi trong ngày,
    // kể cả buổi đang học/đã kết thúc, nhưng không thêm học viên vào lịch nghỉ.
    const calendars = await prisma.calendar.findMany({
      where: calendarStudentSyncCalendarWhere(start, end),
      select: { id: true, code: true, key: true },
      orderBy: [{ code: 'asc' }, { learn_number: 'asc' }],
    });
    calendarsTotal = calendars.length;
    const byProgram = new Map<string, number[]>();
    calendars.forEach((calendar) => byProgram.set(calendar.code, [...(byProgram.get(calendar.code) || []), calendar.id]));
    programs = byProgram.size;
    const productsByProgram = new Map<string, Set<string>>();
    let prefetchedByProduct: Map<string, HocmaiUser[]> | undefined;
    try {
      const keys = calendars.map((calendar) => calendar.key?.trim()).filter((key): key is string => Boolean(key));
      const packageMappings = keys.length
        ? await prisma.package_lesson_mapping.findMany({
          where: { key: { in: keys } },
          select: { key: true, package_id: true },
        })
        : [];
      const productsByKey = new Map<string, Set<string>>();
      packageMappings.forEach((mapping) => {
        const key = String(mapping.key || "").trim();
        const productId = String(mapping.package_id || "").trim();
        if (!key || !productId) return;
        const products = productsByKey.get(key) || new Set<string>();
        products.add(productId);
        productsByKey.set(key, products);
      });
      calendars.forEach((calendar) => {
        const products = productsByProgram.get(calendar.code) || new Set<string>();
        productsByKey.get(String(calendar.key || "").trim())?.forEach((productId) => products.add(productId));
        productsByProgram.set(calendar.code, products);
      });
      const allProductIds = [...new Set([...productsByProgram.values()].flatMap((products) => [...products]))];
      if (allProductIds.length) {
        const users = await fetchCalendarRegisteredStudents(allProductIds, registeredAt);
        prefetchedByProduct = new Map<string, HocmaiUser[]>();
        users.forEach((user) => {
          const productId = String(user.product_id || "").trim();
          const productUsers = prefetchedByProduct!.get(productId) || [];
          productUsers.push(user);
          prefetchedByProduct!.set(productId, productUsers);
        });
        logger.info("Calendar student sync fetched " + users.length + " users from " + allProductIds.length + " packages");
      }
    } catch (error: any) {
      prefetchedByProduct = undefined;
      // API gộp lỗi thì trở lại cách quét riêng từng chương trình để không chặn cả lượt.
      logger.warn("Calendar student sync combined fetch failed, falling back by program:", error?.message || error);
    }
    for (const [code, ids] of byProgram) {
      try {
        const prefetchedUsers = prefetchedByProduct
          ? [...(productsByProgram.get(code) || [])].flatMap((productId) => prefetchedByProduct!.get(productId) || [])
          : undefined;
        const result = await syncCalendarStudents(ids, registeredAt, undefined, prefetchedUsers);
        inserted += result.inserted;
        skipped += result.skipped;
        if (!result.failed) await markCalendarsStudentSynced(ids);
        if (result.failed) errors.push({ code, message: 'Có ' + result.failed + ' học viên không hợp lệ' });
      } catch (error: any) {
        errors.push({ code, message: String(error?.message || 'Không thể đồng bộ chương trình') });
      }
    }
    const status = errors.length ? 'completed_with_errors' : 'completed';
    const errorsJson = errors.length ? JSON.stringify(errors) : null;
    await prisma.$executeRaw`
      UPDATE calendar_student_sync_runs
      SET status=${status}, active_key=NULL, calendars_total=${calendarsTotal}, programs_total=${programs},
        inserted=${inserted}, skipped=${skipped}, failed=${errors.length}, errors_json=${errorsJson}, finished_at=NOW(3)
      WHERE id=${runId}
    `;
    const notifyEmpty = process.env.CALENDAR_STUDENT_CRON_NOTIFY_EMPTY?.toLowerCase() === 'true';
    if (calendarsTotal > 0 || errors.length > 0 || notifyEmpty) {
      await enqueueStudentSyncTeamsSummary(prisma, runId, {
        type: 'student_sync_summary', completedAt: new Date().toISOString(), registeredAt,
        calendars: calendarsTotal, programs, inserted, skipped, failed: errors.length, errors,
      });
    }
    return { started: true, status, calendars: calendarsTotal, programs, inserted, skipped, failed: errors.length, errors };
  } catch (error: any) {
    const message = String(error?.message || 'Không thể đồng bộ học viên tự động');
    await prisma.$executeRaw`
      UPDATE calendar_student_sync_runs
      SET status='failed', active_key=NULL, calendars_total=${calendarsTotal}, programs_total=${programs},
        inserted=${inserted}, skipped=${skipped}, failed=${errors.length + 1},
        errors_json=${JSON.stringify([...errors, { code: 'system', message }])}, finished_at=NOW(3)
      WHERE id=${runId}
    `.catch(() => undefined);
    throw error;
  }
};

export const createCalendarStudentSyncCheck = (
  sync: (now: Date) => Promise<unknown> = runCalendarStudentSync,
  now: () => Date = () => new Date(),
  onSuccess: (result: unknown) => void = () => undefined,
  onError: (error: unknown) => void = () => undefined
) => {
  let lastSlot = '';
  let running = false;
  return async () => {
    const current = now();
    const parts = vietnamTimeParts(current);
    const hour = Number(parts.hour);
    if (hour < START_HOUR || hour > END_HOUR || !['00', '30'].includes(parts.minute)) return;
    const slot = current.toISOString().slice(0, 10) + ':' + parts.hour + ':' + parts.minute;
    if (running || lastSlot === slot) return;
    running = true;
    try {
      const result = await sync(current);
      lastSlot = slot;
      onSuccess(result);
    } catch (error) { onError(error); } finally { running = false; }
  };
};

export const startCalendarStudentSyncWorker = () => {
  if (timer || process.env.CALENDAR_STUDENT_CRON_ENABLED?.toLowerCase() === 'false') return () => undefined;
  const check = createCalendarStudentSyncCheck(
    runCalendarStudentSync, () => new Date(),
    (result) => logger.info('Calendar student sync completed', result),
    (error) => logger.error('Calendar student sync failed:', error instanceof Error ? error.message : error)
  );
  void check();
  timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
  timer.unref();
  logger.info('Calendar student sync cron enabled at 17:00–23:30 every 30 minutes (Asia/Ho_Chi_Minh)');
  return () => { if (timer) clearInterval(timer); timer = null; };
};
