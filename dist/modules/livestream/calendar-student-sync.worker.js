"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCalendarStudentSyncWorker = exports.createCalendarStudentSyncCheck = exports.runCalendarStudentSync = exports.calendarStudentSyncRegisteredAt = exports.calendarStudentSyncWindow = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const dateTime_1 = require("../../utils/dateTime");
const logger_1 = require("../../utils/logger");
const teams_notifications_1 = require("../teams-notifications");
const calendar_student_sync_service_1 = require("./calendar-student-sync.service");
const CHECK_INTERVAL_MS = 30_000;
const START_HOUR = 17;
const END_HOUR = 23;
let timer = null;
const vietnamTimeParts = (now) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(now).map((part) => [part.type, part.value]));
const calendarStudentSyncWindow = (now = new Date()) => {
    const start = (0, dateTime_1.getVietnamWallClockDate)(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end, current: (0, dateTime_1.getVietnamWallClockDate)(now) };
};
exports.calendarStudentSyncWindow = calendarStudentSyncWindow;
const calendarStudentSyncRegisteredAt = (now = new Date()) => {
    const date = (0, dateTime_1.getVietnamWallClockDate)(now);
    return [String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), date.getUTCFullYear()].join('/');
};
exports.calendarStudentSyncRegisteredAt = calendarStudentSyncRegisteredAt;
const runCalendarStudentSync = async (now = new Date()) => {
    const { start, end, current } = (0, exports.calendarStudentSyncWindow)(now);
    await prisma_1.default.$executeRaw `
    UPDATE calendar_student_sync_runs
    SET status='interrupted', active_key=NULL, finished_at=NOW(3),
      errors_json='[{"code":"system","message":"Tiến trình backend bị ngắt trước khi hoàn tất"}]'
    WHERE active_key='global' AND started_at < DATE_SUB(NOW(3), INTERVAL 2 HOUR)
  `;
    try {
        await prisma_1.default.$executeRaw `
      INSERT INTO calendar_student_sync_runs (active_key, window_start, window_end)
      VALUES ('global', ${start}, ${end})
    `;
    }
    catch (error) {
        const duplicate = String(error?.meta?.code) === '1062' || String(error?.message || '').includes('Duplicate entry');
        if (duplicate)
            return { started: false, message: 'Một lượt đồng bộ học viên tự động đang chạy' };
        throw error;
    }
    const [activeRun] = await prisma_1.default.$queryRaw `
    SELECT id FROM calendar_student_sync_runs WHERE active_key='global' LIMIT 1
  `;
    const runId = activeRun.id;
    const registeredAt = (0, exports.calendarStudentSyncRegisteredAt)(now);
    let calendarsTotal = 0;
    let programs = 0;
    let inserted = 0;
    let skipped = 0;
    const errors = [];
    try {
        // Thời gian lịch được lưu theo Vietnam wall-clock; chỉ lấy buổi hôm nay chưa bắt đầu.
        const calendars = await prisma_1.default.calendar.findMany({
            where: {
                start_time: { gte: current, lt: end },
                OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
            },
            select: { id: true, code: true },
            orderBy: [{ code: 'asc' }, { learn_number: 'asc' }],
        });
        calendarsTotal = calendars.length;
        const byProgram = new Map();
        calendars.forEach((calendar) => byProgram.set(calendar.code, [...(byProgram.get(calendar.code) || []), calendar.id]));
        programs = byProgram.size;
        for (const [code, ids] of byProgram) {
            try {
                const result = await (0, calendar_student_sync_service_1.syncCalendarStudents)(ids, registeredAt);
                inserted += result.inserted;
                skipped += result.skipped;
                if (!result.failed)
                    await (0, calendar_student_sync_service_1.markCalendarsStudentSynced)(ids);
                if (result.failed)
                    errors.push({ code, message: 'Có ' + result.failed + ' học viên không hợp lệ' });
            }
            catch (error) {
                errors.push({ code, message: String(error?.message || 'Không thể đồng bộ chương trình') });
            }
        }
        const status = errors.length ? 'completed_with_errors' : 'completed';
        const errorsJson = errors.length ? JSON.stringify(errors) : null;
        await prisma_1.default.$executeRaw `
      UPDATE calendar_student_sync_runs
      SET status=${status}, active_key=NULL, calendars_total=${calendarsTotal}, programs_total=${programs},
        inserted=${inserted}, skipped=${skipped}, failed=${errors.length}, errors_json=${errorsJson}, finished_at=NOW(3)
      WHERE id=${runId}
    `;
        const notifyEmpty = process.env.CALENDAR_STUDENT_CRON_NOTIFY_EMPTY?.toLowerCase() === 'true';
        if (calendarsTotal > 0 || errors.length > 0 || notifyEmpty) {
            await (0, teams_notifications_1.enqueueStudentSyncTeamsSummary)(prisma_1.default, runId, {
                type: 'student_sync_summary', completedAt: new Date().toISOString(), registeredAt,
                calendars: calendarsTotal, programs, inserted, skipped, failed: errors.length, errors,
            });
        }
        return { started: true, status, calendars: calendarsTotal, programs, inserted, skipped, failed: errors.length, errors };
    }
    catch (error) {
        const message = String(error?.message || 'Không thể đồng bộ học viên tự động');
        await prisma_1.default.$executeRaw `
      UPDATE calendar_student_sync_runs
      SET status='failed', active_key=NULL, calendars_total=${calendarsTotal}, programs_total=${programs},
        inserted=${inserted}, skipped=${skipped}, failed=${errors.length + 1},
        errors_json=${JSON.stringify([...errors, { code: 'system', message }])}, finished_at=NOW(3)
      WHERE id=${runId}
    `.catch(() => undefined);
        throw error;
    }
};
exports.runCalendarStudentSync = runCalendarStudentSync;
const createCalendarStudentSyncCheck = (sync = exports.runCalendarStudentSync, now = () => new Date(), onSuccess = () => undefined, onError = () => undefined) => {
    let lastSlot = '';
    let running = false;
    return async () => {
        const current = now();
        const parts = vietnamTimeParts(current);
        const hour = Number(parts.hour);
        if (hour < START_HOUR || hour > END_HOUR || !['00', '30'].includes(parts.minute))
            return;
        const slot = current.toISOString().slice(0, 10) + ':' + parts.hour + ':' + parts.minute;
        if (running || lastSlot === slot)
            return;
        running = true;
        try {
            const result = await sync(current);
            lastSlot = slot;
            onSuccess(result);
        }
        catch (error) {
            onError(error);
        }
        finally {
            running = false;
        }
    };
};
exports.createCalendarStudentSyncCheck = createCalendarStudentSyncCheck;
const startCalendarStudentSyncWorker = () => {
    if (timer || process.env.CALENDAR_STUDENT_CRON_ENABLED?.toLowerCase() === 'false')
        return () => undefined;
    const check = (0, exports.createCalendarStudentSyncCheck)(exports.runCalendarStudentSync, () => new Date(), (result) => logger_1.logger.info('Calendar student sync completed', result), (error) => logger_1.logger.error('Calendar student sync failed:', error instanceof Error ? error.message : error));
    void check();
    timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    timer.unref();
    logger_1.logger.info('Calendar student sync cron enabled at 17:00–23:30 every 30 minutes (Asia/Ho_Chi_Minh)');
    return () => { if (timer)
        clearInterval(timer); timer = null; };
};
exports.startCalendarStudentSyncWorker = startCalendarStudentSyncWorker;
