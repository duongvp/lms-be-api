"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBulk = exports.updateCalendarMappings = exports.restoreSession = exports.deleteSession = exports.cancelSession = exports.updateSchedule = exports.bulkRescheduleSessions = exports.swapSessionTimes = exports.rescheduleSession = exports.createValidatedInternalCalendarImport = exports.createValidatedCalendarImport = exports.createBulk = exports.createSingle = exports.approvalPreviewHelpers = exports.backfillMissingCalendarTeachingUsers = exports.resendCalendarsToHocmai = exports.previewCalendarMappingUpdates = exports.getCalendarRowsForExport = exports.getCalendar = exports.assertCalendarIdsInProgram = exports.resetCalendarAttendance = exports.getCalendarAttendanceResetStudents = exports.syncCalendarAttendance = exports.buildHocmaiAttendancePayload = exports.getCalendarHeaderFilterOptions = exports.getCalendarTeacherFilterOptions = exports.getCalendarImportProgramContext = exports.assertSchedulingProgramExists = exports.getHocmaiSectionsForProgramLesson = exports.getHocmaiSectionsForProgramLessons = exports.getSchedulingPrograms = exports.getProgramLessonsForScheduling = exports.validateSwapScheduleConflicts = exports.validateBulkScheduleChanges = exports.validateBulkScheduleConflicts = exports.validateBulkFinalStateConflicts = exports.checkConflict = exports.ScheduleConflictError = exports.assertCanUpdateSessionMappings = exports.isSessionModifiable = exports.provisionCalendarsEvgBulk = exports.provisionCalendarEvgStream = void 0;
const calendar_classification_filters_1 = require("./calendar-classification-filters");
const calendar_transaction_1 = require("../../lib/calendar-transaction");
const calendar_lifecycle_1 = require("./calendar-lifecycle");
const crypto_1 = __importDefault(require("crypto"));
const calendar_source_1 = require("./calendar-source");
const calendar_time_notification_1 = require("./calendar-time-notification");
const calendar_swap_time_1 = require("./calendar-swap-time");
const client_1 = require("@prisma/client");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const calendar_transaction_2 = __importDefault(require("../../lib/calendar-transaction"));
const calendar_export_system_1 = require("./calendar-export-system");
const calendar_export_fields_1 = require("./calendar-export-fields");
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const hocmai_course_outline_service_1 = require("../../integrations/hocmai-course-outline.service");
const hocmai_sync_queue_service_1 = require("./hocmai-sync-queue.service");
const teams_notifications_1 = require("../teams-notifications");
const dateTime_1 = require("../../utils/dateTime");
const calendar_column_filters_1 = require("./calendar-column-filters");
const evg_status_1 = require("./evg-status");
const calendar_user_sync_service_1 = require("./calendar-user-sync.service");
const program_teacher_banner_service_1 = require("../program-teacher-banners/program-teacher-banner.service");
var evg_stream_service_1 = require("./evg-stream.service");
Object.defineProperty(exports, "provisionCalendarEvgStream", { enumerable: true, get: function () { return evg_stream_service_1.provisionCalendarEvgStream; } });
Object.defineProperty(exports, "provisionCalendarsEvgBulk", { enumerable: true, get: function () { return evg_stream_service_1.provisionCalendarsEvgBulk; } });
const hmoSectionsByPackageCourseCache = new Map();
const HMO_SECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
const packageCourseKey = (packageId, courseId) => (JSON.stringify([String(packageId), String(courseId)]));
const normalizeChangeReason = (payload) => {
    const reason = String(payload?.reason ?? payload?.change_reason ?? '').trim();
    if (payload?.send_notification !== false && !reason) {
        throw new Error("Vui lòng nhập lý do thay đổi lịch học");
    }
    if (reason.length > 500) {
        throw new Error("Lý do thay đổi không được vượt quá 500 ký tự");
    }
    return reason || 'Nghỉ học';
};
const shouldSendChangeNotification = (payload) => payload?.send_notification !== false;
const normalizeChangeActor = (actor) => {
    const userId = Number(actor?.userId);
    const username = String(actor?.username || '').trim();
    if (!Number.isInteger(userId) || userId <= 0 || !username) {
        throw new Error("Không xác định được người thay đổi lịch học");
    }
    return { userId, username };
};
const toAuditJson = (value) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const writeCalendarChangeLog = async (tx, input) => {
    await tx.$executeRaw `
    INSERT INTO calendar_change_logs (
      operation_id,
      action,
      calendar_id,
      old_key,
      new_key,
      code,
      learn_number,
      reason,
      actor_user_id,
      actor_username,
      before_data,
      after_data,
      affected_sessions,
      created_at
    ) VALUES (
      ${input.operationId || crypto_1.default.randomUUID()},
      ${input.action},
      ${input.current.id},
      ${input.current.key || null},
      ${input.newKey || null},
      ${input.current.code},
      ${input.current.learn_number},
      ${input.reason},
      ${input.actor.userId},
      ${input.actor.username},
      ${toAuditJson(input.beforeData)},
      ${toAuditJson(input.afterData)},
      ${toAuditJson(input.affectedSessions)},
      NOW(3)
    )
  `;
};
const auditTimeChange = async (tx, before, after, changeActor, rawReason) => {
    const beforeStart = new Date(before.start_time).getTime();
    const beforeEnd = new Date(before.end_time).getTime();
    const afterStart = new Date(after.start_time).getTime();
    const afterEnd = new Date(after.end_time).getTime();
    // Append assignment history without changing existing scheduling eligibility.
    // Legacy/internal callers without an actor retain their previous behavior.
    if (changeActor?.userId && changeActor.username && (String(before.teacher ?? '') !== String(after.teacher ?? '')
        || String(before.assistant_teacher ?? '') !== String(after.assistant_teacher ?? ''))) {
        await writeCalendarChangeLog(tx, {
            action: 'teaching_assignment_update', current: before,
            reason: String(rawReason || '').trim().slice(0, 500) || 'Cập nhật phân công giảng dạy',
            actor: normalizeChangeActor(changeActor),
            beforeData: { source_session: before }, afterData: { source_session: after },
            affectedSessions: [after], newKey: after.key,
        });
    }
    if (beforeStart === afterStart && beforeEnd === afterEnd)
        return;
    const actor = normalizeChangeActor(changeActor);
    const reason = String(rawReason || '').trim().slice(0, 500) || 'Cập nhật thời gian lịch học';
    await writeCalendarChangeLog(tx, {
        action: 'time_update',
        current: before,
        reason,
        actor,
        beforeData: { start_time: before.start_time, end_time: before.end_time },
        afterData: { start_time: after.start_time, end_time: after.end_time },
        affectedSessions: [after],
        newKey: after.key,
    });
};
// Helper: Tạo key (sessionId) tự động theo quy tắc
const generateKey = (systemType, startTime, code, learnNumber, lessonCount, calendarSource = 'livestream') => {
    const sysCode = systemType === 'topclass' ? 'tc' : (systemType === 'topuni' ? 'tu' : systemType);
    const startYear = startTime.getFullYear();
    const month = startTime.getMonth() + 1;
    let schoolYear;
    if (month >= 6) {
        schoolYear = `${startYear.toString().slice(-2)}${(startYear + 1).toString().slice(-2)}`;
    }
    else {
        schoolYear = `${(startYear - 1).toString().slice(-2)}${startYear.toString().slice(-2)}`;
    }
    const sessionNum = (lessonCount || 0) + 1;
    const sessionSuffix = sessionNum > 1 ? `_B${sessionNum}` : '';
    return `${sysCode}_${schoolYear}_${code}_${learnNumber}${sessionSuffix}`;
};
const COPY_SESSION_FIELDS = [
    'session_id',
    'code',
    'learn_number',
    'subject',
    'teacher',
    'assistant_teacher',
    'lesson_name',
    'lesson_document',
    'evg_banner',
    'evg_stream',
    'lesson_link',
    'lesson_baitap',
    'lesson_tomtat',
    'lesson_phuongphap',
    'lesson_luuy',
    'lesson_ketqua',
    'channel_name',
    'lesson_count',
    'lesson_noti',
    'system_type',
];
const parseAssistantTeachers = (value) => {
    if (value === undefined || value === null || value === '')
        return [];
    const rawValues = Array.isArray(value) ? value : String(value).split(',');
    const usernames = Array.from(new Set(rawValues
        .map((item) => String(item ?? '').trim())
        .filter(username => Boolean(username) && !/^(?:\[null\]|null|-)$/i.test(username))));
    if (usernames.some((username) => username.length > 120)) {
        throw new Error('Username trợ giảng không được vượt quá 120 ký tự');
    }
    if (usernames.join(',').length > 500) {
        throw new Error('Danh sách trợ giảng không được vượt quá 500 ký tự');
    }
    return usernames;
};
const normalizeTeachingAssignments = async (client, data) => {
    const hasTeacher = Object.prototype.hasOwnProperty.call(data, 'teacher');
    const hasAssistants = Object.prototype.hasOwnProperty.call(data, 'assistant_teacher');
    if (!hasTeacher && !hasAssistants)
        return data;
    let teacher = hasTeacher ? String(data.teacher || '').trim() : undefined;
    const assistants = hasAssistants
        ? parseAssistantTeachers(data.assistant_teacher)
        : [];
    if (teacher && teacher.length > 150) {
        throw new Error('Tên giáo viên không được vượt quá 150 ký tự');
    }
    if (teacher) {
        const teacherProfile = await (0, calendar_user_sync_service_1.resolveCalendarTeacherProfile)(client, teacher);
        teacher = String(teacherProfile?.display_name || teacherProfile?.username || '').trim();
    }
    // Calendar lưu display_name cho giáo viên và username cho trợ giảng.
    if (assistants.length) {
        const profiles = await client.$queryRaw(client_1.Prisma.sql `
      SELECT username, can_view_stream_key
      FROM teacher_profiles
      WHERE username IN (${client_1.Prisma.join(assistants)})
        AND status = 1
    `);
        const profileByUsername = new Map(profiles.map((profile) => [profile.username, profile.can_view_stream_key]));
        const invalidAssistants = assistants.filter((username) => profileByUsername.get(username) !== 0);
        if (invalidAssistants.length) {
            throw new Error(`Trợ giảng không tồn tại, đã ngừng hoạt động hoặc sai loại: ${invalidAssistants.join(', ')}`);
        }
    }
    if (hasTeacher)
        data.teacher = teacher || null;
    if (hasAssistants) {
        data.assistant_teacher = assistants.length ? assistants.join(',') : null;
    }
    return data;
};
// Tạm thời chưa đối chiếu giáo viên/trợ giảng với teacher_profiles khi cập nhật
// lịch. Giá trị nhập từ màn hình được lưu nguyên văn; việc đồng bộ user/phòng
// học cũng được tắt ở updateCalendarRecord bằng cờ bên dưới.
const normalizeTeachingAssignmentsForScheduleUpdate = (data) => {
    const hasTeacher = Object.prototype.hasOwnProperty.call(data, 'teacher');
    const hasAssistants = Object.prototype.hasOwnProperty.call(data, 'assistant_teacher');
    if (hasTeacher) {
        const teacher = String(data.teacher || '').trim();
        if (teacher.length > 150) {
            throw new Error('Tên giáo viên không được vượt quá 150 ký tự');
        }
        data.teacher = teacher || null;
    }
    if (hasAssistants) {
        const assistants = parseAssistantTeachers(data.assistant_teacher);
        data.assistant_teacher = assistants.length ? assistants.join(',') : null;
    }
    data.skip_teacher_user_sync = true;
    return data;
};
const hydrateAssistantTeachers = async (client, records) => {
    const ids = records
        .map((record) => Number(record?.id))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length)
        return records;
    const rows = await client.$queryRaw(client_1.Prisma.sql `
    SELECT id, assistant_teacher, session_id
    FROM calendar
    WHERE id IN (${client_1.Prisma.join(ids)})
  `);
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    records.forEach((record) => {
        const metadata = byId.get(Number(record.id));
        record.assistant_teacher = metadata?.assistant_teacher ?? null;
        record.session_id = metadata?.session_id ?? null;
    });
    return records;
};
const createCalendarRecord = async (client, data, previousTeachingCalendar = null) => {
    if (Object.prototype.hasOwnProperty.call(data, 'deleted_at')) {
        throw new Error('Trạng thái xóa chỉ được thay đổi qua thao tác xóa/khôi phục lịch');
    }
    const skipTeacherUserSync = data.skip_teacher_user_sync === true;
    (0, calendar_source_1.assertCalendarSourceUnchanged)(data, data);
    const prismaData = { ...data };
    delete prismaData.calendar_source;
    delete prismaData.skip_teacher_user_sync;
    // Banner được quản lý tập trung theo chương trình + giáo viên. Cột trên
    // calendar chỉ là snapshot để giữ tương thích với API/export hiện có.
    if ((0, calendar_source_1.calendarSourceFromCode)(prismaData.code) === 'livestream') {
        prismaData.evg_banner = await (0, program_teacher_banner_service_1.resolveProgramTeacherBanner)(client, prismaData.code, prismaData.teacher);
    }
    // Hai cột này đã có trong Prisma schema, vì vậy ghi ngay trong INSERT.
    // Trước đây mỗi calendar phải UPDATE hai lần rồi SELECT lại, khiến bulk
    // create phát sinh thêm tới 3 round-trip DB cho từng buổi.
    const reuse = await (0, calendar_lifecycle_1.claimDeletedCalendarKey)(client, prismaData.key);
    const created = await client.calendar.create({ data: prismaData });
    const result = { ...created };
    if (reuse)
        Object.defineProperty(result, calendar_lifecycle_1.CALENDAR_KEY_REUSE, { value: reuse });
    if (!skipTeacherUserSync) {
        await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(client, previousTeachingCalendar, result);
    }
    return result;
};
const updateCalendarRecord = async (client, id, data, preloadedBefore, allowSourceChange = false) => {
    if (Object.prototype.hasOwnProperty.call(data, 'deleted_at')) {
        throw new Error('Trạng thái xóa chỉ được thay đổi qua thao tác xóa/khôi phục lịch');
    }
    const before = preloadedBefore || await client.calendar.findUnique({ where: { id } });
    if (!before)
        throw new Error('Not found');
    (0, calendar_source_1.assertCalendarSourceUnchanged)(before, data);
    if (!preloadedBefore)
        await hydrateAssistantTeachers(client, [before]);
    const hasAssistants = Object.prototype.hasOwnProperty.call(data, 'assistant_teacher');
    const assistantTeacher = data.assistant_teacher ?? null;
    const hasSessionId = Object.prototype.hasOwnProperty.call(data, 'session_id');
    const sessionId = data.session_id ?? null;
    const skipTeacherUserSync = data.skip_teacher_user_sync === true;
    const prismaData = { ...data };
    delete prismaData.assistant_teacher;
    delete prismaData.session_id;
    delete prismaData.calendar_source;
    delete prismaData.skip_teacher_user_sync;
    const nextCode = prismaData.code ?? before.code;
    const nextTeacher = prismaData.teacher ?? before.teacher;
    const bannerIdentityChanged = (0, calendar_source_1.calendarSourceFromCode)(nextCode) === 'livestream'
        && ((0, calendar_source_1.calendarSourceFromCode)(before.code) === 'feed' || nextCode !== before.code || nextTeacher !== before.teacher);
    if (bannerIdentityChanged) {
        prismaData.evg_banner = await (0, program_teacher_banner_service_1.resolveProgramTeacherBanner)(client, nextCode, nextTeacher);
    }
    const updated = await client.calendar.update({ where: { id }, data: prismaData });
    if (bannerIdentityChanged && (0, calendar_source_1.calendarSourceFromCode)(before.code) !== 'feed') {
        await client.stream.updateMany({
            where: { code: before.code, learn_number: before.learn_number },
            data: { banner_url: prismaData.evg_banner, updated_at: new Date() },
        });
    }
    if (hasAssistants) {
        await client.$executeRaw `
      UPDATE calendar
      SET assistant_teacher = ${assistantTeacher}
      WHERE deleted_at IS NULL AND id = ${id}
    `;
    }
    if (hasSessionId) {
        await client.$executeRaw `
      UPDATE calendar
      SET session_id = ${sessionId}
      WHERE deleted_at IS NULL AND id = ${id}
    `;
    }
    // Các cột legacy assistant_teacher/session_id không nằm trong Prisma model.
    // Dùng snapshot đã hydrate để dựng kết quả, tránh query lại ngay sau UPDATE.
    const result = {
        ...updated,
        assistant_teacher: hasAssistants
            ? assistantTeacher
            : before.assistant_teacher ?? null,
        session_id: hasSessionId
            ? sessionId
            : before.session_id ?? null,
    };
    if (!skipTeacherUserSync) {
        await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(client, before, result);
    }
    return result;
};
const normalizeRoom = (data) => {
    if (data?.room && !data.channel_name) {
        data.channel_name = data.room;
    }
    delete data.room;
    return data;
};
const calendarSubjectName = (subject, grade, systemType) => {
    if (systemType !== 'topclass')
        return subject;
    const name = typeof subject === 'string' ? subject.trim() : '';
    const block = Number(grade);
    if (!name || !Number.isInteger(block) || block < 1 || block > 12)
        return subject;
    // Một số dữ liệu cũ đã có khối trong tên môn; không thêm lần thứ hai.
    return name.endsWith(` ${block}`) ? name : `${name} ${block}`;
};
const hydrateLessonData = async (tx, input, lessonCache) => {
    const data = { ...input };
    // session_id references the internal `lessons.id`. External HMO lesson_id
    // is a section ID and only belongs inside package_lesson_mappings.
    const sessionId = data.session_id ?? data.sessionId;
    const customLessonName = typeof data.lesson_name === 'string'
        ? data.lesson_name.trim()
        : '';
    if (customLessonName.length > 400) {
        throw new Error("lesson_name không được vượt quá 400 ký tự");
    }
    delete data.lesson_id;
    delete data.sessionId;
    delete data.package_lesson_mappings;
    delete data.grade;
    delete data.subject_code;
    delete data.subject_name;
    // Các client cũ chưa gửi session_id vẫn tiếp tục dùng payload calendar hiện tại.
    if (sessionId === undefined || sessionId === null || sessionId === '') {
        delete data.session_id;
        data.subject = calendarSubjectName(data.subject, input.grade, data.system_type || 'topclass');
        return data;
    }
    let parsedSessionId;
    try {
        parsedSessionId = BigInt(sessionId);
    }
    catch {
        throw new Error("session_id không hợp lệ");
    }
    const lessons = lessonCache
        ? []
        : await tx.$queryRawUnsafe('SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1 FOR SHARE', parsedSessionId);
    const lesson = lessonCache?.get(parsedSessionId.toString()) || lessons[0];
    if (!lesson) {
        throw new Error("Bài học không tồn tại hoặc đã ngừng hoạt động");
    }
    if ((0, calendar_source_1.calendarSourceFromCode)(data.code) !== (0, calendar_source_1.calendarSourceFromCode)(lesson.subject_code)) {
        throw new ApiError_1.default('Bài học và lịch phải thuộc cùng nguồn Livestream hoặc Feed', 400);
    }
    return {
        ...data,
        session_id: parsedSessionId,
        learn_number: lesson.learn_number,
        subject: calendarSubjectName(lesson.subject_name, lesson.grade, lesson.system_type),
        lesson_name: customLessonName || lesson.lesson_name,
    };
};
const ensureValidTimeRange = (startTime, endTime) => {
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        throw new Error("Thời gian không hợp lệ");
    }
    if (startTime >= endTime) {
        throw new Error("Thời gian kết thúc phải sau thời gian bắt đầu");
    }
};
const ensureNotAfterCourseEnd = (endTime, courseEndTime) => {
    if (!courseEndTime)
        return;
    const courseEnd = new Date(String(courseEndTime));
    if (Number.isNaN(courseEnd.getTime())) {
        throw new Error("course_end_time không hợp lệ");
    }
    if (endTime > courseEnd) {
        throw new Error("Lịch học không được vượt ngày kết thúc khóa học");
    }
};
const startOfDay = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
};
const ensureNotBeforeDate = (value, minDate, message) => {
    if (startOfDay(value) < startOfDay(minDate)) {
        throw new Error(message);
    }
};
const ensureNotBeforeNow = (value) => {
    const now = (0, dateTime_1.getVietnamWallClockDate)();
    if (value <= now) {
        throw new Error('Thời gian buổi học mới phải sau thời gian hiện tại');
    }
};
const ensureAfterStartOnSameDate = (value, previousStart) => {
    if (startOfDay(value).getTime() === startOfDay(previousStart).getTime()
        && value <= previousStart) {
        throw new Error(`Nếu chọn ngày cuối khóa, giờ bắt đầu phải sau ${String(previousStart.getHours()).padStart(2, '0')}:${String(previousStart.getMinutes()).padStart(2, '0')}`);
    }
};
const isSessionModifiable = (session, now = new Date()) => {
    if (session.deleted_at || Number(session.lesson_status) === 1)
        return false;
    const startTime = session.start_time ? new Date(session.start_time) : null;
    return Boolean(startTime
        && !Number.isNaN(startTime.getTime())
        && startTime > now);
};
exports.isSessionModifiable = isSessionModifiable;
const assertCanUpdateSession = (session) => {
    if (!(0, exports.isSessionModifiable)(session)) {
        throw new Error("Chỉ được thay đổi buổi học chưa diễn ra và chưa nghỉ");
    }
};
// Mapping HMO cần được sửa/khôi phục cả sau khi buổi học đã diễn ra.
// Các thay đổi khác vẫn đi qua điều kiện bảo vệ lịch cũ.
const assertCanUpdateSessionMappings = (session, data, allowSourceChange = false) => {
    if (!allowSourceChange)
        (0, calendar_source_1.assertCalendarSourceUnchanged)(session, data);
    else
        (0, calendar_source_1.assertCalendarSourceUnchanged)(session, data);
    if ((0, exports.isSessionModifiable)(session))
        return;
    const metadataKeys = new Set(['id', 'calendar_source', 'reason', 'change_reason', 'send_notification', 'allow_past']);
    const changedFields = Object.keys(data).filter((key) => data[key] !== undefined && !metadataKeys.has(key));
    if (Array.isArray(data.package_lesson_mappings)
        && changedFields.every((key) => key === 'package_lesson_mappings'))
        return;
    throw new Error('Lịch đã diễn ra hoặc đã nghỉ chỉ được cập nhật Package/Course/Lesson ID; không được đổi ngày giờ hay thông tin lịch khác');
};
exports.assertCanUpdateSessionMappings = assertCanUpdateSessionMappings;
const withCalendarTriggerErrorHint = async (operation) => {
    try {
        return await operation();
    }
    catch (error) {
        const message = String(error?.message || '');
        if (message.includes("The user specified as a definer") || message.includes("code: 1449")) {
            throw new Error("Trigger calendar đang dùng DEFINER không tồn tại trên database. Chạy `npm run db:calendar-triggers` trong lms-manage-api để tạo lại trigger bằng user DB hiện tại.");
        }
        throw error;
    }
};
const isTransactionConflict = (error) => {
    if (error?.code === 'P2034')
        return true;
    const message = String(error?.message || '');
    return message.includes('Deadlock found')
        || message.includes('Lock wait timeout exceeded')
        || message.includes('Transaction failed due to a write conflict');
};
const withSerializableTransaction = async (operation, maxAttempts = 3, timeoutMs = 15_000) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await calendar_transaction_2.default.$transaction(operation, {
                isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5_000,
                timeout: timeoutMs,
            });
        }
        catch (error) {
            if (!isTransactionConflict(error) || attempt === maxAttempts) {
                throw error;
            }
        }
    }
    throw new Error("Không thể hoàn tất giao dịch dời lịch");
};
const copySessionData = (source) => {
    const data = {};
    COPY_SESSION_FIELDS.forEach((field) => {
        data[field] = source[field];
    });
    return data;
};
const getNextLessonCount = async (tx, code, systemType, learnNumber, calendarSource = 'livestream') => {
    const latest = await tx.calendar.findFirst({
        where: {
            code,
            AND: [{ code: calendarSource === 'feed' ? { startsWith: 'feed-' } : { not: { startsWith: 'feed-' } } }],
            ...(systemType ? { system_type: systemType } : {}),
            ...(learnNumber !== undefined ? { learn_number: learnNumber } : {}),
        },
        orderBy: { lesson_count: 'desc' },
        select: { lesson_count: true },
    });
    return Number(latest?.lesson_count ?? -1) + 1;
};
const normalizePositiveInteger = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${fieldName} không hợp lệ`);
    }
    return parsed;
};
const normalizeLessonCount = (value) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("lesson_count không hợp lệ");
    }
    return parsed;
};
const lessonIdentityKey = (code, systemType, learnNumber, source = 'livestream') => `${source}::${systemType}::${code}::${learnNumber}`;
const assertLessonCountAvailable = async (tx, code, systemType, learnNumber, lessonCount, calendarSource = 'livestream') => {
    const existing = await tx.calendar.findFirst({
        where: {
            code,
            system_type: systemType,
            learn_number: learnNumber,
            lesson_count: lessonCount,
            AND: [{ code: calendarSource === 'feed' ? { startsWith: 'feed-' } : { not: { startsWith: 'feed-' } } }],
        },
        select: { id: true, key: true },
    });
    if (existing) {
        throw new Error(`Bài ${learnNumber} của khóa ${code} đã có lịch b${lessonCount + 1}${existing.key ? ` (${existing.key})` : ''}`);
    }
};
const prepareCalendarCreateData = async (tx, input, reservedCounts, lessonCache) => {
    const data = normalizeRoom(await hydrateLessonData(tx, input, lessonCache));
    (0, calendar_source_1.assertCalendarSourceUnchanged)(data, input);
    const calendarSource = (0, calendar_source_1.calendarSourceFromCode)(data.code);
    delete data.calendar_source;
    // Request-only opt-in; never persist it on calendar records.
    delete data.allow_shared_staff_schedule;
    const skipTeacherProfileValidation = data.skip_teacher_profile_validation === true;
    delete data.skip_teacher_profile_validation;
    if (!skipTeacherProfileValidation) {
        await normalizeTeachingAssignments(tx, data);
    }
    else {
        // Import trực tiếp đang lưu nguyên tên giáo viên; chưa đồng bộ teacher user
        // cho đến khi bước đối chiếu teacher_profiles được bật lại.
        data.skip_teacher_user_sync = true;
    }
    if (!data.code) {
        throw new Error("Vui lòng cung cấp mã khóa học");
    }
    data.system_type = data.system_type || 'topclass';
    data.learn_number = normalizePositiveInteger(data.learn_number, 'learn_number');
    data.start_time = new Date(data.start_time);
    data.end_time = new Date(data.end_time);
    ensureValidTimeRange(data.start_time, data.end_time);
    const identity = lessonIdentityKey(data.code, data.system_type, data.learn_number, calendarSource);
    const reserved = reservedCounts?.get(identity) || new Set();
    let lessonCount = normalizeLessonCount(data.lesson_count);
    const isLessonCountProvided = lessonCount !== undefined;
    if (lessonCount !== undefined) {
        if (reserved.has(lessonCount)) {
            throw new Error(`Bài ${data.learn_number} của khóa ${data.code} bị trùng lịch b${lessonCount + 1} trong danh sách tạo`);
        }
        await assertLessonCountAvailable(tx, data.code, data.system_type, data.learn_number, lessonCount, calendarSource);
    }
    else {
        lessonCount = await getNextLessonCount(tx, data.code, data.system_type, data.learn_number, calendarSource);
        while (reserved.has(lessonCount)) {
            lessonCount += 1;
        }
    }
    data.lesson_count = lessonCount;
    data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount, calendarSource);
    const existingKey = await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } });
    if (existingKey && isLessonCountProvided) {
        throw new Error(`SessionId ${data.key} đã tồn tại`);
    }
    while (!isLessonCountProvided && await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } })) {
        lessonCount += 1;
        if (reserved.has(lessonCount))
            continue;
        data.lesson_count = lessonCount;
        data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount, calendarSource);
    }
    if (reservedCounts) {
        reserved.add(lessonCount);
        reservedCounts.set(identity, reserved);
    }
    return {
        calendarData: data,
    };
};
const resolvePackageLessonMappings = async (rawMappings) => {
    if (!Array.isArray(rawMappings) || rawMappings.length === 0) {
        return [];
    }
    if (rawMappings.length > 100) {
        throw new Error("Không được khai báo quá 100 nhóm Course/Lesson");
    }
    const normalizedGroups = rawMappings.map((mapping, index) => {
        const courseId = String(mapping?.course_id ?? '').trim();
        const rawLessonIds = Array.isArray(mapping?.lesson_ids)
            ? mapping.lesson_ids
            : Array.isArray(mapping?.lesson_id)
                ? mapping.lesson_id
                : [mapping?.lesson_id];
        const lessonIds = Array.from(new Set(rawLessonIds
            .map((lessonId) => String(lessonId ?? '').trim())
            .filter((lessonId) => lessonId.length > 0)));
        if (!courseId) {
            throw new Error(`Nhóm mapping ${index + 1}: Vui lòng chọn Course ID`);
        }
        if (courseId.length > 50) {
            throw new Error(`Nhóm mapping ${index + 1}: Course ID vượt quá 50 ký tự`);
        }
        if (lessonIds.length === 0) {
            throw new Error(`Nhóm mapping ${index + 1}: Vui lòng nhập ít nhất một Lesson ID`);
        }
        if (lessonIds.length > 100 || lessonIds.some((lessonId) => lessonId.length > 50)) {
            throw new Error(`Nhóm mapping ${index + 1}: Lesson ID không hợp lệ`);
        }
        const rawPackageIds = Array.isArray(mapping?.package_ids)
            ? mapping.package_ids
            : Array.isArray(mapping?.package_id)
                ? mapping.package_id
                : [mapping?.package_id];
        const packageIds = Array.from(new Set(rawPackageIds
            .map((packageId) => String(packageId ?? '').trim())
            .filter(Boolean)));
        return { courseId, lessonIds, packageIds };
    });
    const mappings = [];
    const resolvedIdentities = new Set();
    for (const group of normalizedGroups) {
        const packageCourses = group.packageIds.length
            ? group.packageIds.map((packageId) => ({ package_id: packageId, course_id: group.courseId }))
            : await (0, package_course_sheet_service_1.resolvePackagesByCourseId)(group.courseId);
        for (const packageCourse of packageCourses) {
            for (const lessonId of group.lessonIds) {
                const identity = `${packageCourse.package_id}::${lessonId}`;
                if (resolvedIdentities.has(identity))
                    continue;
                resolvedIdentities.add(identity);
                mappings.push({
                    package_id: packageCourse.package_id,
                    course_id: group.courseId,
                    lesson_id: lessonId,
                });
            }
        }
    }
    return mappings;
};
const normalizePackageLessonMappingsForUpdate = async (rawMappings) => {
    if (!Array.isArray(rawMappings))
        throw new Error("Mapping Lesson ID không hợp lệ");
    // Mảng rỗng là thao tác chủ động xóa toàn bộ Lesson ID của lịch.
    if (rawMappings.length === 0)
        return [];
    const normalized = [];
    const identities = new Set();
    for (const mapping of rawMappings) {
        const courseId = String(mapping?.course_id ?? '').trim();
        const rawLessonIds = Array.isArray(mapping?.lesson_ids)
            ? mapping.lesson_ids
            : Array.isArray(mapping?.lesson_id)
                ? mapping.lesson_id
                : [mapping?.lesson_id];
        const lessonIds = Array.from(new Set(rawLessonIds
            .map((lessonId) => String(lessonId ?? '').trim())
            .filter(Boolean)));
        const rawPackageIds = Array.isArray(mapping?.package_ids)
            ? mapping.package_ids
            : Array.isArray(mapping?.package_id)
                ? mapping.package_id
                : [mapping?.package_id];
        const packageIds = Array.from(new Set(rawPackageIds
            .map((packageId) => String(packageId ?? '').trim())
            .filter(Boolean)));
        if (!courseId)
            throw new Error("Course ID không được để trống");
        if (courseId.length > 50)
            throw new Error("Course ID vượt quá 50 ký tự");
        if (!lessonIds.length)
            throw new Error("Lesson ID không được để trống");
        if (lessonIds.some((lessonId) => !/^\d+$/.test(lessonId) || lessonId.length > 50)) {
            throw new Error("Lesson ID không hợp lệ");
        }
        if (packageIds.some((packageId) => !/^\d+$/.test(packageId) || packageId.length > 50)) {
            throw new Error("Package ID không hợp lệ");
        }
        const resolvedPackages = packageIds.length
            ? packageIds.map((packageId) => ({ package_id: packageId, course_id: courseId }))
            : await (0, package_course_sheet_service_1.resolvePackagesByCourseId)(courseId);
        if (!resolvedPackages.length) {
            throw new Error(`Không xác định được Package ID cho Course ${courseId}`);
        }
        for (const packageCourse of resolvedPackages) {
            for (const lessonId of lessonIds) {
                const identity = `${packageCourse.package_id}::${courseId}::${lessonId}`;
                if (identities.has(identity))
                    continue;
                identities.add(identity);
                normalized.push({
                    package_id: packageCourse.package_id,
                    course_id: courseId,
                    lesson_id: lessonId,
                });
            }
        }
    }
    return normalized;
};
const createPackageLessonMappingForCalendar = async (tx, calendar, mappings) => {
    for (const mapping of mappings) {
        await tx.$executeRaw `
      INSERT INTO package_lesson_mapping (
        package_id, course_id, lesson_id, code, learn_number, \`key\`
      ) VALUES (
        ${mapping.package_id},
        ${mapping.course_id},
        ${mapping.lesson_id},
        ${calendar.code},
        ${calendar.learn_number},
        ${calendar.key}
      )
      ON DUPLICATE KEY UPDATE
        course_id = VALUES(course_id),
        code = VALUES(code),
        learn_number = VALUES(learn_number)
    `;
    }
};
// Bản ghi nghỉ luôn dùng key mới nên có thể sao chép toàn bộ mapping trong
// một câu lệnh. Cách này giảm đáng kể số query khi nghỉ và tạo bù hàng loạt.
const copyPackageLessonMappingsForCalendar = async (tx, calendar, mappings) => {
    if (!mappings.length)
        return;
    await tx.package_lesson_mapping.createMany({
        data: mappings.map((mapping) => ({
            package_id: mapping.package_id,
            course_id: mapping.course_id,
            lesson_id: mapping.lesson_id,
            code: calendar.code,
            learn_number: calendar.learn_number,
            key: calendar.key,
        })),
        skipDuplicates: true,
    });
};
const replacePackageLessonMappingForCalendar = async (tx, calendar, mappings) => {
    const key = String(calendar?.key || '').trim();
    if (!key) {
        throw new Error(`Buổi ${calendar?.id || ''}: Lịch học không có key để cập nhật mapping`);
    }
    const result = await (0, hocmai_sync_queue_service_1.reconcileCalendarMappingsAndEnqueue)(tx, calendar, mappings, crypto_1.default.randomUUID(), 1, false, true);
    if (result.changed) {
        await tx.calendar.update({
            where: { id: Number(calendar.id) },
            data: { updated_at: new Date() },
        });
    }
    return result;
};
const assertMappingsBelongToCalendarLesson = async (tx, calendar, mappings) => {
    if (!mappings.length)
        return;
    if (calendar?.session_id == null) {
        throw new Error(`Buổi ${calendar?.id || ''} chưa gắn bài học nội bộ để xác định Course ID`);
    }
    const lessonCourses = await tx.$queryRaw(client_1.Prisma.sql `
    SELECT package_id, course_id
    FROM lesson_course_mapping
    WHERE lesson_id = ${BigInt(calendar.session_id)}
  `);
    const allowed = new Set(lessonCourses.map((mapping) => `${mapping.package_id}::${mapping.course_id}`));
    const invalid = mappings.find((mapping) => !allowed.has(`${mapping.package_id}::${mapping.course_id}`));
    if (invalid) {
        throw new Error(`Course ID ${invalid.course_id} không thuộc bài học nội bộ của buổi ${calendar.id}`);
    }
};
const mappingLabel = (mappings) => mappings
    .map((mapping) => [
    mapping.package_id ? `Package ${mapping.package_id}` : undefined,
    mapping.course_id ? `Course ${mapping.course_id}` : undefined,
    mapping.lesson_id ? `Lesson ${mapping.lesson_id}` : undefined,
].filter(Boolean).join(' → '))
    .join('; ');
const loadMappingsByKeys = async (client, keys) => {
    if (!keys.length)
        return new Map();
    const mappings = await client.package_lesson_mapping.findMany({
        where: { key: { in: keys } },
        orderBy: [{ id: 'asc' }],
    });
    const byKey = new Map();
    mappings.forEach((mapping) => {
        if (!mapping.key)
            return;
        const rows = byKey.get(mapping.key) ?? [];
        rows.push(mapping);
        byKey.set(mapping.key, rows);
    });
    return byKey;
};
const generateUniqueCanceledKey = async (tx, sourceKey) => {
    const normalizedKey = String(sourceKey || '').trim();
    if (!normalizedKey) {
        throw new Error("Lịch học không có key để đánh dấu hủy");
    }
    let canceledNumber = 1;
    let key = `${normalizedKey}_huy`;
    while (await tx.calendar.findFirst({ where: { key, deleted_at: {} } })) {
        canceledNumber += 1;
        key = `${normalizedKey}_huy${canceledNumber}`;
    }
    if (key.length > 100) {
        throw new Error("Key lịch nghỉ vượt quá 100 ký tự");
    }
    return key;
};
const DEFAULT_CANCELED_LESSON_NAME_PREFIX = '[NGHỈ HỌC] ';
const DEFAULT_MAKEUP_LESSON_NAME_PREFIX = '[HỌC BÙ] ';
const normalizeLessonNameAffix = (value, fallback, fieldLabel) => {
    if (value == null || value === '')
        return fallback;
    if (typeof value !== 'string') {
        throw new Error(`${fieldLabel} phải là chuỗi ký tự`);
    }
    // Giữ nguyên khoảng trắng mà người dùng chủ động nhập ở cuối tiền tố hoặc
    // đầu hậu tố, ví dụ "[NGHỈ HỌC] " phải tạo thành "[NGHỈ HỌC] Tên bài".
    return value;
};
const formatRescheduledLessonName = (lessonName, prefix, suffix) => {
    const baseName = String(lessonName ?? '').trim();
    const formatted = `${prefix}${baseName}${suffix}`.trim();
    if (formatted.length > 400) {
        throw new Error('Tên bài sau khi thêm tiền tố/hậu tố không được vượt quá 400 ký tự');
    }
    return formatted;
};
const getRescheduleLessonNameOptions = (payload) => ({
    canceledLessonName: (lessonName) => formatRescheduledLessonName(lessonName, normalizeLessonNameAffix(payload?.canceled_lesson_name_prefix, DEFAULT_CANCELED_LESSON_NAME_PREFIX, 'Tiền tố tên bài nghỉ'), normalizeLessonNameAffix(payload?.canceled_lesson_name_suffix, '', 'Hậu tố tên bài nghỉ')),
    makeupLessonName: (lessonName) => formatRescheduledLessonName(lessonName, normalizeLessonNameAffix(payload?.new_lesson_name_prefix, DEFAULT_MAKEUP_LESSON_NAME_PREFIX, 'Tiền tố tên bài mới'), normalizeLessonNameAffix(payload?.new_lesson_name_suffix, '', 'Hậu tố tên bài mới')),
});
const padSchedulePart = (value) => String(value).padStart(2, '0');
// Calendar timestamps are handled as Vietnam wall-clock values throughout this
// service (via UTC date parts), so conflict messages must follow the same rule.
const formatScheduleDateTime = (value) => (`${padSchedulePart(value.getUTCDate())}/${padSchedulePart(value.getUTCMonth() + 1)}/${value.getUTCFullYear()} `
    + `${padSchedulePart(value.getUTCHours())}:${padSchedulePart(value.getUTCMinutes())}`);
const formatScheduleRange = (startTime, endTime) => (`${formatScheduleDateTime(startTime)}–${formatScheduleDateTime(endTime)}`);
const describeConflictSchedule = (schedule) => {
    const identity = [
        schedule.code ? `khóa ${schedule.code}` : null,
        schedule.learn_number ? `Bài ${schedule.learn_number}` : null,
        schedule.lesson_name ? `“${schedule.lesson_name}”` : null,
        schedule.id ? `ID lịch ${schedule.id}` : null,
    ].filter(Boolean).join(', ');
    const time = formatScheduleRange(schedule.start_time, schedule.end_time);
    return identity ? `${identity} (${time})` : `lịch ${schedule.id || '-'} (${time})`;
};
class ScheduleConflictError extends Error {
    conflicts;
    constructor(conflicts) {
        const lines = conflicts.map((conflict) => (`• ${conflict.staff_type === 'course' ? 'Khóa học' : conflict.staff_type === 'teacher' ? 'Giáo viên' : 'Trợ giảng'} “${conflict.username}”: `
            + describeConflictSchedule(conflict)
            + (conflict.shared_schedule_mismatch?.length
                ? `\n  Đã bật cho phép trùng nhưng chưa đủ điều kiện:\n${conflict.shared_schedule_mismatch.map((reason) => `  - ${reason}`).join('\n')}`
                : '')));
        super(`Lịch đang cập nhật bị trùng với ${conflicts.length} lịch:\n${lines.join('\n')}`);
        this.name = 'ScheduleConflictError';
        this.conflicts = conflicts;
    }
}
exports.ScheduleConflictError = ScheduleConflictError;
// UI và dữ liệu nghiệp vụ chỉ thao tác tới phút. Một số bản ghi cũ còn giây
// nên 09:30:30 từng bị xem là chồng với buổi bắt đầu 09:30 dù cùng hiển thị
// 09:30. Kiểm tra conflict theo đúng độ chính xác mà người dùng nhìn thấy.
const scheduleMinute = (value) => {
    const minute = new Date(value);
    minute.setUTCSeconds(0, 0);
    return minute.getTime();
};
const timeRangesOverlap = (leftStart, leftEnd, rightStart, rightEnd) => scheduleMinute(leftStart) < scheduleMinute(rightEnd)
    && scheduleMinute(leftEnd) > scheduleMinute(rightStart);
const normalizeSharedLessonTitle = (value) => typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
// Compare each pair independently; an unrelated overlap must still reject
// the entire request, even when another pair is a valid shared session.
const isSharedStaffSession = (left, right, options) => options.allow_shared_staff_schedule === true
    && Boolean(left.code && right.code && left.code !== right.code)
    && Boolean(normalizeSharedLessonTitle(left.lesson_name))
    && normalizeSharedLessonTitle(left.lesson_name) === normalizeSharedLessonTitle(right.lesson_name)
    && scheduleMinute(left.start_time) === scheduleMinute(right.start_time)
    && scheduleMinute(left.end_time) === scheduleMinute(right.end_time);
// Explain rejected opt-in requests without changing conflict eligibility.
const sharedStaffMismatchReasons = (requested, existing, options) => {
    if (options.allow_shared_staff_schedule !== true)
        return undefined;
    const reasons = [];
    if (!requested.code || !existing.code) {
        reasons.push('Thiếu mã chương trình để đối chiếu buổi học chung.');
    }
    else if (requested.code === existing.code) {
        reasons.push(`Hai lịch cùng chương trình “${requested.code}”; chỉ cho phép buổi học chung giữa các chương trình khác nhau.`);
    }
    const requestedTitle = normalizeSharedLessonTitle(requested.lesson_name);
    const existingTitle = normalizeSharedLessonTitle(existing.lesson_name);
    if (!requestedTitle || !existingTitle) {
        reasons.push('Thiếu tên bài học; cần có tên bài ở cả hai lịch để đối chiếu.');
    }
    else if (requestedTitle !== existingTitle) {
        reasons.push(`Tên bài không khớp: lịch đang thao tác “${requested.lesson_name}”; lịch đối chiếu “${existing.lesson_name}”.`);
    }
    if (scheduleMinute(requested.start_time) !== scheduleMinute(existing.start_time)) {
        reasons.push(`Giờ bắt đầu không khớp: lịch đang thao tác ${formatScheduleDateTime(requested.start_time)}; lịch đối chiếu ${formatScheduleDateTime(existing.start_time)}.`);
    }
    if (scheduleMinute(requested.end_time) !== scheduleMinute(existing.end_time)) {
        reasons.push(`Giờ kết thúc không khớp: lịch đang thao tác ${formatScheduleDateTime(requested.end_time)}; lịch đối chiếu ${formatScheduleDateTime(existing.end_time)}.`);
    }
    return reasons;
};
// 1.3 & 5 Kiểm tra trùng lặp
const checkConflict = async ({ calendar_source, teacher, assistant_teacher, channel_name, code, start_time, end_time, id, ignoredIds = [], lesson_name, allow_shared_staff_schedule, client = calendar_transaction_2.default, }) => {
    ensureValidTimeRange(start_time, end_time);
    const source = calendar_source === undefined ? (0, calendar_source_1.calendarSourceFromCode)(code) : (0, calendar_source_1.resolveCalendarSource)(calendar_source);
    const excludedIds = Array.from(new Set([
        ...ignoredIds,
        ...(id ? [id] : []),
    ].filter((value) => Number.isInteger(value) && value > 0)));
    const conflicts = [];
    const isSharedSession = (session) => isSharedStaffSession({ code, lesson_name, start_time, end_time }, session, { allow_shared_staff_schedule });
    const mismatchReasons = (session) => sharedStaffMismatchReasons({ code, lesson_name, start_time, end_time }, session, { allow_shared_staff_schedule });
    if (teacher) {
        const possibleTeacherConflicts = await client.calendar.findMany({
            where: {
                AND: [{ code: source === 'feed' ? { startsWith: 'feed-' } : { not: { startsWith: 'feed-' } } }],
                teacher,
                start_time: { lt: end_time },
                end_time: { gt: start_time },
                OR: [
                    { lesson_status: null },
                    { lesson_status: { not: 1 } },
                ],
                id: excludedIds.length ? { notIn: excludedIds } : undefined
            }
        });
        const teacherConflicts = possibleTeacherConflicts
            .filter((session) => timeRangesOverlap(start_time, end_time, session.start_time, session.end_time)
            && !isSharedSession(session))
            .map((session) => ({
            calendar_source: source,
            id: Number(session.id),
            code: session.code ?? null,
            learn_number: session.learn_number ?? null,
            lesson_name: session.lesson_name ?? null,
            start_time: session.start_time,
            end_time: session.end_time,
            staff_type: 'teacher',
            username: teacher,
            shared_schedule_mismatch: mismatchReasons(session),
        }));
        conflicts.push(...teacherConflicts);
    }
    const assistantTeachers = parseAssistantTeachers(assistant_teacher);
    if (assistantTeachers.length) {
        const overlappingSessions = await client.$queryRaw(client_1.Prisma.sql `
      SELECT id, code, learn_number, lesson_name, start_time, end_time, assistant_teacher
      FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar
      WHERE ${source === 'feed' ? client_1.Prisma.sql `code LIKE 'feed-%'` : client_1.Prisma.sql `code NOT LIKE 'feed-%'`}
        AND start_time < ${end_time}
        AND end_time > ${start_time}
        AND COALESCE(lesson_status, 0) <> 1
        AND assistant_teacher IS NOT NULL
        ${excludedIds.length
            ? client_1.Prisma.sql `AND id NOT IN (${client_1.Prisma.join(excludedIds)})`
            : client_1.Prisma.empty}
    `);
        const assistantConflicts = [];
        for (const session of overlappingSessions) {
            if (!timeRangesOverlap(start_time, end_time, session.start_time, session.end_time))
                continue;
            if (isSharedSession(session))
                continue;
            const assigned = new Set(parseAssistantTeachers(session.assistant_teacher));
            for (const username of assistantTeachers.filter((item) => assigned.has(item))) {
                assistantConflicts.push({
                    calendar_source: source,
                    id: Number(session.id),
                    code: session.code ?? null,
                    learn_number: session.learn_number ?? null,
                    lesson_name: session.lesson_name ?? null,
                    start_time: session.start_time,
                    end_time: session.end_time,
                    staff_type: 'assistant',
                    username,
                    shared_schedule_mismatch: mismatchReasons(session),
                });
            }
        }
        conflicts.push(...assistantConflicts);
    }
    // if (channel_name) {
    //   const conflictRoom = await client.calendar.findFirst({
    //     where: {
    //       channel_name,
    //       start_time: { lt: end_time },
    //       end_time: { gt: start_time },
    //       id: id ? { not: id } : undefined
    //     }
    //   });
    //   if (conflictRoom) throw new Error("Trùng lịch phòng học");
    // }
    if (code) {
        const possibleCourseConflicts = await client.calendar.findMany({
            where: {
                AND: [{ code: source === 'feed' ? { startsWith: 'feed-' } : { not: { startsWith: 'feed-' } } }],
                code,
                start_time: { lt: end_time },
                end_time: { gt: start_time },
                OR: [
                    { lesson_status: null },
                    { lesson_status: { not: 1 } },
                ],
                id: excludedIds.length ? { notIn: excludedIds } : undefined
            }
        });
        const courseConflicts = possibleCourseConflicts.filter((session) => timeRangesOverlap(start_time, end_time, session.start_time, session.end_time));
        conflicts.push(...courseConflicts.map((session) => ({
            calendar_source: source,
            id: Number(session.id),
            code: session.code ?? null,
            learn_number: session.learn_number ?? null,
            lesson_name: session.lesson_name ?? null,
            start_time: session.start_time,
            end_time: session.end_time,
            staff_type: 'course',
            username: code,
            shared_schedule_mismatch: mismatchReasons(session),
        })));
    }
    const uniqueConflicts = Array.from(new Map(conflicts.map((conflict) => [conflict.id, conflict])).values());
    if (uniqueConflicts.length)
        throw new ScheduleConflictError(uniqueConflicts);
};
exports.checkConflict = checkConflict;
const schedulesOverlap = (left, right) => (timeRangesOverlap(left.start_time, left.end_time, right.start_time, right.end_time));
/** Kiểm tra xung đột trên trạng thái cuối của cả lô, không dựa vào trạng thái tạm khi UPDATE tuần tự. */
const validateBulkFinalStateConflicts = (candidates, options = {}) => {
    candidates.forEach((candidate) => ensureValidTimeRange(candidate.start_time, candidate.end_time));
    candidates = candidates.filter((candidate) => Number(candidate.lesson_status) !== 1);
    const conflicts = new Map();
    const addPair = (left, right, staff_type, username) => {
        for (const candidate of [left, right]) {
            if (!conflicts.has(candidate.id))
                conflicts.set(candidate.id, {
                    ...candidate,
                    code: candidate.code ?? null,
                    learn_number: candidate.learn_number ?? null,
                    lesson_name: candidate.lesson_name ?? null,
                    staff_type,
                    username,
                    shared_schedule_mismatch: sharedStaffMismatchReasons(candidate === left ? right : left, candidate, options),
                });
        }
    };
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const left = candidates[leftIndex];
            const right = candidates[rightIndex];
            if ((0, calendar_source_1.calendarSourceFromCode)(left.code) !== (0, calendar_source_1.calendarSourceFromCode)(right.code) || !schedulesOverlap(left, right))
                continue;
            if (isSharedStaffSession(left, right, options))
                continue;
            if (left.teacher && right.teacher && left.teacher === right.teacher) {
                addPair(left, right, 'teacher', left.teacher);
            }
        }
    }
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const left = candidates[leftIndex];
            const right = candidates[rightIndex];
            if ((0, calendar_source_1.calendarSourceFromCode)(left.code) !== (0, calendar_source_1.calendarSourceFromCode)(right.code) || !schedulesOverlap(left, right))
                continue;
            if (isSharedStaffSession(left, right, options))
                continue;
            const rightAssistants = new Set(parseAssistantTeachers(right.assistant_teacher));
            const conflictAssistant = parseAssistantTeachers(left.assistant_teacher)
                .find((username) => rightAssistants.has(username));
            if (conflictAssistant) {
                addPair(left, right, 'assistant', conflictAssistant);
            }
        }
    }
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const left = candidates[leftIndex];
            const right = candidates[rightIndex];
            if ((0, calendar_source_1.calendarSourceFromCode)(left.code) === (0, calendar_source_1.calendarSourceFromCode)(right.code) && schedulesOverlap(left, right) && left.code && right.code && left.code === right.code) {
                addPair(left, right, 'course', left.code);
            }
        }
    }
    if (conflicts.size)
        throw new ScheduleConflictError(Array.from(conflicts.values()));
};
exports.validateBulkFinalStateConflicts = validateBulkFinalStateConflicts;
/** Gom xung đột trong lô và với lịch ngoài lô trước khi ghi bất kỳ thay đổi nào. */
const validateBulkScheduleConflicts = async (candidates, ignoredIds, client = calendar_transaction_2.default, now = (0, dateTime_1.getVietnamWallClockDate)(), options = {}) => {
    // Lịch cũ có thể trùng từ trước. Khi sửa mapping HMO, không để xung đột
    // lịch sử chặn cập nhật; chỉ kiểm tra xung đột cho buổi chưa bắt đầu.
    candidates.forEach((candidate) => ensureValidTimeRange(candidate.start_time, candidate.end_time));
    candidates = candidates.filter((candidate) => candidate.start_time > now);
    const conflicts = new Map();
    const collect = (error) => {
        if (!(error instanceof ScheduleConflictError))
            throw error;
        for (const conflict of error.conflicts) {
            if (!conflicts.has(conflict.id))
                conflicts.set(conflict.id, conflict);
        }
    };
    try {
        (0, exports.validateBulkFinalStateConflicts)(candidates, options);
    }
    catch (error) {
        collect(error);
    }
    for (const candidate of candidates) {
        if (Number(candidate.lesson_status) === 1)
            continue;
        try {
            await (0, exports.checkConflict)({
                ...candidate, code: candidate.code ?? undefined, ignoredIds, client,
                allow_shared_staff_schedule: options.allow_shared_staff_schedule,
            });
        }
        catch (error) {
            collect(error);
        }
    }
    if (conflicts.size)
        throw new ScheduleConflictError(Array.from(conflicts.values()).sort((left, right) => left.start_time.getTime() - right.start_time.getTime() || left.id - right.id));
};
exports.validateBulkScheduleConflicts = validateBulkScheduleConflicts;
/** Chỉ kiểm tra xung đột khi dữ liệu ảnh hưởng đến xếp lịch thực sự thay đổi. */
const validateBulkScheduleChanges = async (candidates, currentSessions, client = calendar_transaction_2.default, now = (0, dateTime_1.getVietnamWallClockDate)(), options = {}) => {
    const currentById = new Map(currentSessions.map((session) => [Number(session.id), session]));
    const staffKey = (value) => parseAssistantTeachers(value).sort().join('\u0000');
    const changedCandidates = candidates.filter((candidate) => {
        const current = currentById.get(candidate.id);
        if (!current)
            return true;
        return scheduleMinute(candidate.start_time) !== scheduleMinute(current.start_time)
            || scheduleMinute(candidate.end_time) !== scheduleMinute(current.end_time)
            || String(candidate.teacher || '').trim() !== String(current.teacher || '').trim()
            || staffKey(candidate.assistant_teacher) !== staffKey(current.assistant_teacher)
            || candidate.code !== current.code
            || normalizeSharedLessonTitle(candidate.lesson_name) !== normalizeSharedLessonTitle(current.lesson_name)
            || Number(candidate.lesson_status || 0) !== Number(current.lesson_status || 0);
    });
    // Lịch không thay đổi vẫn là lịch đối chiếu bên ngoài lô, không được loại khỏi truy vấn.
    await (0, exports.validateBulkScheduleConflicts)(changedCandidates, changedCandidates.map((candidate) => candidate.id), client, now, options);
};
exports.validateBulkScheduleChanges = validateBulkScheduleChanges;
/** Report each swap conflict against the schedule being moved, including both A and B. */
const validateSwapScheduleConflicts = async (candidates, client = calendar_transaction_2.default) => {
    const conflicts = [];
    const collect = (error, target, index, internal = false) => {
        if (!(error instanceof ScheduleConflictError))
            throw error;
        for (const conflict of error.conflicts) {
            // Internal validation lists both schedules. For A, the conflicting schedule is B.
            if (internal && conflict.id === target.id)
                continue;
            conflicts.push({ ...conflict, swap_target: {
                    label: index === 0 ? 'A' : 'B', id: target.id,
                    start_time: target.start_time, end_time: target.end_time,
                } });
        }
    };
    try {
        (0, exports.validateBulkFinalStateConflicts)(candidates);
    }
    catch (error) {
        candidates.forEach((target, index) => collect(error, target, index, true));
    }
    for (const [index, target] of candidates.entries()) {
        try {
            await (0, exports.checkConflict)({ ...target, code: target.code ?? undefined,
                ignoredIds: candidates.map(item => item.id), client });
        }
        catch (error) {
            collect(error, target, index);
        }
    }
    if (conflicts.length)
        throw new ScheduleConflictError(conflicts);
};
exports.validateSwapScheduleConflicts = validateSwapScheduleConflicts;
// 1.1. Thêm từng lịch
const createSingleImpl = async (data, changeActor) => {
    (0, calendar_source_1.resolveCalendarSource)(data?.calendar_source);
    const resolvedMappings = await resolvePackageLessonMappings(data?.package_lesson_mappings);
    return await withCalendarTriggerErrorHint(() => calendar_transaction_2.default.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const { calendarData } = await prepareCalendarCreateData(tx, data);
        await (0, exports.checkConflict)({
            calendar_source: (0, calendar_source_1.calendarSourceFromCode)(calendarData.code),
            teacher: calendarData.teacher,
            assistant_teacher: calendarData.assistant_teacher,
            channel_name: calendarData.channel_name,
            code: calendarData.code,
            start_time: calendarData.start_time,
            end_time: calendarData.end_time,
            lesson_name: calendarData.lesson_name,
            allow_shared_staff_schedule: data.allow_shared_staff_schedule,
            client: tx,
        });
        const calendar = await createCalendarRecord(tx, calendarData);
        await createPackageLessonMappingForCalendar(tx, calendar, resolvedMappings);
        await (0, calendar_lifecycle_1.auditCalendarKeyReuse)(tx, calendar, changeActor);
        if (resolvedMappings.length) {
            await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, calendar[calendar_lifecycle_1.CALENDAR_KEY_REUSE]?.operationId ?? crypto_1.default.randomUUID(), 1, 'create', calendar);
        }
        await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
            eventType: 'created',
            after: calendar,
            actor: changeActor,
        });
        return calendar;
    })));
};
const getProgramLessonsForScheduling = async (programCode, source) => {
    if (source !== undefined)
        (0, calendar_source_1.resolveCalendarSource)(source);
    const code = String(programCode || '').trim();
    if (!code)
        throw new Error('Vui lòng chọn Chương trình');
    const rows = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
    SELECT lesson.id, lesson.learn_number, lesson.lesson_name, lesson.system_type,
      (
        SELECT COUNT(*)
        FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar_row
        WHERE calendar_row.code = ${code}
          AND (
            calendar_row.session_id = lesson.id
            OR calendar_row.learn_number = lesson.learn_number
          )
      ) AS scheduled_count,
      (
        SELECT COUNT(*)
        FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar_row
        WHERE calendar_row.code = ${code}
          AND calendar_row.start_time <= NOW()
          AND (
            calendar_row.session_id = lesson.id
            OR calendar_row.learn_number = lesson.learn_number
          )
      ) AS past_scheduled_count
    FROM lessons AS lesson
    WHERE lesson.subject_code = ${code} AND lesson.status <> 0
    ORDER BY lesson.learn_number ASC, lesson.id ASC
  `);
    return rows.map((row) => ({
        ...row,
        id: String(row.id),
        scheduled_count: Number(row.scheduled_count),
        past_scheduled_count: Number(row.past_scheduled_count),
    }));
};
exports.getProgramLessonsForScheduling = getProgramLessonsForScheduling;
const getSchedulingPrograms = async (allowedPrograms = null) => {
    const rows = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
    SELECT program.code,
           COALESCE(
             MAX(CASE
               WHEN program.subject_name IS NOT NULL
                AND TRIM(program.subject_name) <> ''
                AND TRIM(program.subject_name) <> TRIM(program.code)
               THEN program.subject_name
             END),
             MAX(program.subject_name)
           ) AS subject_name
    FROM (
      SELECT subject_code AS code, subject_name
      FROM lessons
      WHERE subject_code IS NOT NULL AND TRIM(subject_code) <> ''
      UNION ALL
      SELECT code, subject AS subject_name
      FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar
      WHERE code IS NOT NULL AND TRIM(code) <> ''
    ) AS program
    GROUP BY program.code
    ORDER BY subject_name ASC, program.code ASC
  `);
    return rows
        .filter((row) => allowedPrograms === null || allowedPrograms.includes(row.code))
        .map((row) => ({
        code: row.code,
        subject_name: row.subject_name,
    }));
};
exports.getSchedulingPrograms = getSchedulingPrograms;
const normalizeHocmaiBatchLessonIds = (lessonIds) => {
    if (!Array.isArray(lessonIds) || !lessonIds.length) {
        throw new Error('lesson_ids phải là danh sách không rỗng');
    }
    if (lessonIds.length > 500) {
        throw new Error('Chỉ được tải tối đa 500 bài học mỗi lần');
    }
    const rawLessonIds = lessonIds.map((lessonId) => String(lessonId).trim());
    if (rawLessonIds.some((lessonId) => !/^\d+$/.test(lessonId) || BigInt(lessonId) <= 0n)) {
        throw new Error('Danh sách bài học không hợp lệ');
    }
    return Array.from(new Set(rawLessonIds.map((lessonId) => String(BigInt(lessonId)))));
};
const getHocmaiSectionsForProgramLessons = async (programCode, lessonIds) => {
    const code = String(programCode || '').trim();
    if (!code)
        throw new Error('Chương trình không hợp lệ');
    const normalizedLessonIds = normalizeHocmaiBatchLessonIds(lessonIds);
    const parsedLessonIds = normalizedLessonIds.map((lessonId) => BigInt(lessonId));
    const byLessonId = Object.fromEntries(normalizedLessonIds.map((lessonId) => [lessonId, []]));
    const mappings = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
    SELECT DISTINCT mapping.lesson_id, mapping.package_id, mapping.course_id
    FROM lesson_course_mapping AS mapping
    INNER JOIN lessons AS lesson ON lesson.id = mapping.lesson_id
    WHERE lesson.id IN (${client_1.Prisma.join(parsedLessonIds)})
      AND lesson.subject_code = ${code}
      AND lesson.status <> 0
    ORDER BY mapping.lesson_id ASC, mapping.package_id ASC, mapping.course_id ASC
  `);
    if (!mappings.length) {
        return { by_lesson_id: byLessonId, errors_by_lesson_id: {} };
    }
    const pairKeysByLessonId = new Map();
    const uniquePairs = new Map();
    mappings.forEach((mapping) => {
        const lessonId = String(mapping.lesson_id);
        const pair = {
            packageId: String(mapping.package_id),
            courseId: String(mapping.course_id),
        };
        const pairKey = packageCourseKey(pair.packageId, pair.courseId);
        uniquePairs.set(pairKey, pair);
        const lessonPairs = pairKeysByLessonId.get(lessonId) || new Set();
        lessonPairs.add(pairKey);
        pairKeysByLessonId.set(lessonId, lessonPairs);
    });
    const optionsByPair = new Map();
    const errorsByPair = new Map();
    const missingPairs = [];
    const now = Date.now();
    uniquePairs.forEach((pair, pairKey) => {
        const cached = hmoSectionsByPackageCourseCache.get(pairKey);
        if (cached && cached.expiresAt > now) {
            optionsByPair.set(pairKey, cached.data);
            return;
        }
        if (cached)
            hmoSectionsByPackageCourseCache.delete(pairKey);
        missingPairs.push(pair);
    });
    if (missingPairs.length) {
        // Tách lỗi theo từng cặp để một Course HMO lỗi không làm mất dữ liệu của
        // tất cả lesson trong batch. Concurrency vẫn được giới hạn như luồng cũ.
        const configuredConcurrency = Number(process.env.HMO_COURSE_OUTLINE_CONCURRENCY || 5);
        const concurrency = Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
            ? Math.min(configuredConcurrency, 20)
            : 5;
        let nextPairIndex = 0;
        const worker = async () => {
            while (nextPairIndex < missingPairs.length) {
                const pair = missingPairs[nextPairIndex];
                nextPairIndex += 1;
                const pairKey = packageCourseKey(pair.packageId, pair.courseId);
                try {
                    const [outline] = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)([pair]);
                    const options = outline.lessons.map((lesson) => ({
                        package_id: outline.packageId,
                        course_id: outline.courseId,
                        lesson_id: lesson.lessonId,
                        lesson_name: lesson.name,
                        section_id: lesson.sectionId,
                        section_name: lesson.sectionName,
                        section_index: lesson.sectionIndex,
                        lesson_index: lesson.lessonIndex,
                    }));
                    optionsByPair.set(pairKey, options);
                    // Không cache danh sách rỗng: HMO có thể trả success trước khi hydrate lessons.
                    if (options.length) {
                        hmoSectionsByPackageCourseCache.set(pairKey, {
                            expiresAt: Date.now() + HMO_SECTIONS_CACHE_TTL_MS,
                            data: options,
                        });
                    }
                }
                catch (error) {
                    errorsByPair.set(pairKey, error?.message || 'Không thể tải dữ liệu HMO');
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, missingPairs.length) }, () => worker()));
    }
    const errorsByLessonId = {};
    pairKeysByLessonId.forEach((pairKeys, lessonId) => {
        const uniqueOptions = new Map();
        const lessonErrors = [];
        pairKeys.forEach((pairKey) => {
            const pairError = errorsByPair.get(pairKey);
            if (pairError)
                lessonErrors.push(pairError);
            (optionsByPair.get(pairKey) || []).forEach((option) => {
                const optionKey = JSON.stringify([
                    option.package_id,
                    option.course_id,
                    option.lesson_id,
                ]);
                uniqueOptions.set(optionKey, option);
            });
        });
        byLessonId[lessonId] = Array.from(uniqueOptions.values());
        if (lessonErrors.length)
            errorsByLessonId[lessonId] = Array.from(new Set(lessonErrors));
    });
    return {
        by_lesson_id: byLessonId,
        errors_by_lesson_id: errorsByLessonId,
    };
};
exports.getHocmaiSectionsForProgramLessons = getHocmaiSectionsForProgramLessons;
const getHocmaiSectionsForProgramLesson = async (programCode, lessonId) => {
    const normalizedLessonId = String(lessonId || '').trim();
    const result = await (0, exports.getHocmaiSectionsForProgramLessons)(programCode, [normalizedLessonId]);
    const canonicalLessonId = /^\d+$/.test(normalizedLessonId)
        ? String(BigInt(normalizedLessonId))
        : normalizedLessonId;
    const errors = result.errors_by_lesson_id[canonicalLessonId];
    if (errors?.length)
        throw new Error(errors[0]);
    return result.by_lesson_id[canonicalLessonId] || [];
};
exports.getHocmaiSectionsForProgramLesson = getHocmaiSectionsForProgramLesson;
// 1.2. Thêm nhiều lịch
const createBulkImpl = async (config, changeActor) => {
    // We assume frontend sends fully constructed objects in an array "calendars"
    const { calendars } = config;
    if (config.calendar_source !== undefined) {
        (0, calendar_source_1.resolveCalendarSource)(config.calendar_source);
        throw new ApiError_1.default('Khai báo calendar_source trên từng phần tử calendars', 400);
    }
    if (!calendars || !Array.isArray(calendars)) {
        throw new Error("Missing calendars array for bulk insert");
    }
    calendars.forEach((calendar) => (0, calendar_source_1.resolveCalendarSource)(calendar?.calendar_source));
    const reservedCounts = new Map();
    const resolvedMappingsByIndex = [];
    for (const calendar of calendars) {
        resolvedMappingsByIndex.push(await resolvePackageLessonMappings(calendar?.package_lesson_mappings));
    }
    // Tạo lịch tự động có thể gồm hàng chục bài, và mỗi bài còn đồng bộ nhân sự,
    // mapping HMO, queue và outbox thông báo. Timeout mặc định 5 giây của Prisma
    // làm transaction bị đóng giữa lô dù dữ liệu vẫn hoàn toàn hợp lệ.
    const configuredTimeout = Number(process.env.CALENDAR_BULK_CREATE_TRANSACTION_TIMEOUT_MS || 180_000);
    const transactionTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 180_000;
    return await withCalendarTriggerErrorHint(() => calendar_transaction_2.default.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const createdCalendars = [];
        const teamsEvents = [];
        // Toàn bộ bài học của lô được đọc và khóa chia sẻ bằng một query thay vì
        // SELECT từng session_id. Map cũng giúp giữ nguyên lỗi theo đúng buổi.
        const sessionIds = Array.from(new Set(calendars.flatMap((calendar) => {
            const rawSessionId = calendar?.session_id ?? calendar?.sessionId;
            if (rawSessionId === undefined || rawSessionId === null || rawSessionId === '')
                return [];
            try {
                return [BigInt(rawSessionId)];
            }
            catch {
                return [];
            }
        }).map((sessionId) => sessionId.toString()))).map((sessionId) => BigInt(sessionId));
        const lessons = sessionIds.length
            ? await tx.$queryRaw(client_1.Prisma.sql `
          SELECT *
          FROM lessons
          WHERE id IN (${client_1.Prisma.join(sessionIds)})
            AND status <> 0
          FOR SHARE
        `)
            : [];
        const lessonCache = new Map(lessons.map((lesson) => [String(lesson.id), lesson]));
        for (let index = 0; index < calendars.length; index += 1) {
            const cal = calendars[index];
            try {
                const { calendarData } = await prepareCalendarCreateData(tx, cal, reservedCounts, lessonCache);
                await (0, exports.checkConflict)({
                    calendar_source: (0, calendar_source_1.calendarSourceFromCode)(calendarData.code),
                    teacher: calendarData.teacher,
                    assistant_teacher: calendarData.assistant_teacher,
                    channel_name: calendarData.channel_name,
                    code: calendarData.code,
                    start_time: calendarData.start_time,
                    end_time: calendarData.end_time,
                    lesson_name: calendarData.lesson_name,
                    allow_shared_staff_schedule: config.allow_shared_staff_schedule,
                    client: tx,
                });
                const calendar = await createCalendarRecord(tx, calendarData);
                await createPackageLessonMappingForCalendar(tx, calendar, resolvedMappingsByIndex[index]);
                await (0, calendar_lifecycle_1.auditCalendarKeyReuse)(tx, calendar, changeActor);
                if (resolvedMappingsByIndex[index].length) {
                    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, calendar[calendar_lifecycle_1.CALENDAR_KEY_REUSE]?.operationId ?? crypto_1.default.randomUUID(), 1, 'create', calendar);
                }
                teamsEvents.push({
                    eventType: 'created',
                    after: calendar,
                    actor: changeActor,
                });
                createdCalendars.push(calendar);
            }
            catch (error) {
                const lessonLabel = cal.lesson_name ? ` (${cal.lesson_name})` : '';
                const message = `Buổi ${index + 1}${lessonLabel}: ${error.message || 'Không thể tạo lịch học'}`;
                if (error instanceof ScheduleConflictError) {
                    error.message = message;
                    throw error;
                }
                throw new Error(message);
            }
        }
        // Một INSERT nhiều dòng cho outbox thay vì một INSERT cho từng buổi.
        await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, teamsEvents);
        return { count: createdCalendars.length, calendars: createdCalendars };
    }), {
        isolationLevel: client_1.Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: transactionTimeout,
    }));
};
const createValidatedCalendarImportImpl = async (rows, changeActor) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Không có lịch hợp lệ để import');
    }
    rows.forEach((row) => (0, calendar_source_1.resolveCalendarSource)(row.calendar.calendar_source));
    const timeout = Number(process.env.CALENDAR_IMPORT_TRANSACTION_TIMEOUT_MS || 180_000);
    return withCalendarTriggerErrorHint(async () => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                return await calendar_transaction_2.default.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
                    // Khởi tạo lại ở mỗi lần retry để lesson_count không bị giữ từ
                    // transaction trước đã rollback.
                    const reservedCounts = new Map();
                    const createdCalendars = [];
                    for (const row of rows) {
                        try {
                            const { calendarData } = await prepareCalendarCreateData(tx, row.calendar, reservedCounts);
                            await (0, exports.checkConflict)({
                                calendar_source: (0, calendar_source_1.calendarSourceFromCode)(calendarData.code),
                                teacher: calendarData.teacher,
                                assistant_teacher: calendarData.assistant_teacher,
                                channel_name: calendarData.channel_name,
                                code: calendarData.code,
                                start_time: calendarData.start_time,
                                end_time: calendarData.end_time,
                                client: tx,
                            });
                            const calendar = await createCalendarRecord(tx, calendarData);
                            await createPackageLessonMappingForCalendar(tx, calendar, row.mappings);
                            await (0, calendar_lifecycle_1.auditCalendarKeyReuse)(tx, calendar, changeActor);
                            if (row.mappings.length) {
                                await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, calendar[calendar_lifecycle_1.CALENDAR_KEY_REUSE]?.operationId ?? crypto_1.default.randomUUID(), 1, 'create', calendar);
                            }
                            await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                                eventType: 'created', after: calendar, actor: changeActor,
                            });
                            createdCalendars.push(calendar);
                        }
                        catch (error) {
                            throw new Error(`Dòng ${row.row}: ${error?.message || 'Không thể tạo lịch học'}`);
                        }
                    }
                    return { count: createdCalendars.length, calendars: createdCalendars };
                }), {
                    isolationLevel: client_1.Prisma.TransactionIsolationLevel.ReadCommitted,
                    maxWait: 10_000,
                    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 180_000,
                });
            }
            catch (error) {
                if (!isTransactionConflict(error) || attempt === 3)
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, attempt * 150));
            }
        }
        throw new Error('Không thể hoàn tất import lịch học sau 3 lần thử');
    });
};
const createValidatedInternalCalendarImportImpl = async (rows, changeActor) => {
    if (!rows.length)
        throw new Error('Không có lịch hợp lệ để import');
    rows.forEach((row) => (0, calendar_source_1.resolveCalendarSource)(row.calendar.calendar_source));
    const codes = Array.from(new Set(rows.map((row) => row.calendar.code)));
    return withCalendarTriggerErrorHint(() => calendar_transaction_2.default.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const existingCounts = await tx.$queryRaw(client_1.Prisma.sql `
        SELECT code, system_type, learn_number,
               MAX(COALESCE(lesson_count, -1)) AS max_count
        FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar
        WHERE code IN (${client_1.Prisma.join(codes)})
        GROUP BY code, system_type, learn_number
      `);
        const nextCounts = new Map(existingCounts.map((item) => [
            lessonIdentityKey(item.code, item.system_type, item.learn_number, (0, calendar_source_1.calendarSourceFromCode)(item.code)),
            Number(item.max_count ?? -1) + 1,
        ]));
        const prepared = await Promise.all(rows.map(async (row) => {
            const calendar = row.calendar;
            (0, calendar_source_1.assertCalendarSourceUnchanged)(calendar, calendar);
            const calendarSource = (0, calendar_source_1.calendarSourceFromCode)(calendar.code);
            const startTime = new Date(calendar.start_time);
            const endTime = new Date(calendar.end_time);
            ensureValidTimeRange(startTime, endTime);
            const identity = lessonIdentityKey(calendar.code, calendar.system_type, calendar.learn_number, calendarSource);
            const lessonCount = calendar.lesson_count ?? nextCounts.get(identity) ?? 0;
            nextCounts.set(identity, lessonCount + 1);
            return {
                ...calendar,
                calendar_source: calendarSource,
                start_time: startTime,
                end_time: endTime,
                lesson_count: lessonCount,
                evg_banner: calendarSource === 'livestream'
                    ? await (0, program_teacher_banner_service_1.resolveProgramTeacherBanner)(tx, calendar.code, calendar.teacher)
                    : calendar.evg_banner,
                key: generateKey(calendar.system_type, startTime, calendar.code, calendar.learn_number, lessonCount, calendarSource),
            };
        }));
        const reusedKeys = new Map();
        for (const calendar of prepared) {
            const reuse = await (0, calendar_lifecycle_1.claimDeletedCalendarKey)(tx, calendar.key);
            if (reuse)
                reusedKeys.set(calendar.key, reuse);
        }
        const placeholders = prepared.map(() => ('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')).join(', ');
        const values = prepared.flatMap((calendar) => [
            calendar.session_id ?? null,
            calendar.code,
            calendar.learn_number,
            calendar.subject ?? null,
            calendar.start_time,
            calendar.end_time,
            calendar.teacher ?? null,
            calendar.assistant_teacher ?? null,
            calendar.lesson_name ?? null,
            calendar.lesson_document ?? null,
            calendar.evg_banner ?? null,
            calendar.evg_stream ?? null,
            calendar.lesson_count,
            calendar.lesson_status ?? 0,
            calendar.key,
            calendar.system_type,
        ]);
        await tx.$executeRawUnsafe(`INSERT INTO calendar (
          session_id, code, learn_number, subject, start_time, end_time,
          teacher, assistant_teacher, lesson_name, lesson_document,
          evg_banner, evg_stream, lesson_count, lesson_status, \`key\`,
          system_type, created_at, updated_at
        ) VALUES ${placeholders}`, ...values);
        const createdCalendars = await tx.calendar.findMany({
            where: { key: { in: prepared.map((calendar) => calendar.key) } },
        });
        for (const calendar of createdCalendars) {
            const reuse = reusedKeys.get(calendar.key);
            if (reuse) {
                Object.defineProperty(calendar, calendar_lifecycle_1.CALENDAR_KEY_REUSE, { value: reuse });
                await (0, calendar_lifecycle_1.auditCalendarKeyReuse)(tx, calendar, changeActor);
            }
        }
        for (let index = 0; index < prepared.length; index++) {
            if (!rows[index].mappings?.length)
                continue;
            const calendar = createdCalendars.find(calendar => calendar.key === prepared[index].key);
            if (!calendar)
                throw new Error('Không tìm thấy lịch vừa tạo để gán ID bài giảng');
            const operationId = crypto_1.default.randomUUID();
            await (0, hocmai_sync_queue_service_1.reconcileCalendarMappingsAndEnqueue)(tx, calendar, rows[index].mappings, operationId, index + 1, false);
            await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, operationId, index + 1, 'create', calendar);
        }
        const createdByKey = new Map(createdCalendars
            .filter((calendar) => calendar.key)
            .map((calendar) => [calendar.key, calendar]));
        await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, prepared.flatMap((calendar) => {
            const created = createdByKey.get(calendar.key);
            return created ? [{
                    eventType: 'created',
                    after: created,
                    actor: changeActor,
                }] : [];
        }));
        // Calendar và outbox Teams được ghi trong cùng transaction; lỗi ở bất kỳ
        // bước nào đều rollback toàn bộ import.
        return { count: prepared.length };
    }), {
        isolationLevel: client_1.Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10_000,
        timeout: 30_000,
    }));
};
const cancelWithoutMakeup = async (tx, current, payload, reason) => {
    const lessonNameOptions = getRescheduleLessonNameOptions(payload);
    const lessonNotification = shouldSendChangeNotification(payload) ? reason : null;
    return updateCalendarRecord(tx, current.id, {
        lesson_status: 1,
        cancel_reason: reason,
        lesson_noti: lessonNotification,
        lesson_name: lessonNameOptions.canceledLessonName(current.lesson_name),
        skip_teacher_user_sync: true,
    });
};
const cancelWithMakeup = async (tx, current, payload, reason, preloadedSourceMappings, canceledSource) => {
    // Mapping của key gốc vẫn phải giữ cho lịch bù. Đọc trước để copy riêng cho
    // bản ghi nghỉ có key _huy, từ đó HMO có đủ package/course/lesson để đồng bộ.
    const sourceKey = String(current.key || '').trim();
    if (!sourceKey)
        throw new Error('Lịch học không có key để dời lịch');
    const sourceMappings = preloadedSourceMappings ?? await tx.package_lesson_mapping.findMany({
        where: { key: sourceKey },
        orderBy: [{ id: 'asc' }],
    });
    // Giữ nguyên trigger: tạm tách mapping trong transaction để các thao tác
    // UPDATE/INSERT calendar bên dưới không tự tạo queue CRUD dư thừa.
    if (sourceMappings.length) {
        await tx.package_lesson_mapping.deleteMany({ where: { key: sourceKey } });
    }
    const lessonNameOptions = getRescheduleLessonNameOptions(payload);
    const lessonNotification = shouldSendChangeNotification(payload) ? reason : null;
    const newSessionInput = normalizeRoom({ ...(payload.new_session || payload) });
    delete newSessionInput.mode;
    delete newSessionInput.update_mode;
    delete newSessionInput.reason;
    delete newSessionInput.change_reason;
    delete newSessionInput.course_end_time;
    normalizeTeachingAssignmentsForScheduleUpdate(newSessionInput);
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
    ensureNotBeforeNow(startTime);
    ensureNotAfterCourseEnd(endTime, payload.course_end_time);
    await (0, exports.checkConflict)({
        calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
        teacher: newSessionInput.teacher ?? current.teacher,
        assistant_teacher: newSessionInput.assistant_teacher ?? current.assistant_teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const canceledKey = await generateUniqueCanceledKey(tx, current.key);
    const sourceSession = canceledSource || current;
    const newSessionData = {
        ...copySessionData(sourceSession),
        ...newSessionInput,
        calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? sourceSession.teacher,
        channel_name: newSessionInput.channel_name ?? sourceSession.channel_name,
        lesson_status: 0,
        lesson_count: normalizeLessonCount(current.lesson_count) ?? 0,
        key: current.key,
        lesson_name: lessonNameOptions.makeupLessonName(sourceSession.lesson_name),
    };
    // Giải phóng key gốc trước, sau đó gắn chính key đó cho lịch học bù.
    // Mapping không đổi vì vẫn trỏ đến key gốc đang hoạt động.
    const updatedCurrent = await updateCalendarRecord(tx, current.id, canceledSource
        ? { key: canceledKey, skip_teacher_user_sync: true }
        : {
            lesson_status: 1,
            cancel_reason: reason,
            lesson_noti: lessonNotification,
            key: canceledKey,
            lesson_name: lessonNameOptions.canceledLessonName(current.lesson_name),
            skip_teacher_user_sync: true,
        });
    await copyPackageLessonMappingsForCalendar(tx, updatedCurrent, sourceMappings);
    const createdSession = await createCalendarRecord(tx, newSessionData, current);
    await copyPackageLessonMappingsForCalendar(tx, createdSession, sourceMappings);
    return { canceled_session: updatedCurrent, created_session: createdSession };
};
const rescheduleFollowing = async (tx, current, payload, reason, canceledSource) => {
    // Các slot bị dời vẫn dùng key cũ nên mapping cũ được giữ nguyên. Chỉ bản
    // ghi nghỉ _huy cần một bản copy mapping để queue HMO không bỏ qua nó.
    const sourceKey = String(current.key || '').trim();
    if (!sourceKey)
        throw new Error('Lịch học không có key để dời lịch');
    const lessonNameOptions = getRescheduleLessonNameOptions(payload);
    const lessonNotification = shouldSendChangeNotification(payload) ? reason : null;
    const newSessionInput = normalizeRoom({ ...(payload.new_session || {}) });
    normalizeTeachingAssignmentsForScheduleUpdate(newSessionInput);
    if (!newSessionInput.start_time || !newSessionInput.end_time) {
        throw new Error("Vui lòng cung cấp new_session.start_time và new_session.end_time");
    }
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
    ensureNotBeforeNow(startTime);
    const lastCourseSession = await tx.calendar.findFirst({
        where: {
            code: current.code,
            system_type: current.system_type,
        },
        orderBy: [{ start_time: 'desc' }, { id: 'desc' }],
        select: { start_time: true },
    });
    const lastCourseStart = lastCourseSession?.start_time ?? current.start_time;
    ensureNotBeforeDate(startTime, lastCourseStart, "Ngày buổi mới không được trước ngày kết thúc khóa");
    ensureAfterStartOnSameDate(startTime, lastCourseStart);
    const followings = await tx.calendar.findMany({
        where: {
            code: current.code,
            system_type: current.system_type,
            start_time: { gt: current.start_time },
            OR: [
                { lesson_status: null },
                { lesson_status: { not: 1 } },
            ],
        },
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
    });
    await hydrateAssistantTeachers(tx, followings);
    const sourceSession = canceledSource || current;
    const allSessions = [sourceSession, ...followings];
    const lastSource = allSessions[allSessions.length - 1];
    // Không đổi trigger: tạm tách mapping của toàn bộ key sẽ xuất hiện trong các
    // UPDATE/INSERT calendar. Sau cùng mapping được khôi phục đúng theo từng key.
    const activeKeys = Array.from(new Set(allSessions
        .map((session) => String(session.key || '').trim())
        .filter(Boolean)));
    const activeMappings = activeKeys.length
        ? await tx.package_lesson_mapping.findMany({
            where: { key: { in: activeKeys } },
            orderBy: [{ id: 'asc' }],
        })
        : [];
    const mappingsByKey = new Map();
    activeMappings.forEach((mapping) => {
        const key = String(mapping.key || '');
        mappingsByKey.set(key, [...(mappingsByKey.get(key) || []), mapping]);
    });
    const sourceMappings = mappingsByKey.get(sourceKey) || [];
    if (activeKeys.length) {
        await tx.package_lesson_mapping.deleteMany({ where: { key: { in: activeKeys } } });
    }
    await (0, exports.checkConflict)({
        calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
        teacher: newSessionInput.teacher ?? lastSource.teacher,
        assistant_teacher: newSessionInput.assistant_teacher ?? lastSource.assistant_teacher,
        channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const canceledKey = await generateUniqueCanceledKey(tx, current.key);
    // Key gốc đi cùng lesson xuống slot kế tiếp. Row nghỉ dùng key riêng để
    // lưu lịch sử và không chiếm key đang hoạt động của lesson.
    const updatedCurrent = await updateCalendarRecord(tx, current.id, canceledSource
        ? { key: canceledKey, skip_teacher_user_sync: true }
        : {
            lesson_status: 1,
            cancel_reason: reason,
            lesson_noti: lessonNotification,
            key: canceledKey,
            lesson_name: lessonNameOptions.canceledLessonName(current.lesson_name),
            skip_teacher_user_sync: true,
        });
    await createPackageLessonMappingForCalendar(tx, updatedCurrent, sourceMappings);
    const shiftedSessions = [];
    for (let i = 0; i < followings.length; i++) {
        const targetSession = followings[i];
        const sourceSession = allSessions[i];
        if (!sourceSession.key) {
            throw new Error("Lịch học trong chuỗi không có key");
        }
        const updateData = {
            ...copySessionData(sourceSession),
            lesson_status: 0,
            key: sourceSession.key,
            skip_teacher_user_sync: true,
        };
        const shiftedSession = await updateCalendarRecord(tx, targetSession.id, updateData);
        shiftedSessions.push(shiftedSession);
    }
    if (!lastSource.key) {
        throw new Error("Buổi cuối chuỗi không có key");
    }
    const newSessionData = {
        ...copySessionData(lastSource),
        ...newSessionInput,
        calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? lastSource.teacher,
        channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
        lesson_status: 0,
        lesson_count: normalizeLessonCount(lastSource.lesson_count) ?? 0,
        key: lastSource.key,
    };
    const createdSession = await createCalendarRecord(tx, newSessionData);
    for (const source of allSessions) {
        const key = String(source.key || '').trim();
        if (key)
            await copyPackageLessonMappingsForCalendar(tx, source, mappingsByKey.get(key) || []);
    }
    return {
        canceled_session: updatedCurrent,
        shifted_sessions: shiftedSessions,
        created_session: createdSession,
    };
};
const rescheduleSessionInTransaction = async (tx, id, payload, changeActor, context) => {
    const mode = payload.mode || payload.update_mode || 'cancel';
    const reason = normalizeChangeReason(payload);
    const actor = normalizeChangeActor(changeActor);
    const operationId = crypto_1.default.randomUUID();
    // Đọc và validate bên trong transaction để không dùng snapshot cũ khi có
    // hai yêu cầu cùng dời lịch của một khóa.
    const current = context?.current ?? await tx.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    (0, calendar_source_1.assertCalendarSourceUnchanged)(current, payload);
    (0, calendar_source_1.assertCalendarSourceUnchanged)(current, payload.new_session);
    if (!context?.current)
        await hydrateAssistantTeachers(tx, [current]);
    const afterCancel = payload?.source_state === 'canceled_without_makeup';
    let canceledSource;
    if (afterCancel) {
        if (Number(current.lesson_status) !== 1) {
            throw new Error('Buổi học không ở trạng thái nghỉ học');
        }
        const latestChange = await tx.calendar_change_logs.findFirst({
            where: { calendar_id: current.id, action: { notIn: ['delete', 'restore'] } },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
        if (!latestChange || latestChange.action !== 'cancel') {
            throw new Error('Buổi nghỉ này đã có lịch bù, đã dời chuỗi hoặc không có lịch sử nghỉ hợp lệ');
        }
        const beforeData = latestChange.before_data;
        canceledSource = beforeData?.source_session || current;
    }
    else {
        assertCanUpdateSession(current);
    }
    let action;
    let result;
    let beforeFollowingSessions = [];
    if (['cancel', 'cancel_only', 'no_makeup', 'no_make_up'].includes(mode)) {
        action = 'cancel';
        result = await cancelWithoutMakeup(tx, current, payload, reason);
    }
    else if (['makeup', 'make_up', 'compensate'].includes(mode)) {
        action = 'makeup';
        result = await cancelWithMakeup(tx, current, payload, reason, context?.sourceMappings, canceledSource);
    }
    else if (mode === 'following') {
        action = 'following';
        beforeFollowingSessions = await tx.calendar.findMany({
            where: {
                code: current.code,
                system_type: current.system_type,
                start_time: { gt: current.start_time },
                OR: [
                    { lesson_status: null },
                    { lesson_status: { not: 1 } },
                ],
            },
            orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
        });
        await hydrateAssistantTeachers(tx, beforeFollowingSessions);
        if (afterCancel) {
            const nextActiveSession = beforeFollowingSessions[0];
            if (!nextActiveSession) {
                throw new Error('Không thể dời chuỗi vì không còn buổi học tiếp theo');
            }
            if (nextActiveSession.start_time <= (0, dateTime_1.getVietnamWallClockDate)()) {
                throw new Error('Không thể dời chuỗi vì buổi học tiếp theo đã bắt đầu hoặc đã diễn ra');
            }
        }
        result = await rescheduleFollowing(tx, current, payload, reason, canceledSource);
    }
    else {
        throw new Error("Invalid reschedule mode");
    }
    const affectedSessions = action === 'cancel'
        ? [result]
        : action === 'makeup'
            ? [result.canceled_session, result.created_session]
            : [
                result.canceled_session,
                ...(result.shifted_sessions || []),
                result.created_session,
            ];
    for (const session of affectedSessions)
        await (0, calendar_lifecycle_1.auditCalendarKeyReuse)(tx, session, actor);
    await writeCalendarChangeLog(tx, {
        operationId,
        action: afterCancel ? `${action}_after_cancel` : action,
        current,
        reason,
        actor,
        beforeData: {
            source_session: current,
            following_sessions: beforeFollowingSessions,
        },
        afterData: result,
        affectedSessions,
        newKey: action === 'following' || action === 'makeup'
            ? result?.canceled_session?.key
            : result?.created_session?.key,
    });
    await (0, hocmai_sync_queue_service_1.enqueueRescheduleSync)(tx, action, result, operationId);
    if (!shouldSendChangeNotification(payload)) {
        // Vẫn đồng bộ trạng thái nghỉ học sang HMO nhưng không tạo thông báo Teams.
    }
    else if (action === 'cancel') {
        await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
            eventType: 'cancelled',
            before: current,
            after: result,
            actor,
            operationId,
        });
    }
    else if (action === 'makeup') {
        await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, [
            ...(!afterCancel ? [{
                    eventType: 'cancelled',
                    before: current,
                    after: result.canceled_session,
                    actor,
                    operationId,
                }] : []),
            {
                eventType: 'created',
                after: result.created_session,
                actor,
                operationId,
            },
        ]);
    }
    else {
        await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, [
            ...(!afterCancel ? [{
                    eventType: 'cancelled',
                    before: current,
                    after: result.canceled_session,
                    actor,
                    operationId,
                }] : []),
            ...(result.shifted_sessions || []).map((session, index) => ({
                eventType: 'updated',
                before: beforeFollowingSessions[index],
                after: session,
                actor,
                operationId,
            })),
            {
                eventType: 'created',
                after: result.created_session,
                actor,
                operationId,
            },
        ]);
    }
    return result;
};
const rescheduleSessionImpl = async (id, payload, changeActor) => withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, () => rescheduleSessionInTransaction(tx, id, payload, changeActor))));
/** Hoán đổi vị trí thời gian của hai buổi, giữ nguyên toàn bộ nội dung và phân công. */
const swapSessionTimesImpl = async (payload, changeActor) => {
    const firstId = Number(payload?.first_id);
    const secondId = Number(payload?.second_id);
    if (!Number.isInteger(firstId) || firstId <= 0 || !Number.isInteger(secondId) || secondId <= 0) {
        throw new Error('Vui lòng chọn đủ hai lịch học cần hoán đổi');
    }
    if (firstId === secondId)
        throw new Error('Hai lịch học hoán đổi phải khác nhau');
    return withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const sessions = await tx.calendar.findMany({
            where: { id: { in: [firstId, secondId] } },
        });
        if (sessions.length !== 2)
            throw new Error('Có lịch học đã chọn không còn tồn tại');
        await hydrateAssistantTeachers(tx, sessions);
        const first = sessions.find((item) => item.id === firstId);
        const second = sessions.find((item) => item.id === secondId);
        assertCanUpdateSession(first);
        assertCanUpdateSession(second);
        // Mặc định A nhận khung giờ của B và ngược lại. Giá trị gửi từ modal
        // chỉ ghi đè đúng đầu mút mà người dùng chủ động chỉnh.
        const firstStart = (0, calendar_swap_time_1.swapTimeValue)(payload?.first_start_time, second.start_time, 'Giờ bắt đầu lịch thứ nhất');
        const firstEnd = (0, calendar_swap_time_1.swapTimeValue)(payload?.first_end_time, second.end_time, 'Giờ kết thúc lịch thứ nhất');
        const secondStart = (0, calendar_swap_time_1.swapTimeValue)(payload?.second_start_time, first.start_time, 'Giờ bắt đầu lịch thứ hai');
        const secondEnd = (0, calendar_swap_time_1.swapTimeValue)(payload?.second_end_time, first.end_time, 'Giờ kết thúc lịch thứ hai');
        const finalSessions = [
            { ...first, assistant_teacher: first.assistant_teacher, start_time: firstStart, end_time: firstEnd },
            { ...second, assistant_teacher: second.assistant_teacher, start_time: secondStart, end_time: secondEnd },
        ];
        await (0, exports.validateSwapScheduleConflicts)(finalSessions, tx);
        const operationId = crypto_1.default.randomUUID();
        const reason = String(payload?.reason || 'Hoán đổi lịch học').trim().slice(0, 500);
        const updatedFirst = await updateCalendarRecord(tx, firstId, {
            start_time: firstStart,
            end_time: firstEnd,
            lesson_noti: reason,
        });
        const updatedSecond = await updateCalendarRecord(tx, secondId, {
            start_time: secondStart,
            end_time: secondEnd,
        });
        await hydrateAssistantTeachers(tx, [updatedFirst, updatedSecond]);
        await auditTimeChange(tx, first, updatedFirst, changeActor, reason);
        await auditTimeChange(tx, second, updatedSecond, changeActor, reason);
        await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, operationId, 1, 'update', updatedFirst);
        await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, operationId, 2, 'update', updatedSecond);
        await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, [
            { eventType: 'updated', before: first, after: updatedFirst, actor: changeActor, operationId },
            { eventType: 'updated', before: second, after: updatedSecond, actor: changeActor, operationId },
        ]);
        return { operation_id: operationId, first: updatedFirst, second: updatedSecond };
    }), 3, 60_000));
};
const bulkRescheduleSessionsImpl = async (payload, changeActor) => {
    const ids = Array.from(new Set((Array.isArray(payload?.ids) ? payload.ids : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)));
    if (!ids.length)
        throw new Error('Vui lòng chọn ít nhất một lịch học');
    if (ids.length > 100)
        throw new Error('Chỉ được xử lý tối đa 100 lịch mỗi lần');
    const operation = String(payload?.operation || '');
    if (!['cancel', 'makeup'].includes(operation)) {
        throw new Error('Thao tác hàng loạt không hợp lệ');
    }
    const reason = normalizeChangeReason(payload);
    const offsetDays = operation === 'makeup'
        ? normalizePositiveInteger(payload?.offset_days, 'Số ngày dịch lịch bù')
        : 0;
    if (offsetDays > 3650)
        throw new Error('Số ngày dịch lịch bù không được quá 3650 ngày');
    return withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const selected = await tx.calendar.findMany({
            where: { id: { in: ids } },
            orderBy: [{ start_time: operation === 'makeup' ? 'desc' : 'asc' }, { id: 'asc' }],
        });
        if (selected.length !== ids.length) {
            throw new Error('Có lịch học đã chọn không còn tồn tại');
        }
        // Nạp metadata và mapping một lần cho cả lô. Tránh mỗi lịch lại query
        // session_id/assistant_teacher và package_lesson_mapping riêng biệt.
        await hydrateAssistantTeachers(tx, selected);
        const sourceMappingsByKey = operation === 'makeup'
            ? await loadMappingsByKeys(tx, selected.map((session) => String(session.key || '').trim()).filter(Boolean))
            : new Map();
        const programCodes = new Set(selected.map((session) => String(session.code)));
        if (programCodes.size !== 1) {
            throw new Error('Chỉ được xử lý hàng loạt các lịch thuộc cùng một Chương trình');
        }
        selected.forEach(assertCanUpdateSession);
        const results = [];
        for (const session of selected) {
            const sessionPayload = {
                mode: operation,
                reason,
                canceled_lesson_name_prefix: payload?.canceled_lesson_name_prefix,
                canceled_lesson_name_suffix: payload?.canceled_lesson_name_suffix,
            };
            if (operation === 'makeup') {
                sessionPayload.new_lesson_name_prefix = payload?.new_lesson_name_prefix;
                sessionPayload.new_lesson_name_suffix = payload?.new_lesson_name_suffix;
                const startTime = new Date(session.start_time);
                const endTime = new Date(session.end_time);
                startTime.setDate(startTime.getDate() + offsetDays);
                endTime.setDate(endTime.getDate() + offsetDays);
                sessionPayload.new_session = {
                    start_time: startTime,
                    end_time: endTime,
                };
            }
            results.push(await rescheduleSessionInTransaction(tx, session.id, sessionPayload, changeActor, {
                current: session,
                sourceMappings: sourceMappingsByKey.get(String(session.key || '').trim()) ?? [],
            }));
        }
        return {
            operation,
            count: results.length,
            offset_days: operation === 'makeup' ? offsetDays : undefined,
            results,
        };
    }), 3, 120_000));
};
// 2.1 & 2.2 Sửa lịch
const updateScheduleImpl = async (id, data, updateMode, changeActor) => {
    if (updateMode && updateMode !== 'current') {
        return await (0, exports.rescheduleSession)(id, { ...data, mode: updateMode }, changeActor);
    }
    if (data?.lesson_status !== undefined || data?.cancel_reason !== undefined) {
        throw new Error('Chỉ được đánh dấu nghỉ học qua thao tác Nghỉ học để bắt buộc lưu lý do');
    }
    const current = await calendar_transaction_2.default.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    await hydrateAssistantTeachers(calendar_transaction_2.default, [current]);
    (0, exports.assertCanUpdateSessionMappings)(current, data);
    if (data.code !== undefined && String(data.code) !== String(current.code)) {
        throw new Error('Không được thay đổi code khi cập nhật lịch học');
    }
    if (data.learn_number !== undefined
        && Number(data.learn_number) !== Number(current.learn_number)) {
        throw new Error('Không được thay đổi learn_number khi cập nhật lịch học');
    }
    const rawMappingUpdate = data?.package_lesson_mappings;
    const auditReason = data?.reason ?? data?.change_reason;
    const sendTimeNotification = data?.send_notification;
    const hasMappingUpdate = Array.isArray(rawMappingUpdate);
    const resolvedMappingUpdate = hasMappingUpdate
        ? await normalizePackageLessonMappingsForUpdate(rawMappingUpdate)
        : undefined;
    if (data.sessionId !== undefined
        || data.session_id !== undefined
        || data.lesson_id !== undefined) {
        data = await hydrateLessonData(calendar_transaction_2.default, data);
        if (String(data.code) !== String(current.code)
            || Number(data.learn_number) !== Number(current.learn_number)) {
            throw new Error('Bài học mới phải giữ nguyên code và learn_number của lịch hiện tại');
        }
    }
    normalizeRoom(data);
    normalizeTeachingAssignmentsForScheduleUpdate(data);
    delete data.package_lesson_mappings;
    delete data.key;
    delete data.new_session;
    delete data.reason;
    delete data.change_reason;
    delete data.send_notification;
    delete data.code;
    delete data.learn_number;
    delete data.allow_past;
    if (data.start_time)
        data.start_time = new Date(data.start_time);
    if (data.end_time)
        data.end_time = new Date(data.end_time);
    if (data.start_time || data.end_time) {
        ensureValidTimeRange(data.start_time ?? current.start_time, data.end_time ?? current.end_time);
    }
    const timeNotification = (0, calendar_time_notification_1.calendarTimeNotification)(current, data, sendTimeNotification, auditReason);
    if (timeNotification !== undefined)
        data.lesson_noti = timeNotification;
    if (data.start_time
        || data.end_time
        || data.teacher
        || data.assistant_teacher !== undefined
        || data.channel_name) {
        await (0, exports.checkConflict)({
            calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
            teacher: data.teacher ?? current.teacher,
            assistant_teacher: data.assistant_teacher !== undefined ? data.assistant_teacher : current.assistant_teacher,
            channel_name: data.channel_name ?? current.channel_name,
            code: current.code,
            start_time: data.start_time ?? current.start_time,
            end_time: data.end_time ?? current.end_time,
            id,
        });
    }
    return await withCalendarTriggerErrorHint(() => calendar_transaction_2.default.$transaction(async (tx) => {
        const operation = async () => {
            const updated = await updateCalendarRecord(tx, id, data);
            // updateCalendarRecord đang nhận cờ skip từ luồng cập nhật để tránh sync
            // sớm. Sau khi snapshot mới hoàn chỉnh, đồng bộ hai chiều: thêm người mới
            // và thu hồi người cũ nếu không còn lịch hoạt động khác sử dụng họ.
            await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, current, updated);
            await auditTimeChange(tx, current, updated, changeActor, auditReason);
            if (resolvedMappingUpdate) {
                await replacePackageLessonMappingForCalendar(tx, updated, resolvedMappingUpdate);
            }
            await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'update', updated);
            await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                eventType: 'updated',
                before: current,
                after: updated,
                actor: changeActor,
            });
            return updated;
        };
        return (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, operation);
    }));
};
// 2.3 Nghỉ không dời
const cancelSessionImpl = async (id, payload, changeActor) => (0, exports.rescheduleSession)(id, { ...payload, mode: 'cancel' }, changeActor);
const deleteSessionImpl = async (id, changeActor) => withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
    const rows = await tx.$queryRaw `SELECT * FROM calendar WHERE id = ${id} FOR UPDATE`;
    const current = rows[0];
    if (!current)
        throw new Error('Không tìm thấy lịch học');
    // Deleting an already deleted row is a no-op and does not create another queue job.
    if (current.deleted_at)
        return current;
    assertCanUpdateSession(current);
    const actor = normalizeChangeActor(changeActor);
    const mappings = current.key ? await tx.package_lesson_mapping.findMany({ where: { key: current.key } }) : [];
    const operationId = crypto_1.default.randomUUID();
    await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, current, { ...current, lesson_status: 1 });
    const deleted = await tx.calendar.update({
        where: { id, deleted_at: null }, data: { deleted_at: (0, dateTime_1.getVietnamWallClockDate)(), updated_at: new Date() },
    });
    await (0, calendar_lifecycle_1.writeCalendarLifecycleLog)(tx, {
        operationId, action: 'delete', before: current, after: deleted,
        mappingsBefore: mappings, mappingsAfter: mappings, actor, reason: 'Xóa lịch học',
        lessonBefore: current.session_id == null ? undefined : await tx.lessons.findUnique({ where: { id: BigInt(current.session_id) } }),
    });
    if (current.key && (0, calendar_source_1.calendarSourceFromCode)(current.code) !== 'feed'
        && mappings.some(hocmai_sync_queue_service_1.hasValidHocmaiLessonMapping)) {
        await tx.hocmai_sync_queue.create({ data: {
                c_key: current.key, action: 'delete', payload: JSON.stringify({ c_key: current.key, action: 'delete' }),
                status: 0, operation_id: operationId, sequence_no: 1,
            } });
    }
    await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, { eventType: 'deleted', before: current, actor });
    return deleted;
})));
const restoreSessionImpl = async (id, changeActor) => withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
    const rows = await tx.$queryRaw `SELECT * FROM calendar WHERE id = ${id} FOR UPDATE`;
    const current = rows[0];
    if (!current)
        throw new Error('Không tìm thấy lịch học');
    if (!current.deleted_at)
        throw new Error('Lịch học không ở trạng thái đã xóa');
    const actor = normalizeChangeActor(changeActor);
    const deletion = await tx.calendar_change_logs.findFirst({
        where: { calendar_id: id, action: 'delete' }, orderBy: { id: 'desc' },
    });
    const snapshot = deletion?.before_data;
    const key = String(deletion?.old_key || current.key || '');
    // A released key has already been reused: self restore must never overwrite it.
    if (!key || !current.key || current.key !== key) {
        throw new Error('Key của lịch đã được tái sử dụng; không thể khôi phục đè lên lịch khác');
    }
    const desired = { ...current, ...(snapshot?.source_session || {}), id, key, deleted_at: null };
    desired.session_id = desired.session_id == null ? null : BigInt(desired.session_id);
    desired.start_time = new Date(desired.start_time);
    desired.end_time = new Date(desired.end_time);
    assertCanUpdateSession(desired);
    const lesson = desired.session_id == null ? null : await tx.lessons.findFirst({
        where: { id: desired.session_id, status: { not: 0 } },
    });
    const lessonSnapshot = snapshot?.lesson_snapshot;
    const curriculumChanged = lessonSnapshot && lesson && [
        'subject_code', 'learn_number', 'lesson_name', 'subject_name', 'grade', 'system_type',
    ].some(field => String(lesson[field] ?? '') !== String(lessonSnapshot[field] ?? ''));
    if (desired.session_id != null && (!lesson || lesson.subject_code !== desired.code
        || lesson.learn_number !== desired.learn_number || curriculumChanged)) {
        throw new Error('Đề cương đã thay đổi hoặc bài học đã bị xóa; không thể khôi phục nguyên trạng lịch này');
    }
    await assertLessonCountAvailable(tx, desired.code, desired.system_type, desired.learn_number, Number(desired.lesson_count ?? 0), (0, calendar_source_1.calendarSourceFromCode)(desired.code));
    await (0, exports.checkConflict)({ ...desired, client: tx });
    const mappings = Array.isArray(snapshot?.mappings) ? snapshot.mappings :
        await tx.package_lesson_mapping.findMany({ where: { key } });
    // Legacy calendars without a curriculum link may still have valid HMO mappings.
    if (desired.session_id != null)
        await assertMappingsBelongToCalendarLesson(tx, desired, mappings);
    const restoredFields = {};
    for (const field of Object.values(client_1.Prisma.CalendarScalarFieldEnum)) {
        if (!['id', 'key', 'deleted_at', 'created_at', 'updated_at'].includes(field) && desired[field] !== undefined) {
            restoredFields[field] = desired[field];
        }
    }
    const restored = await tx.calendar.update({
        where: { id, deleted_at: { not: null } },
        data: { ...restoredFields, deleted_at: null, updated_at: new Date() },
    });
    await tx.package_lesson_mapping.deleteMany({ where: { key } });
    await createPackageLessonMappingForCalendar(tx, restored, mappings);
    await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, null, restored);
    const operationId = crypto_1.default.randomUUID();
    await (0, calendar_lifecycle_1.writeCalendarLifecycleLog)(tx, {
        operationId, action: 'restore', before: current, after: restored,
        mappingsBefore: mappings, mappingsAfter: mappings, actor,
        restoreType: 'self', reason: 'Khôi phục lịch học đã xóa nhầm',
    });
    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, operationId, 1, 'restore', restored);
    await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, { eventType: 'created', after: restored, actor });
    return restored;
})));
const CALENDAR_SYSTEM_TYPES = ['topclass', 'event', 'phaken', 'topuni'];
const CALENDAR_SORT_FIELDS = [
    'id',
    'code',
    'learn_number',
    'subject',
    'teacher',
    'start_time',
    'end_time',
    'lesson_status',
    'system_type',
    'created_at',
];
const normalizeString = (value) => {
    if (Array.isArray(value))
        return undefined;
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};
const normalizeNumber = (value, fieldName) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new Error(`${fieldName} không hợp lệ`);
    }
    return parsed;
};
const normalizeDate = (value, fieldName) => {
    const normalized = normalizeString(value);
    if (!normalized)
        return undefined;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldName} không hợp lệ`);
    }
    return date;
};
const normalizeSortOrder = (value) => {
    const order = normalizeString(value);
    return order === 'desc' || order === 'descend' ? 'desc' : 'asc';
};
const getCalendarIdsForPrograms = async (programs) => {
    if (!programs.length)
        return [];
    const rows = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
    SELECT DISTINCT calendar_row.id
    FROM calendar AS calendar_row
    LEFT JOIN lessons AS session_lesson
      ON session_lesson.id = calendar_row.session_id
     AND session_lesson.status <> 0
    WHERE session_lesson.subject_code IN (${client_1.Prisma.join(programs)})
       OR (
         (calendar_row.session_id IS NULL OR calendar_row.deleted_at IS NOT NULL)
         AND calendar_row.code IN (${client_1.Prisma.join(programs)})
       )
  `);
    return rows.map((row) => Number(row.id));
};
const assertSchedulingProgramExists = async (programCode) => {
    const program = await calendar_transaction_2.default.lessons.findFirst({
        where: { subject_code: programCode, status: { not: 0 } },
        select: { id: true },
    });
    if (!program)
        throw new Error('Chương trình không tồn tại hoặc chưa có đề cương');
};
exports.assertSchedulingProgramExists = assertSchedulingProgramExists;
const getCalendarImportProgramContext = async (programCode) => {
    const code = String(programCode || '').trim();
    if (!code)
        throw new Error('Vui lòng chọn Chương trình trước khi import lịch học');
    const program = await calendar_transaction_2.default.lessons.findFirst({
        where: { subject_code: code, status: { not: 0 } },
        orderBy: { id: 'asc' },
        select: { subject_code: true, subject_name: true, system_type: true },
    });
    if (!program)
        throw new Error('Chương trình không tồn tại hoặc chưa có đề cương');
    if (program.system_type !== 'topclass' && program.system_type !== 'topuni') {
        throw new Error(`Chương trình ${code} chưa có system_type hợp lệ`);
    }
    return {
        code,
        subject: String(program.subject_name || '').trim() || code,
        systemType: program.system_type,
    };
};
exports.getCalendarImportProgramContext = getCalendarImportProgramContext;
const getCalendarTeacherFilterOptions = async (programCode, allowedPrograms = null) => {
    const code = String(programCode || '').trim();
    if (!code)
        return [];
    if (allowedPrograms !== null && !allowedPrograms.includes(code))
        return [];
    const calendarIds = await getCalendarIdsForPrograms([code]);
    if (!calendarIds.length)
        return [];
    const rows = await calendar_transaction_2.default.calendar.findMany({
        where: {
            id: { in: calendarIds },
            teacher: { not: null },
        },
        distinct: ['teacher'],
        select: { teacher: true },
        orderBy: { teacher: 'asc' },
    });
    return rows
        .map((row) => String(row.teacher || '').trim())
        .filter(Boolean)
        .map((teacher) => ({ value: teacher, label: teacher }));
};
exports.getCalendarTeacherFilterOptions = getCalendarTeacherFilterOptions;
const getCalendarHeaderFilterOptions = async (query, allowedPrograms = null, allowAllPrograms = false) => {
    // Use the exact same scope as the list, without applying pagination.
    const { where } = await buildCalendarListQuery(query, allowedPrograms, allowAllPrograms);
    const rows = await calendar_transaction_2.default.calendar.findMany({
        where, select: { id: true, start_time: true, end_time: true, lesson_status: true },
    });
    const assistantValues = new Set();
    for (let offset = 0; offset < rows.length; offset += 500) {
        const assistants = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
      SELECT DISTINCT assistant_teacher FROM calendar
      WHERE id IN (${client_1.Prisma.join(rows.slice(offset, offset + 500).map(row => row.id))})
    `);
        for (const row of assistants) {
            const values = parseAssistantTeachers(row.assistant_teacher);
            (values.length ? values : ['-']).forEach(value => assistantValues.add(value));
        }
    }
    const now = (0, dateTime_1.getVietnamWallClockDate)();
    return {
        live_dates: Array.from(new Set(rows.map(row => row.start_time.toISOString().slice(0, 10)))).sort(),
        assistant_teachers: Array.from(assistantValues).sort(),
        progress_statuses: Array.from(new Set(rows.map(row => Number(row.lesson_status) === 1
            ? 'cancelled' : row.start_time > now ? 'upcoming' : row.end_time < now ? 'completed' : 'ongoing'))),
    };
};
exports.getCalendarHeaderFilterOptions = getCalendarHeaderFilterOptions;
const buildHocmaiAttendancePayload = (calendarKeys, calendarJoin, rawUserIds, action) => {
    const cKeys = Array.from(new Set(calendarKeys
        .map((value) => String(value || '').trim())
        .filter(Boolean)));
    const joinedCalendarKey = action === 'delete' ? '' : String(calendarJoin || '').trim();
    const userIds = Array.from(new Set(rawUserIds
        .map((value) => String(value || '').trim())
        .filter((value) => /^\d+$/.test(value))));
    if (!userIds.length)
        return [];
    if (!cKeys.length)
        throw new Error('Lịch học chưa có c_key để đồng bộ chuyên cần sang HOCMAI');
    if (!action && !joinedCalendarKey)
        throw new Error('Chưa xác định được calendar_join để đồng bộ chuyên cần sang HOCMAI');
    // Giữ toàn bộ c_key của một học viên liền nhau. Nhờ vậy khi chia batch,
    // B1/B2/... của cùng học viên không bị dồn thành các request riêng biệt.
    return userIds.flatMap((userId) => cKeys.map((cKey) => ({
        c_key: cKey,
        user_id: userId,
        calendar_join: joinedCalendarKey,
        ...(action ? { action } : {}),
    })));
};
exports.buildHocmaiAttendancePayload = buildHocmaiAttendancePayload;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sendHocmaiAttendance = async (calendarKeys, calendarJoin, rawUserIds, action) => {
    const attendancePayload = (0, exports.buildHocmaiAttendancePayload)(calendarKeys, calendarJoin, rawUserIds, action);
    if (!attendancePayload.length)
        return 0;
    const url = String(process.env.HOCMAI_ATTENDANCE_UPDATE_USER_API_URL || 'https://hocmai.vn/api/calendar/update-user').trim();
    const token = String(process.env.HOCMAI_ATTENDANCE_UPDATE_USER_API_TOKEN || process.env.HOCMAI_LIVE_USER_API_TOKEN || '').trim();
    if (!url || !token)
        throw new Error('Chưa cấu hình token HOCMAI để đồng bộ chuyên cần');
    const configuredBatchSize = Number(process.env.HOCMAI_ATTENDANCE_UPDATE_USER_BATCH_SIZE || 100);
    const batchSize = Number.isFinite(configuredBatchSize) ? Math.max(1, Math.min(Math.floor(configuredBatchSize), 500)) : 100;
    const calendarKeyCount = new Set(attendancePayload.map((item) => item.c_key)).size;
    // Làm tròn batch theo bội số số c_key để không cắt đôi nhóm của một học viên.
    // Trường hợp số c_key lớn hơn giới hạn, vẫn gửi trọn một học viên trong một batch.
    const completeStudentBatchSize = calendarKeyCount > batchSize
        ? calendarKeyCount
        : Math.max(calendarKeyCount, Math.floor(batchSize / calendarKeyCount) * calendarKeyCount);
    let sent = 0;
    for (let index = 0; index < attendancePayload.length; index += completeStudentBatchSize) {
        const payload = attendancePayload.slice(index, index + completeStudentBatchSize);
        console.log('payload', payload);
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { token, "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(Number(process.env.HOCMAI_ATTENDANCE_UPDATE_USER_TIMEOUT_MS) || 30_000),
                });
                const responsePayload = await response.json().catch(() => null);
                if (!response.ok)
                    throw new Error('HOCMAI trả HTTP ' + response.status);
                // Một số response HOCMAI vẫn HTTP 200 nhưng báo status lỗi trong body.
                // Chỉ chấp nhận status thành công khi trường status được trả về.
                if (responsePayload?.status !== undefined && !['success', '200', 'true'].includes(String(responsePayload.status).toLowerCase())) {
                    throw new Error('HOCMAI từ chối cập nhật: ' + String(responsePayload?.message || responsePayload?.error || responsePayload.status));
                }
                sent += payload.length;
                lastError = undefined;
                break;
            }
            catch (error) {
                lastError = error;
                if (attempt < 3)
                    await sleep(500 * attempt);
            }
        }
        if (lastError) {
            const message = lastError instanceof Error ? lastError.message : 'Lỗi không xác định';
            throw new Error('Không thể đồng bộ chuyên cần lịch ' + String(calendarJoin || calendarKeys[0] || '') + ' sang HOCMAI: ' + message);
        }
    }
    return sent;
};
const syncCalendarAttendance = async (rawIds, preview = false) => {
    const ids = Array.from(new Set((Array.isArray(rawIds) ? rawIds : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)));
    if (!ids.length)
        throw new Error("Vui lòng chọn ít nhất một lịch học");
    const calendars = await calendar_transaction_2.default.calendar.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true, code: true, learn_number: true, start_time: true, end_time: true, lesson_status: true, system_type: true },
    });
    const result = { processed: 0, skipped: 0, updated: 0, details: [] };
    const now = (0, dateTime_1.getVietnamWallClockDate)();
    const updateSql = [
        "UPDATE users AS student",
        "INNER JOIN (",
        "  SELECT SUBSTRING_INDEX(log.name, \' - \', 1) AS student_hmid",
        "  FROM users_logs AS log",
        "  WHERE log.code = ? AND log.learn_number = ?",
        "    AND log.created_at >= ? AND log.created_at < ?",
        "    AND log.name IS NOT NULL",
        "  GROUP BY SUBSTRING_INDEX(log.name, \' - \', 1)",
        "  HAVING SUM(log.status = 2) >= 2",
        ") AS attended ON attended.student_hmid = student.student_hmid",
        "SET student.islearn = 1",
        "WHERE student.code = ? AND student.learn_number = ? AND student.islearn = 0",
    ].join("\n");
    const attendedStudentsSql = [
        "SELECT student.student_hmid AS user_id FROM users AS student",
        "INNER JOIN (",
        "  SELECT SUBSTRING_INDEX(log.name, ' - ', 1) AS student_hmid",
        "  FROM users_logs AS log",
        "  WHERE log.code = ? AND log.learn_number = ?",
        "    AND log.created_at >= ? AND log.created_at < ?",
        "    AND log.name IS NOT NULL",
        "  GROUP BY SUBSTRING_INDEX(log.name, ' - ', 1)",
        "  HAVING SUM(log.status = 2) >= 2",
        ") AS attended ON attended.student_hmid = student.student_hmid",
        "WHERE student.code = ? AND student.learn_number = ? AND student.islearn = 1 AND student.student_hmid IS NOT NULL",
    ].join("\n");
    const previewSql = [
        "SELECT COUNT(*) AS total FROM users AS student",
        "INNER JOIN (",
        "  SELECT SUBSTRING_INDEX(log.name, \' - \', 1) AS student_hmid",
        "  FROM users_logs AS log",
        "  WHERE log.code = ? AND log.learn_number = ?",
        "    AND log.created_at >= ? AND log.created_at < ?",
        "    AND log.name IS NOT NULL",
        "  GROUP BY SUBSTRING_INDEX(log.name, \' - \', 1)",
        "  HAVING SUM(log.status = 2) >= 2",
        ") AS attended ON attended.student_hmid = student.student_hmid",
        "WHERE student.code = ? AND student.learn_number = ? AND student.islearn = 0",
    ].join("\n");
    for (const calendar of calendars) {
        if (Number(calendar.lesson_status) === 1 || !calendar.start_time || !calendar.end_time || calendar.end_time > now) {
            result.skipped += 1;
            continue;
        }
        // status = 2 được ghi mỗi 5 phút; từ hai log trở lên là đủ 10 phút học.
        const previewRows = preview
            ? await calendar_transaction_2.default.$queryRawUnsafe(previewSql, calendar.code, calendar.learn_number, calendar.start_time, calendar.end_time, calendar.code, calendar.learn_number)
            : null;
        const updated = preview ? null : await calendar_transaction_2.default.$executeRawUnsafe(updateSql, calendar.code, calendar.learn_number, calendar.start_time, calendar.end_time, calendar.code, calendar.learn_number);
        // Đồng bộ HOCMAI theo từng lịch: dù islearn của bài đã là 1 từ một lịch
        // khác, học viên vẫn phải được ghi nhận vào đúng c_key đã tham gia.
        const attendedRows = preview ? [] : await calendar_transaction_2.default.$queryRawUnsafe(attendedStudentsSql, calendar.code, calendar.learn_number, calendar.start_time, calendar.end_time, calendar.code, calendar.learn_number);
        const siblingKeys = preview || calendar.system_type !== 'topclass'
            ? [calendar.key]
            : (await calendar_transaction_2.default.calendar.findMany({
                where: {
                    code: calendar.code,
                    learn_number: calendar.learn_number,
                    system_type: 'topclass',
                    key: { not: null },
                    OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
                },
                select: { key: true },
                orderBy: [{ lesson_count: 'asc' }, { start_time: 'asc' }, { id: 'asc' }],
            }))
                .map((item) => item.key)
                .filter((key) => Boolean(String(key || '').trim()));
        const hocmaiUpdated = preview ? 0 : await sendHocmaiAttendance(siblingKeys, calendar.key, attendedRows.map((row) => row.user_id));
        const count = preview ? Number(previewRows?.[0]?.total || 0) : Number(updated);
        result.processed += 1;
        result.updated += count;
        result.details.push({ calendar_id: calendar.id, updated: count, hocmai_updated: hocmaiUpdated });
    }
    result.skipped += ids.length - calendars.length;
    return result;
};
exports.syncCalendarAttendance = syncCalendarAttendance;
const getEndedActiveCalendarForAttendance = async (rawCalendarId) => {
    const calendarId = Number(rawCalendarId);
    if (!Number.isInteger(calendarId) || calendarId <= 0)
        throw new Error('Lịch học không hợp lệ');
    const calendar = await calendar_transaction_2.default.calendar.findUnique({
        where: { id: calendarId },
        select: { id: true, key: true, code: true, learn_number: true, lesson_name: true, start_time: true, end_time: true, lesson_status: true },
    });
    if (!calendar)
        throw new Error('Không tìm thấy lịch học');
    if (Number(calendar.lesson_status) === 1)
        throw new Error('Không thể thay đổi chuyên cần của lịch đã hủy');
    if (!calendar.end_time || calendar.end_time > (0, dateTime_1.getVietnamWallClockDate)()) {
        throw new Error('Chỉ có thể thay đổi chuyên cần của lịch đã kết thúc');
    }
    return calendar;
};
// Danh sách chỉ gồm học viên đang được đánh dấu đã học ở đúng bài của lịch.
// UI phải chọn rõ từng người trước khi gửi yêu cầu hoàn tác.
const getCalendarAttendanceResetStudents = async (rawCalendarId) => {
    const calendar = await getEndedActiveCalendarForAttendance(rawCalendarId);
    const students = await calendar_transaction_2.default.users.findMany({
        where: { code: calendar.code, learn_number: calendar.learn_number, islearn: 1 },
        select: { id: true, username: true, name: true, student_hmid: true, email: true },
        orderBy: [{ name: 'asc' }, { username: 'asc' }],
    });
    return { calendar, students };
};
exports.getCalendarAttendanceResetStudents = getCalendarAttendanceResetStudents;
// Hoàn tác có chủ đích: chỉ các user ID được chọn, cùng chương trình và bài học
// của duy nhất một lịch đã kết thúc, mới được đưa islearn từ 1 về 0.
const resetCalendarAttendance = async (rawCalendarId, rawStudentIds) => {
    const calendar = await getEndedActiveCalendarForAttendance(rawCalendarId);
    const studentIds = Array.from(new Set((Array.isArray(rawStudentIds) ? rawStudentIds : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)));
    if (!studentIds.length)
        throw new Error('Vui lòng chọn ít nhất một học viên');
    const studentsToReset = await calendar_transaction_2.default.users.findMany({
        where: {
            id: { in: studentIds },
            code: calendar.code,
            learn_number: calendar.learn_number,
            islearn: 1,
        },
        select: { id: true, student_hmid: true },
    });
    const invalidHocmaiIds = studentsToReset.filter((student) => !/^\d+$/.test(String(student.student_hmid || '').trim()));
    if (invalidHocmaiIds.length) {
        throw new Error('Có ' + invalidHocmaiIds.length + ' học viên chưa có HMO ID hợp lệ; chưa thay đổi trạng thái để tránh lệch dữ liệu HOCMAI');
    }
    // Gửi HOCMAI trước để không đưa hai hệ thống về trạng thái lệch nhau.
    // calendar_join rỗng và action=delete là payload hoàn tác do HOCMAI quy định.
    const hocmaiReset = await sendHocmaiAttendance([calendar.key], '', studentsToReset.map((student) => student.student_hmid), 'delete');
    const result = studentsToReset.length ? await calendar_transaction_2.default.users.updateMany({
        where: { id: { in: studentsToReset.map((student) => student.id) }, islearn: 1 },
        data: { islearn: 0 },
    }) : { count: 0 };
    return {
        calendar_id: calendar.id,
        requested: studentIds.length,
        reset: result.count,
        hocmai_reset: hocmaiReset,
        skipped: studentIds.length - result.count,
    };
};
exports.resetCalendarAttendance = resetCalendarAttendance;
const assertCalendarIdsInProgram = async (ids, programCode) => {
    const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    if (!uniqueIds.length)
        throw new Error('File import không có lịch học hợp lệ');
    const allowedIds = new Set(await getCalendarIdsForPrograms([programCode]));
    const deniedIds = uniqueIds.filter((id) => !allowedIds.has(id));
    if (deniedIds.length) {
        throw new Error(`Có lịch học không thuộc Chương trình ${programCode}`);
    }
};
exports.assertCalendarIdsInProgram = assertCalendarIdsInProgram;
// 3. Lấy danh sách lịch
const buildCalendarListQuery = async (query, allowedPrograms = null, allowAllPrograms = false) => {
    const calendarSource = (0, calendar_source_1.resolveCalendarSource)(query.calendar_source);
    const page = normalizeNumber(query.page, 'page') ?? 1;
    const limit = normalizeNumber(query.limit, 'limit') ?? 10;
    const calendarId = normalizeNumber(query.calendar_id, 'calendar_id');
    const calendarIds = query.calendar_ids === undefined ? undefined : Array.from(new Set(String(query.calendar_ids).split(',').filter((value) => value.trim() !== '').map(Number)));
    if (calendarIds && calendarIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
        throw new Error('calendar_ids phải là danh sách ID lịch nguyên dương');
    }
    if (page < 1)
        throw new Error('page phải lớn hơn 0');
    // Bảng Quản lý lịch học cho phép người dùng theo dõi tối đa 300 buổi/trang.
    if (limit < 1 || limit > 300)
        throw new Error('limit phải nằm trong khoảng 1-300');
    if (calendarId !== undefined && calendarId < 1)
        throw new Error('calendar_id phải là số nguyên dương');
    const skip = (page - 1) * limit;
    const take = limit;
    const keyword = normalizeString(query.keyword);
    const code = normalizeString(query.code);
    const exactCode = normalizeString(query.code_exact);
    const requestedTeachers = Array.from(new Set(String(query.teacher ?? '')
        .split(',')
        .map((teacher) => teacher.trim())
        .filter(Boolean)));
    const subject = normalizeString(query.subject);
    const classroom = normalizeString(query.classroom);
    const systemTypes = Array.from(new Set(String(query.system_type ?? '')
        .split(',')
        .map((systemType) => systemType.trim())
        .filter(Boolean)));
    const timeStatuses = Array.from(new Set(String(query.time_status ?? '')
        .split(',')
        .map((status) => status.trim())
        .filter(Boolean)));
    const weekdayTokens = String(query.weekdays ?? '')
        .split(',')
        .map((weekday) => weekday.trim())
        .filter(Boolean);
    const weekdays = Array.from(new Set(weekdayTokens.map(Number)));
    const learnNumberTokens = String(query.learn_numbers ?? '')
        .split(',')
        .map((learnNumber) => learnNumber.trim())
        .filter(Boolean);
    const learnNumbers = Array.from(new Set(learnNumberTokens.map(Number)));
    const fromLearnNumber = normalizeNumber(query.from_learn_number, 'from_learn_number');
    const toLearnNumber = normalizeNumber(query.to_learn_number, 'to_learn_number');
    const startTime = normalizeDate(query.start_time, 'start_time');
    const endTime = normalizeDate(query.end_time, 'end_time');
    const columnFilters = (0, calendar_column_filters_1.buildCalendarColumnFilters)(query, (0, dateTime_1.getVietnamWallClockDate)());
    if (!exactCode && !code && !allowAllPrograms) {
        throw new Error('Vui lòng chọn Chương trình');
    }
    const sortFields = (normalizeString(query.sort_by) || '')
        .split(',')
        .map((field) => field.trim())
        .filter((field) => CALENDAR_SORT_FIELDS.includes(field));
    const requestedSortOrders = (normalizeString(query.sort_order) || '')
        .split(',')
        .map((order) => normalizeSortOrder(order));
    const teacherNames = [];
    for (const requestedTeacher of requestedTeachers) {
        const teacherProfiles = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
      SELECT display_name
      FROM teacher_profiles
      WHERE username = ${requestedTeacher}
        AND can_view_stream_key = 1
        AND status = 1
      LIMIT 1
    `);
        teacherNames.push(teacherProfiles[0]?.display_name?.trim() || requestedTeacher);
    }
    if (systemTypes.some((systemType) => !CALENDAR_SYSTEM_TYPES.includes(systemType))) {
        throw new Error('system_type không hợp lệ');
    }
    if (timeStatuses.some((status) => !['upcoming', 'ongoing', 'completed', 'cancelled'].includes(status))) {
        throw new Error('time_status không hợp lệ');
    }
    if (weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 1 || weekday > 7)) {
        throw new Error('weekdays chỉ nhận giá trị từ 1 (Thứ 2) đến 7 (Chủ nhật)');
    }
    if (learnNumbers.some((learnNumber) => !Number.isInteger(learnNumber) || learnNumber < 1)) {
        throw new Error('learn_numbers chỉ nhận danh sách buổi học là số nguyên dương');
    }
    if ((fromLearnNumber !== undefined && fromLearnNumber < 1)
        || (toLearnNumber !== undefined && toLearnNumber < 1)) {
        throw new Error('Khoảng bài phải lớn hơn 0');
    }
    if (fromLearnNumber !== undefined && toLearnNumber !== undefined
        && fromLearnNumber > toLearnNumber) {
        throw new Error('Khoảng bài không hợp lệ');
    }
    if (startTime && endTime && startTime > endTime) {
        throw new Error('Khoảng thời gian không hợp lệ');
    }
    const selectedProgram = exactCode || code;
    const requestedPrograms = selectedProgram ? [selectedProgram] : null;
    const effectivePrograms = allowedPrograms === null
        ? requestedPrograms
        : requestedPrograms
            ? allowedPrograms.filter((program) => requestedPrograms.includes(program))
            : allowedPrograms;
    const scopedCalendarIds = effectivePrograms === null
        ? null
        : await getCalendarIdsForPrograms(effectivePrograms);
    // Linked lessons own the program scope; legacy rows without session_id use
    // their stored code even if their curriculum lesson no longer exists.
    const programCondition = scopedCalendarIds === null
        ? null
        : { id: { in: scopedCalendarIds } };
    if (query.deleted !== undefined && !['true', 'false', true, false].includes(query.deleted)) {
        throw new Error('deleted chỉ nhận true hoặc false');
    }
    const where = {
        deleted_at: query.deleted === 'true' || query.deleted === true ? { not: null } : null,
        AND: [
            { code: calendarSource === 'feed' ? { startsWith: 'feed-' } : { not: { startsWith: 'feed-' } } },
            ...(programCondition ? [programCondition] : []),
        ],
    };
    const classification = await (0, calendar_classification_filters_1.calendarClassificationCondition)(query, effectivePrograms);
    if (classification)
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), classification];
    if (calendarId !== undefined)
        where.id = calendarId;
    if (calendarIds)
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { id: { in: calendarIds } }];
    if (keyword) {
        where.OR = [
            { code: { contains: keyword } },
            { subject: { contains: keyword } },
            { teacher: { contains: keyword } },
            { lesson_name: { contains: keyword } },
            { lesson_link: { contains: keyword } },
            { channel_name: { contains: keyword } },
        ];
    }
    if (teacherNames.length) {
        const teacherCondition = {
            OR: teacherNames.map((teacher) => ({ teacher: { contains: teacher } })),
        };
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), teacherCondition];
    }
    if (subject)
        where.subject = { contains: subject };
    if (classroom)
        where.channel_name = { contains: classroom };
    if (learnNumbers.length) {
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : []),
            { learn_number: { in: learnNumbers } },
        ];
    }
    if (fromLearnNumber !== undefined || toLearnNumber !== undefined) {
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : []),
            { learn_number: {
                    ...(fromLearnNumber !== undefined ? { gte: fromLearnNumber } : {}),
                    ...(toLearnNumber !== undefined ? { lte: toLearnNumber } : {}),
                } },
        ];
    }
    // Chọn cả Topclass và Topuni tương đương không lọc hệ thống.
    if (systemTypes.length === 1)
        where.system_type = systemTypes[0];
    if (startTime || endTime) {
        where.start_time = {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
        };
    }
    if (timeStatuses.length) {
        const { conditions } = (0, calendar_column_filters_1.buildCalendarColumnFilters)({ progress_statuses: timeStatuses.join(',') }, (0, dateTime_1.getVietnamWallClockDate)());
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : []),
            ...conditions,
        ];
    }
    if (weekdays.length && weekdays.length < 7) {
        // calendar.start_time được lưu dưới dạng giờ nghiệp vụ Việt Nam. WEEKDAY
        // đọc trực tiếp giá trị MySQL, tránh trình điều khiển chuyển múi giờ làm lệch thứ.
        const weekdayRows = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
      SELECT id
      FROM calendar
      WHERE WEEKDAY(start_time) + 1 IN (${client_1.Prisma.join(weekdays)})
    `);
        where.AND = [
            ...(Array.isArray(where.AND) ? where.AND : []),
            { id: { in: weekdayRows.map((row) => Number(row.id)) } },
        ];
    }
    if (columnFilters.assistantCondition) {
        const assistantRows = await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
      SELECT id FROM calendar WHERE ${columnFilters.assistantCondition}
    `);
        columnFilters.conditions.push({ id: { in: assistantRows.map(row => Number(row.id)) } });
    }
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...columnFilters.conditions];
    return { where, page, limit, skip, take, sortFields, requestedSortOrders };
};
const getCalendar = async (query, allowedPrograms = null, allowAllPrograms = false, rawRowsOnly = false) => {
    const { where, page, limit, skip, take, sortFields, requestedSortOrders } = await buildCalendarListQuery(query, allowedPrograms, allowAllPrograms);
    const orderBy = sortFields.length
        ? sortFields.map((field, index) => ({
            [field]: requestedSortOrders[index] ?? 'asc',
        }))
        : [{ start_time: 'asc' }];
    const [total, data] = await Promise.all([
        calendar_transaction_2.default.calendar.count({ where }),
        calendar_transaction_2.default.calendar.findMany({
            where,
            skip,
            take,
            orderBy: rawRowsOnly ? [...orderBy, { id: 'asc' }] : orderBy,
        }),
    ]);
    if (rawRowsOnly)
        return { total, page, limit, data };
    const canceledIds = data
        .filter((record) => Number(record.lesson_status) === 1)
        .map((record) => record.id);
    const latestCancelEligibility = canceledIds.length
        ? await calendar_transaction_2.default.$queryRaw(client_1.Prisma.sql `
        SELECT change_log.calendar_id,
               change_log.action,
               change_log.before_data,
               (
                 SELECT MIN(next_session.start_time)
                 FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS next_session
                 INNER JOIN calendar canceled_session ON canceled_session.deleted_at IS NULL AND canceled_session.id = change_log.calendar_id
                 WHERE next_session.code = canceled_session.code
                   AND next_session.system_type = canceled_session.system_type
                   AND (next_session.code LIKE 'feed-%') = (canceled_session.code LIKE 'feed-%')
                   AND next_session.start_time > canceled_session.start_time
                   AND COALESCE(next_session.lesson_status, 0) <> 1
               ) AS next_active_start_time
        FROM calendar_change_logs AS change_log
        INNER JOIN (
          SELECT calendar_id, MAX(id) AS latest_id
          FROM calendar_change_logs
          WHERE action NOT IN ('delete', 'restore') AND calendar_id IN (${client_1.Prisma.join(canceledIds)})
          GROUP BY calendar_id
        ) AS latest ON latest.latest_id = change_log.id
      `)
        : [];
    const latestActionByCalendarId = new Map(latestCancelEligibility.map((row) => [Number(row.calendar_id), row.action]));
    const originalLessonNameByCalendarId = new Map(latestCancelEligibility.map((row) => {
        const beforeData = typeof row.before_data === 'string'
            ? JSON.parse(row.before_data)
            : row.before_data;
        return [Number(row.calendar_id), beforeData?.source_session?.lesson_name ?? null];
    }));
    const canFollowingByCalendarId = new Map(latestCancelEligibility.map((row) => [
        Number(row.calendar_id),
        Boolean(row.next_active_start_time
            && new Date(row.next_active_start_time) > (0, dateTime_1.getVietnamWallClockDate)()),
    ]));
    await hydrateAssistantTeachers(calendar_transaction_2.default, data);
    const assignmentStatuses = data.length
        ? await calendar_transaction_2.default.classroom_assignment_history.groupBy({
            by: ['calendar_id'],
            where: { calendar_id: { in: data.map((record) => record.id) } },
            _max: { created_at: true },
        })
        : [];
    const assignmentStatusByCalendarId = new Map(assignmentStatuses.map((status) => [status.calendar_id, status._max.created_at]));
    const mappingKeys = data
        .map((record) => record.key)
        .filter((key) => Boolean(key));
    const mappingsByKey = await loadMappingsByKeys(calendar_transaction_2.default, mappingKeys);
    const evgStatuses = await (0, evg_status_1.getCalendarEvgStatuses)(calendar_transaction_2.default, data);
    return {
        total,
        page,
        limit,
        data: data.map((record) => {
            const hasAssignmentHistory = assignmentStatusByCalendarId.has(record.id);
            const isCancelled = Number(record.lesson_status) === 1;
            return {
                ...record,
                ...evgStatuses.get(record.id),
                calendar_source: (0, calendar_source_1.calendarSourceFromCode)(record.code),
                // Chỉ hiển thị đã chia lớp khi có lịch sử phân lớp được lưu.
                // Không suy diễn từ thời điểm bắt đầu của lịch vì lịch cũ có thể chưa từng được chia.
                classroom_assigned: !isCancelled && hasAssignmentHistory,
                classroom_assigned_at: assignmentStatusByCalendarId.get(record.id) ?? null,
                package_lesson_mappings: mappingsByKey.get(record.key || '') ?? [],
                can_create_makeup_after_cancel: isCancelled
                    && latestActionByCalendarId.get(record.id) === 'cancel',
                can_following_after_cancel: isCancelled
                    && latestActionByCalendarId.get(record.id) === 'cancel'
                    && canFollowingByCalendarId.get(record.id) === true,
                canceled_original_lesson_name: isCancelled
                    ? originalLessonNameByCalendarId.get(record.id) ?? null
                    : null,
            };
        }),
    };
};
exports.getCalendar = getCalendar;
const getCalendarRowsForExport = async (rawIds, allowedPrograms = null, programCode) => {
    const ids = String(rawIds ?? '')
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
    const scopedCalendarIds = allowedPrograms === null
        ? null
        : await getCalendarIdsForPrograms(allowedPrograms);
    const conditions = [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(String(programCode || '').trim() ? [{ code: String(programCode).trim() }] : []),
        ...(scopedCalendarIds === null ? [] : [{ id: { in: scopedCalendarIds } }]),
    ];
    const calendars = await calendar_transaction_2.default.calendar.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
    });
    const exportProgramCodes = [...new Set(calendars.map((row) => row.code))];
    const exportLessonIds = calendars.flatMap((row) => row.session_id == null ? [] : [BigInt(row.session_id)]);
    const exportLessons = await calendar_transaction_2.default.lessons.findMany({
        where: { status: { not: 0 }, OR: [{ subject_code: { in: exportProgramCodes } }, { id: { in: exportLessonIds } }] },
        select: { id: true, subject_code: true, system_type: true, subject_name: true, learn_number: true },
    });
    const exportLessonById = new Map(exportLessons.map((row) => [String(row.id), row]));
    const exportPrograms = new Map();
    for (const lesson of exportLessons)
        exportPrograms.set(lesson.subject_code, [...(exportPrograms.get(lesson.subject_code) || []), lesson]);
    const exportCourseMappings = exportLessons.length ? await calendar_transaction_2.default.lesson_course_mapping.findMany({
        where: { lesson_id: { in: exportLessons.map((lesson) => lesson.id) } },
        select: { lesson_id: true, course_id: true, package_id: true },
        orderBy: [{ course_id: 'asc' }, { package_id: 'asc' }],
    }) : [];
    const exportCoursesByLesson = new Map();
    for (const mapping of exportCourseMappings) {
        const id = String(mapping.lesson_id);
        exportCoursesByLesson.set(id, [...(exportCoursesByLesson.get(id) || []), mapping]);
    }
    await hydrateAssistantTeachers(calendar_transaction_2.default, calendars);
    const keys = calendars
        .map((calendar) => calendar.key)
        .filter((key) => Boolean(key));
    const mappings = keys.length
        ? await calendar_transaction_2.default.package_lesson_mapping.findMany({
            where: { key: { in: keys } },
            orderBy: [{ course_id: 'asc' }, { lesson_id: 'asc' }],
        })
        : [];
    const teachingUsernames = Array.from(new Set(calendars.flatMap((calendar) => [
        String(calendar.teacher || '').trim(),
        ...parseAssistantTeachers(calendar.assistant_teacher),
    ]).filter(Boolean)));
    const teachingProfiles = teachingUsernames.length
        ? await calendar_transaction_2.default.teacher_profiles.findMany({
            where: { username: { in: teachingUsernames } },
            select: { username: true, display_name: true },
        })
        : [];
    const displayNameByUsername = new Map(teachingProfiles.map((profile) => [
        profile.username,
        profile.display_name || '',
    ]));
    const mappingsByKey = new Map();
    mappings.forEach((mapping) => {
        if (!mapping.key)
            return;
        const current = mappingsByKey.get(mapping.key) ?? [];
        current.push(mapping);
        mappingsByKey.set(mapping.key, current);
    });
    // Calendar stores Vietnam wall-clock components in UTC. Do not add UTC+7
    // again: that would shift evening sessions to the next day in the export.
    const formatCalendarDateTime = (value) => {
        const local = value;
        const date = [
            String(local.getUTCDate()).padStart(2, '0'),
            String(local.getUTCMonth() + 1).padStart(2, '0'),
            local.getUTCFullYear(),
        ].join('/');
        const time = [
            String(local.getUTCHours()).padStart(2, '0'),
            String(local.getUTCMinutes()).padStart(2, '0'),
        ].join(':');
        return { date, time, weekday: local.getUTCDay() };
    };
    const formatDirectDateTime = (value) => [
        `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`,
        `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}:${String(value.getUTCSeconds()).padStart(2, '0')}`,
    ].join(' ');
    const exportDocumentLinks = (value) => {
        const text = String(value || '').trim();
        if (!text)
            return '';
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed))
                return text;
            return parsed
                .map((document) => (document && typeof document === 'object'
                ? String(document.link || '').trim()
                : String(document || '').trim()))
                .filter(Boolean)
                .join(', ');
        }
        catch {
            return text;
        }
    };
    const uniqueMappingValues = (calendarMappings, field) => Array.from(new Set(calendarMappings
        .map((mapping) => String(mapping[field] || '').trim())
        .filter(Boolean))).join(',');
    return calendars.map((calendar) => {
        const linkedProgram = calendar.session_id == null ? undefined : exportLessonById.get(String(calendar.session_id));
        const programCandidates = exportPrograms.get(calendar.code) || [];
        const exportSystem = (0, calendar_export_system_1.resolveCalendarExportSystem)(calendar, linkedProgram, programCandidates);
        const start = formatCalendarDateTime(calendar.start_time);
        const end = formatCalendarDateTime(calendar.end_time);
        const calendarMappings = mappingsByKey.get(calendar.key || '') ?? [];
        const courseSourceLessons = linkedProgram ? [linkedProgram] : programCandidates.filter((lesson) => lesson.learn_number === calendar.learn_number);
        const lessonMappings = courseSourceLessons.flatMap((lesson) => exportCoursesByLesson.get(String(lesson.id)) || []);
        const assistants = parseAssistantTeachers(calendar.assistant_teacher);
        const weekday = start.weekday === 0 ? 'CN' : String(start.weekday + 1);
        return {
            key: calendar.key || '',
            start_time: formatDirectDateTime(calendar.start_time),
            end_time: formatDirectDateTime(calendar.end_time),
            learn_number: calendar.learn_number,
            teacher: calendar.teacher || '',
            evg_banner: calendar.evg_banner || '',
            evg_stream: calendar.evg_stream || '',
            lesson_count: calendar.lesson_count ?? '',
            system_type: exportSystem,
            subject: calendar.subject || '',
            lesson_status: calendar.lesson_status,
            code: calendar.code,
            lesson_name: calendar.lesson_name || '',
            teacher_name: displayNameByUsername.get(String(calendar.teacher || ''))
                || calendar.teacher
                || '',
            live_date: start.date,
            weekday,
            time_range: `${start.time}-${end.time}`,
            lesson_document: exportDocumentLinks(calendar.lesson_document),
            lesson_baitap: calendar.lesson_baitap || '',
            archive_document: calendar.lesson_link || '',
            content_homework: '',
            assistant_name: (0, calendar_export_fields_1.assistantExportNames)(assistants, displayNameByUsername),
            sharepoint_link: calendar.lesson_link || '',
            course_ids: uniqueMappingValues(calendarMappings, 'course_id') || (0, calendar_export_fields_1.uniqueExportIds)(lessonMappings.map((mapping) => mapping.course_id)),
            lesson_ids: uniqueMappingValues(calendarMappings, 'lesson_id'),
            package_ids: uniqueMappingValues(calendarMappings, 'package_id') || (0, calendar_export_fields_1.uniqueExportIds)(lessonMappings.map((mapping) => mapping.package_id)),
            teacher_email: calendar.teacher || '',
            assistant_email: assistants.join(','),
        };
    });
};
exports.getCalendarRowsForExport = getCalendarRowsForExport;
const normalizeCalendarMappingUpdates = (updates) => {
    if (!Array.isArray(updates) || updates.length === 0) {
        throw new Error("Danh sách mapping cập nhật không được rỗng");
    }
    return updates.map((item, index) => ({
        row: Number(item?.row ?? index + 1),
        id: item?.id,
        key: String(item?.key ?? '').trim() || undefined,
        code: String(item?.code ?? '').trim() || undefined,
        learn_number: item?.learn_number,
        package_lesson_mappings: item?.package_lesson_mappings,
    }));
};
const findCalendarForMappingUpdate = async (client, input) => {
    const id = Number(input.id);
    if (Number.isInteger(id) && id > 0) {
        return client.calendar.findUnique({ where: { id } });
    }
    if (input.key) {
        return client.calendar.findFirst({ where: { key: input.key } });
    }
    const learnNumber = Number(input.learn_number);
    if (input.code && Number.isInteger(learnNumber) && learnNumber > 0) {
        const rows = await client.calendar.findMany({
            where: { code: input.code, learn_number: learnNumber },
            orderBy: { id: 'asc' },
            take: 2,
        });
        if (rows.length > 1) {
            throw new Error(`Dòng ${input.row}: Có nhiều lịch trùng ${input.code} / Buổi ${learnNumber}, vui lòng dùng ID hoặc key`);
        }
        return rows[0] || null;
    }
    throw new Error(`Dòng ${input.row}: Vui lòng cung cấp ID/key hoặc Mã lớp + Buổi học`);
};
const buildMappingUpdatePlan = async (updates) => {
    const plan = [];
    const seenCalendarIds = new Set();
    for (const update of updates) {
        try {
            const calendar = await findCalendarForMappingUpdate(calendar_transaction_2.default, update);
            if (!calendar)
                throw new Error('Không tìm thấy lịch học cần cập nhật');
            if (seenCalendarIds.has(Number(calendar.id))) {
                throw new Error('Lịch học bị lặp trong danh sách cập nhật');
            }
            seenCalendarIds.add(Number(calendar.id));
            const nextMappings = await normalizePackageLessonMappingsForUpdate(update.package_lesson_mappings);
            const currentMappings = calendar.key
                ? await calendar_transaction_2.default.package_lesson_mapping.findMany({
                    where: { key: calendar.key },
                    orderBy: [{ id: 'asc' }],
                })
                : [];
            plan.push({
                row: update.row,
                calendar,
                currentMappings,
                nextMappings,
            });
        }
        catch (error) {
            throw new Error(`Dòng ${update.row}: ${error?.message || 'Không thể kiểm tra mapping'}`);
        }
    }
    return plan;
};
const previewCalendarMappingUpdates = async (payload) => {
    const updates = normalizeCalendarMappingUpdates(payload?.updates);
    const plan = await buildMappingUpdatePlan(updates);
    return {
        count: plan.length,
        updates: plan.map((item) => ({
            row: item.row,
            id: item.calendar.id,
            key: item.calendar.key,
            code: item.calendar.code,
            learn_number: item.calendar.learn_number,
            lesson_name: item.calendar.lesson_name,
            current_mappings: item.currentMappings,
            next_mappings: item.nextMappings,
            current_label: mappingLabel(item.currentMappings),
            next_label: mappingLabel(item.nextMappings),
            package_lesson_mappings: item.nextMappings.map((mapping) => ({
                package_id: mapping.package_id,
                course_id: mapping.course_id,
                lesson_id: mapping.lesson_id,
            })),
        })),
    };
};
exports.previewCalendarMappingUpdates = previewCalendarMappingUpdates;
const updateCalendarMappingsImpl = async (payload, changeActor) => {
    const updates = normalizeCalendarMappingUpdates(payload?.updates);
    const plan = await buildMappingUpdatePlan(updates);
    return withCalendarTriggerErrorHint(() => calendar_transaction_2.default.$transaction(async (tx) => {
        const operationId = crypto_1.default.randomUUID();
        const results = [];
        await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
            for (let index = 0; index < plan.length; index += 1) {
                const item = plan[index];
                const calendar = await tx.calendar.findUnique({
                    where: { id: Number(item.calendar.id) },
                });
                if (!calendar)
                    throw new Error(`Dòng ${item.row}: Không tìm thấy lịch học cần cập nhật`);
                const mappingResult = await (0, hocmai_sync_queue_service_1.reconcileCalendarMappingsAndEnqueue)(tx, calendar, item.nextMappings, operationId, index + 1, true, true);
                if (mappingResult.changed) {
                    await tx.calendar.update({
                        where: { id: Number(calendar.id) },
                        data: { updated_at: new Date() },
                    });
                }
                await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                    eventType: 'updated',
                    before: calendar,
                    after: { ...calendar, package_lesson_mappings: item.nextMappings },
                    actor: changeActor,
                    operationId,
                });
                results.push({
                    id: calendar.id,
                    key: calendar.key,
                    code: calendar.code,
                    learn_number: calendar.learn_number,
                    package_lesson_mappings: item.nextMappings,
                });
            }
        });
        return { count: results.length, operationId, updates: results };
    }, {
        maxWait: 10_000,
        // Modal có thể cập nhật nhiều calendar trong cùng một transaction để
        // đảm bảo atomic; tránh timeout mặc định 5 giây giữa các vòng lặp.
        timeout: 120_000,
    }));
};
const resendCalendarsToHocmai = async (rawIds) => {
    if (!Array.isArray(rawIds))
        throw new Error('Danh sách lịch học không hợp lệ');
    const ids = Array.from(new Set(rawIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
    if (!ids.length)
        throw new Error('Vui lòng chọn ít nhất 1 lịch học');
    if (ids.length > 500)
        throw new Error('Mỗi lần gửi tối đa 500 lịch học');
    const result = await calendar_transaction_2.default.$transaction((tx) => (0, hocmai_sync_queue_service_1.enqueueCalendarsSyncBulk)(tx, ids), { maxWait: 10_000, timeout: 60_000 });
    return {
        requested: ids.length,
        queued: result.queuedIds.length,
        skipped: result.skippedIds.length,
        missing: result.missingIds.length,
        operation_id: result.operationId,
        queued_ids: result.queuedIds,
        skipped_ids: result.skippedIds,
        missing_ids: result.missingIds,
    };
};
exports.resendCalendarsToHocmai = resendCalendarsToHocmai;
const enqueueBulkCalendarUpdate = async (tx, before, after) => (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'update', after);
// Sửa nhiều lịch (Bulk Update)
const updateBulkImpl = async (config, changeActor) => {
    const { ids, config_mode, update_data } = config;
    // Một lần cập nhật có thể gồm nhiều lịch, mapping HMO, bản ghi audit/queue
    // và bổ sung user nhân sự còn thiếu. Với các lô lớn, 60 giây là không đủ và
    // Prisma sẽ đóng transaction khi các thay đổi vẫn đang được xử lý. Giữ toàn
    // bộ thao tác trong một transaction để bảo toàn tính nguyên tử, nhưng cho
    // phép tối đa 3 phút để hoàn tất một lô hợp lệ.
    const bulkTransactionOptions = { maxWait: 10_000, timeout: 180_000 };
    const applyScheduleDate = (value, currentTime) => {
        const dateText = String(value || '').trim();
        if (!dateText)
            return currentTime;
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
        if (!match)
            throw new Error('start_date phải có định dạng YYYY-MM-DD');
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const next = new Date(currentTime);
        next.setUTCFullYear(year, month - 1, day);
        if (next.getUTCFullYear() !== year || next.getUTCMonth() !== month - 1 || next.getUTCDate() !== day) {
            throw new Error('start_date không hợp lệ');
        }
        return next;
    };
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new Error("Missing or invalid ids array for bulk update");
    }
    // 1. CẤU HÌNH CHUNG: Tất cả các lịch chọn được cập nhật bằng 1 data chung
    if (config_mode === 'common') {
        if (!update_data)
            throw new Error("Missing update_data for common bulk update");
        const commonMappingUpdate = Array.isArray(update_data.package_lesson_mappings)
            ? await normalizePackageLessonMappingsForUpdate(update_data.package_lesson_mappings)
            : undefined;
        const dataToUpdate = {};
        if (update_data.calendar_source !== undefined)
            (0, calendar_source_1.resolveCalendarSource)(update_data.calendar_source);
        if (update_data.teacher)
            dataToUpdate.teacher = update_data.teacher;
        if (update_data.assistant_teacher !== undefined) {
            dataToUpdate.assistant_teacher = update_data.assistant_teacher;
        }
        if (update_data.room)
            dataToUpdate.channel_name = update_data.room;
        normalizeTeachingAssignmentsForScheduleUpdate(dataToUpdate);
        const hasCommonCalendarFieldUpdate = Object.keys(dataToUpdate).some((key) => key !== 'skip_teacher_user_sync');
        // LƯU Ý QUAN TRỌNG: 
        // Nếu đổi thời gian chung (ví dụ từ 19:00 -> 21:00) cho nhiều ngày khác nhau, 
        // ta KHÔNG THỂ dùng prisma.calendar.updateMany được, vì mỗi dòng có start_time/end_time thuộc ngày khác nhau.
        // Nếu có đổi thời gian, bắt buộc phải duyệt qua từng record để giữ ngày cũ và chỉ đắp giờ mới vào.
        if (update_data.start_time
            || update_data.end_time
            || dataToUpdate.teacher
            || dataToUpdate.assistant_teacher !== undefined
            || dataToUpdate.channel_name) {
            return await calendar_transaction_2.default.$transaction(async (tx) => {
                const results = [];
                const normalizedIds = ids.map((id) => Number(id));
                const sessions = await tx.calendar.findMany({
                    where: { id: { in: normalizedIds } },
                });
                await hydrateAssistantTeachers(tx, sessions);
                sessions.forEach((session) => {
                    (0, calendar_source_1.assertCalendarSourceUnchanged)(session, update_data);
                    assertCanUpdateSession(session);
                });
                const sessionsById = new Map(sessions.map((session) => [Number(session.id), session]));
                const finalCandidates = sessions.map((current) => {
                    let startTime = current.start_time;
                    let endTime = current.end_time;
                    if (update_data.start_time) {
                        const [hours, minutes] = update_data.start_time.split(':');
                        startTime = new Date(current.start_time);
                        startTime.setUTCHours(Number(hours), Number(minutes), 0, 0);
                    }
                    if (update_data.end_time) {
                        const [hours, minutes] = update_data.end_time.split(':');
                        endTime = new Date(current.end_time);
                        endTime.setUTCHours(Number(hours), Number(minutes), 0, 0);
                    }
                    return {
                        id: Number(current.id),
                        calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
                        teacher: dataToUpdate.teacher || current.teacher,
                        assistant_teacher: dataToUpdate.assistant_teacher !== undefined ? dataToUpdate.assistant_teacher : current.assistant_teacher,
                        code: current.code,
                        learn_number: current.learn_number,
                        lesson_name: current.lesson_name,
                        lesson_status: current.lesson_status,
                        start_time: startTime,
                        end_time: endTime,
                    };
                });
                await (0, exports.validateBulkScheduleChanges)(finalCandidates, sessions, tx, undefined, {
                    allow_shared_staff_schedule: config.allow_shared_staff_schedule,
                });
                const teamsEvents = [];
                const applyUpdates = async () => {
                    for (const idStr of ids) {
                        const id = Number(idStr);
                        const current = sessionsById.get(id);
                        if (!current)
                            continue;
                        let newStart = current.start_time;
                        let newEnd = current.end_time;
                        // Thay thế giờ/phút, giữ nguyên ngày/tháng/năm
                        if (update_data.start_time) {
                            const [hours, minutes] = update_data.start_time.split(':');
                            newStart = new Date(current.start_time);
                            newStart.setUTCHours(Number(hours), Number(minutes), 0, 0);
                        }
                        if (update_data.end_time) {
                            const [hours, minutes] = update_data.end_time.split(':');
                            newEnd = new Date(current.end_time);
                            newEnd.setUTCHours(Number(hours), Number(minutes), 0, 0);
                        }
                        const updated = await updateCalendarRecord(tx, id, {
                            ...dataToUpdate,
                            start_time: newStart,
                            end_time: newEnd,
                        }, current, true);
                        await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, current, updated);
                        await auditTimeChange(tx, current, updated, changeActor, config?.reason ?? config?.change_reason);
                        if (commonMappingUpdate) {
                            await assertMappingsBelongToCalendarLesson(tx, current, commonMappingUpdate);
                            await replacePackageLessonMappingForCalendar(tx, updated, commonMappingUpdate);
                        }
                        await enqueueBulkCalendarUpdate(tx, current, updated);
                        teamsEvents.push({
                            eventType: 'updated',
                            before: current,
                            after: updated,
                            actor: changeActor,
                        });
                        results.push(updated);
                    }
                    await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, teamsEvents);
                };
                await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, applyUpdates);
                return results;
            }, bulkTransactionOptions);
        }
        // Dù chỉ đổi giáo viên/phòng vẫn phải khóa và kiểm tra từng buổi để
        // không cập nhật lịch đã bắt đầu.
        return await calendar_transaction_2.default.$transaction(async (tx) => {
            const normalizedIds = ids.map((id) => Number(id));
            const sessions = await tx.calendar.findMany({
                where: { id: { in: normalizedIds } },
            });
            await hydrateAssistantTeachers(tx, sessions);
            sessions.forEach((session) => (0, exports.assertCanUpdateSessionMappings)(session, update_data, true));
            const results = [];
            const teachingProfileCache = new Map();
            const teamsEvents = [];
            const applyUpdates = async () => {
                for (const current of sessions) {
                    const updated = hasCommonCalendarFieldUpdate
                        ? await updateCalendarRecord(tx, current.id, dataToUpdate, current, true)
                        : current;
                    if (hasCommonCalendarFieldUpdate) {
                        await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, current, updated);
                    }
                    else {
                        await (0, calendar_user_sync_service_1.ensureCalendarTeachingUsers)(tx, updated, teachingProfileCache);
                    }
                    if (hasCommonCalendarFieldUpdate) {
                        await auditTimeChange(tx, current, updated, changeActor, config?.reason ?? config?.change_reason);
                    }
                    if (commonMappingUpdate) {
                        await assertMappingsBelongToCalendarLesson(tx, current, commonMappingUpdate);
                        await replacePackageLessonMappingForCalendar(tx, updated, commonMappingUpdate);
                    }
                    await enqueueBulkCalendarUpdate(tx, current, updated);
                    teamsEvents.push({
                        eventType: 'updated',
                        before: current,
                        after: updated,
                        actor: changeActor,
                    });
                    results.push(updated);
                }
                await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, teamsEvents);
            };
            await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, applyUpdates);
            return results;
        }, bulkTransactionOptions);
    }
    // 2. CẤU HÌNH RIÊNG: Mỗi bài học có data cập nhật riêng
    if (config_mode === 'separate') {
        if (!update_data || !Array.isArray(update_data)) {
            throw new Error("Missing or invalid update_data array for separate bulk update");
        }
        const mappingUpdatesById = new Map();
        for (const item of update_data) {
            if (Array.isArray(item.package_lesson_mappings)) {
                mappingUpdatesById.set(Number(item.id), await normalizePackageLessonMappingsForUpdate(item.package_lesson_mappings));
            }
        }
        return await calendar_transaction_2.default.$transaction(async (tx) => {
            const normalizedIds = update_data
                .map((item) => Number(item.id))
                .filter((id) => Number.isInteger(id) && id > 0);
            const sessions = await tx.calendar.findMany({
                where: { id: { in: normalizedIds } },
            });
            await hydrateAssistantTeachers(tx, sessions);
            sessions.forEach((session) => {
                for (const item of update_data.filter((item) => Number(item.id) === Number(session.id))) {
                    (0, exports.assertCanUpdateSessionMappings)(session, item, true);
                }
            });
            const sessionsById = new Map(sessions.map((session) => [Number(session.id), session]));
            const finalCandidates = [];
            for (const item of update_data) {
                const current = sessionsById.get(Number(item.id));
                if (!current)
                    continue;
                const assignments = {};
                if (item.teacher)
                    assignments.teacher = item.teacher;
                if (item.assistant_teacher !== undefined)
                    assignments.assistant_teacher = item.assistant_teacher;
                normalizeTeachingAssignmentsForScheduleUpdate(assignments);
                let startTime = current.start_time;
                let endTime = current.end_time;
                if (item.start_date) {
                    startTime = applyScheduleDate(item.start_date, current.start_time);
                    endTime = applyScheduleDate(item.start_date, current.end_time);
                }
                if (item.start_time) {
                    const [hours, minutes] = item.start_time.split(':');
                    startTime = new Date(startTime);
                    startTime.setUTCHours(Number(hours), Number(minutes), 0, 0);
                }
                if (item.end_time) {
                    const [hours, minutes] = item.end_time.split(':');
                    endTime = new Date(endTime);
                    endTime.setUTCHours(Number(hours), Number(minutes), 0, 0);
                }
                finalCandidates.push({
                    id: Number(current.id),
                    calendar_source: (0, calendar_source_1.calendarSourceFromCode)(current.code),
                    teacher: assignments.teacher || current.teacher,
                    assistant_teacher: assignments.assistant_teacher !== undefined ? assignments.assistant_teacher : current.assistant_teacher,
                    code: current.code,
                    learn_number: current.learn_number,
                    lesson_name: typeof item.lesson_name === 'string'
                        ? item.lesson_name.trim()
                        : current.lesson_name,
                    lesson_status: item.mark_as_holiday === true ? 1 : current.lesson_status,
                    start_time: startTime,
                    end_time: endTime,
                });
            }
            await (0, exports.validateBulkScheduleChanges)(finalCandidates, sessions, tx, undefined, {
                allow_shared_staff_schedule: config.allow_shared_staff_schedule,
            });
            const results = [];
            const teachingProfileCache = new Map();
            const teamsEvents = [];
            const applyUpdates = async () => {
                for (const item of update_data) {
                    const id = Number(item.id);
                    const current = sessionsById.get(id);
                    if (!current)
                        continue;
                    const dataToUpdate = {};
                    if (item.calendar_source !== undefined)
                        (0, calendar_source_1.assertCalendarSourceUnchanged)(current, item);
                    if (item.teacher)
                        dataToUpdate.teacher = item.teacher;
                    if (typeof item.lesson_name === 'string')
                        dataToUpdate.lesson_name = item.lesson_name.trim();
                    if (item.assistant_teacher !== undefined) {
                        dataToUpdate.assistant_teacher = item.assistant_teacher;
                    }
                    if (item.room)
                        dataToUpdate.channel_name = item.room;
                    normalizeTeachingAssignmentsForScheduleUpdate(dataToUpdate);
                    let newStart = current.start_time;
                    let newEnd = current.end_time;
                    if (item.start_date) {
                        newStart = applyScheduleDate(item.start_date, current.start_time);
                        newEnd = applyScheduleDate(item.start_date, current.end_time);
                    }
                    if (item.start_time) {
                        const [hours, minutes] = item.start_time.split(':');
                        newStart = new Date(newStart);
                        newStart.setUTCHours(Number(hours), Number(minutes), 0, 0);
                    }
                    if (item.end_time) {
                        const [hours, minutes] = item.end_time.split(':');
                        newEnd = new Date(newEnd);
                        newEnd.setUTCHours(Number(hours), Number(minutes), 0, 0);
                    }
                    if (item.mark_as_holiday === true) {
                        dataToUpdate.lesson_status = 1;
                        dataToUpdate.cancel_reason = 'Ngày nghỉ';
                    }
                    if (item.start_date || item.start_time || item.end_time) {
                        dataToUpdate.start_time = newStart;
                        dataToUpdate.end_time = newEnd;
                    }
                    // Phải xác định sau khi đã ghép ngày/giờ vào dataToUpdate. Nếu tính
                    // trước đoạn này, thao tác chỉ đổi thời gian sẽ bị hiểu nhầm là
                    // không có thay đổi và bỏ qua UPDATE calendar.
                    const hasCalendarFieldUpdate = Object.keys(dataToUpdate).some((key) => key !== 'skip_teacher_user_sync');
                    const mappingUpdate = mappingUpdatesById.get(id);
                    if (!hasCalendarFieldUpdate && mappingUpdate === undefined)
                        continue;
                    let updated = current;
                    if (hasCalendarFieldUpdate) {
                        updated = await updateCalendarRecord(tx, id, dataToUpdate, current, true);
                        await auditTimeChange(tx, current, updated, changeActor, item?.reason ?? config?.reason);
                    }
                    if (hasCalendarFieldUpdate) {
                        await (0, calendar_user_sync_service_1.syncCalendarTeachingUsers)(tx, current, updated);
                    }
                    else {
                        await (0, calendar_user_sync_service_1.ensureCalendarTeachingUsers)(tx, updated, teachingProfileCache);
                    }
                    if (mappingUpdate) {
                        await assertMappingsBelongToCalendarLesson(tx, current, mappingUpdate);
                        await replacePackageLessonMappingForCalendar(tx, updated, mappingUpdate);
                    }
                    await enqueueBulkCalendarUpdate(tx, current, updated);
                    teamsEvents.push({
                        eventType: item.mark_as_holiday === true ? 'cancelled' : 'updated',
                        before: current,
                        after: updated,
                        actor: changeActor,
                    });
                    results.push(updated);
                }
                await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, teamsEvents);
            };
            await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, applyUpdates);
            return results;
        }, bulkTransactionOptions);
    }
    throw new Error("Invalid config_mode");
};
/**
 * Quét lịch legacy để bổ sung enrollment giáo viên/trợ giảng còn thiếu trong
 * users. Không sửa calendar; với user đã tồn tại sẽ vá student_hmid còn thiếu
 * và chuẩn hóa name theo vai trò: giáo viên dùng "student_hmid - tên hiển thị",
 * trợ giảng dùng "student_hmid - Giáo viên". Xử lý theo lô để không giữ
 * transaction quá lâu.
 */
const backfillMissingCalendarTeachingUsers = async (ids, additionalUsers) => {
    const scanUsers = (0, calendar_user_sync_service_1.normalizeScanTeachingUsers)(additionalUsers);
    const batchSize = 100;
    let scanned = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];
    if (ids && ids.length > 0) {
        for (let i = 0; i < ids.length; i += batchSize) {
            const batchIds = ids.slice(i, i + batchSize);
            const batchResult = await calendar_transaction_2.default.$transaction(async (tx) => {
                // Đọc snapshot hiện tại và khóa lịch trong cùng transaction. Cron
                // không được dùng phân công cũ để cấp lại quyền sau thao tác sửa lịch.
                const calendars = await tx.$queryRaw(client_1.Prisma.sql `
          SELECT * FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar
          WHERE id IN (${client_1.Prisma.join(batchIds)})
          ORDER BY id ASC
          FOR UPDATE
        `);
                if (!calendars.length)
                    return { scanned: 0, created: 0, updated: 0, skipped: 0, errors: [] };
                let batchCreated = 0;
                let batchUpdated = 0;
                let batchSkipped = 0;
                const batchErrors = [];
                for (const calendar of calendars) {
                    try {
                        const result = await (0, calendar_user_sync_service_1.ensureCalendarScanTeachingUsers)(tx, calendar, scanUsers);
                        batchCreated += result.created;
                        batchUpdated += result.updated;
                        batchSkipped += result.skipped;
                    }
                    catch (error) {
                        batchErrors.push({
                            calendar_id: Number(calendar.id),
                            message: error?.message || 'Không thể bổ sung user nhân sự',
                        });
                    }
                }
                return {
                    scanned: calendars.length,
                    created: batchCreated,
                    updated: batchUpdated,
                    skipped: batchSkipped,
                    errors: batchErrors,
                };
            }, { maxWait: 10_000, timeout: 60_000 });
            scanned += batchResult.scanned;
            created += batchResult.created;
            updated += batchResult.updated;
            skipped += batchResult.skipped;
            errors.push(...batchResult.errors);
        }
    }
    else {
        let lastId = 0;
        while (true) {
            const batchResult = await calendar_transaction_2.default.$transaction(async (tx) => {
                const calendars = await tx.$queryRaw(client_1.Prisma.sql `
          SELECT * FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS calendar
          WHERE id > ${lastId}
          ORDER BY id ASC
          LIMIT ${batchSize}
          FOR UPDATE
        `);
                if (!calendars.length)
                    return { lastId: null, scanned: 0, created: 0, updated: 0, skipped: 0, errors: [] };
                let batchCreated = 0;
                let batchUpdated = 0;
                let batchSkipped = 0;
                const batchErrors = [];
                for (const calendar of calendars) {
                    try {
                        const result = await (0, calendar_user_sync_service_1.ensureCalendarScanTeachingUsers)(tx, calendar, scanUsers);
                        batchCreated += result.created;
                        batchUpdated += result.updated;
                        batchSkipped += result.skipped;
                    }
                    catch (error) {
                        batchErrors.push({
                            calendar_id: Number(calendar.id),
                            message: error?.message || 'Không thể bổ sung user nhân sự',
                        });
                    }
                }
                return {
                    lastId: Number(calendars[calendars.length - 1].id),
                    scanned: calendars.length,
                    created: batchCreated,
                    updated: batchUpdated,
                    skipped: batchSkipped,
                    errors: batchErrors,
                };
            }, { maxWait: 10_000, timeout: 60_000 });
            if (batchResult.lastId == null)
                break;
            lastId = batchResult.lastId;
            scanned += batchResult.scanned;
            created += batchResult.created;
            updated += batchResult.updated;
            skipped += batchResult.skipped;
            errors.push(...batchResult.errors);
        }
    }
    return {
        scanned,
        created,
        updated,
        skipped,
        failed: errors.length,
        errors,
    };
};
exports.backfillMissingCalendarTeachingUsers = backfillMissingCalendarTeachingUsers;
// Read-only helpers for approval planning. No calendar/queue writes occur here.
exports.approvalPreviewHelpers = {
    prepareCreate: prepareCalendarCreateData,
    copySession: copySessionData,
    rescheduleNames: getRescheduleLessonNameOptions,
    assertModifiable: exports.assertCanUpdateSessionMappings,
};
const createSingle = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('createSingle', args, () => createSingleImpl(...args));
exports.createSingle = createSingle;
const createBulk = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('createBulk', args, () => createBulkImpl(...args));
exports.createBulk = createBulk;
const createValidatedCalendarImport = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('createValidatedCalendarImport', args, () => createValidatedCalendarImportImpl(...args));
exports.createValidatedCalendarImport = createValidatedCalendarImport;
const createValidatedInternalCalendarImport = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('createValidatedInternalCalendarImport', args, () => createValidatedInternalCalendarImportImpl(...args));
exports.createValidatedInternalCalendarImport = createValidatedInternalCalendarImport;
const rescheduleSession = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('rescheduleSession', args, () => rescheduleSessionImpl(...args));
exports.rescheduleSession = rescheduleSession;
const swapSessionTimes = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('swapSessionTimes', args, () => swapSessionTimesImpl(...args));
exports.swapSessionTimes = swapSessionTimes;
const bulkRescheduleSessions = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('bulkRescheduleSessions', args, () => bulkRescheduleSessionsImpl(...args));
exports.bulkRescheduleSessions = bulkRescheduleSessions;
const updateSchedule = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('updateSchedule', args, () => updateScheduleImpl(...args));
exports.updateSchedule = updateSchedule;
const cancelSession = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('cancelSession', args, () => cancelSessionImpl(...args));
exports.cancelSession = cancelSession;
const deleteSession = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('deleteSession', args, () => deleteSessionImpl(...args));
exports.deleteSession = deleteSession;
const restoreSession = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('restoreSession', args, () => restoreSessionImpl(...args));
exports.restoreSession = restoreSession;
const updateCalendarMappings = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('updateCalendarMappings', args, () => updateCalendarMappingsImpl(...args));
exports.updateCalendarMappings = updateCalendarMappings;
const updateBulk = (...args) => (0, calendar_transaction_1.runObservedCalendarWrite)('updateBulk', args, () => updateBulkImpl(...args));
exports.updateBulk = updateBulk;
