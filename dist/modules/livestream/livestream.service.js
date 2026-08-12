"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBulk = exports.updateCalendarMappings = exports.previewCalendarMappingUpdates = exports.getCalendarRowsForExport = exports.getCalendar = exports.assertCalendarIdsInProgram = exports.assertSchedulingProgramExists = exports.deleteSession = exports.cancelSession = exports.updateSchedule = exports.bulkRescheduleSessions = exports.rescheduleSession = exports.createValidatedCalendarImport = exports.createBulk = exports.getHocmaiSectionsForProgramLesson = exports.getSchedulingPrograms = exports.getProgramLessonsForScheduling = exports.createSingle = exports.isSessionModifiable = void 0;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const hocmai_course_outline_service_1 = require("../../integrations/hocmai-course-outline.service");
const hocmai_sync_queue_service_1 = require("./hocmai-sync-queue.service");
const teams_notifications_1 = require("../teams-notifications");
const dateTime_1 = require("../../utils/dateTime");
const prisma = new client_1.PrismaClient();
const hmoSectionsCache = new Map();
const HMO_SECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
const normalizeChangeReason = (payload) => {
    const reason = String(payload?.reason ?? payload?.change_reason ?? '').trim();
    if (!reason) {
        throw new Error("Vui lòng nhập lý do thay đổi lịch học");
    }
    if (reason.length > 500) {
        throw new Error("Lý do thay đổi không được vượt quá 500 ký tự");
    }
    return reason;
};
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
const generateKey = (systemType, startTime, code, learnNumber, lessonCount) => {
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
    const sessionSuffix = sessionNum > 1 ? `_b${sessionNum}` : '';
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
        .map((item) => String(item).trim())
        .filter(Boolean)));
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
        const teacherProfiles = await client.$queryRaw(client_1.Prisma.sql `
      SELECT username, display_name
      FROM teacher_profiles
      WHERE username = ${teacher}
        AND can_view_stream_key = 1
        AND status = 1
      LIMIT 1
    `);
        const teacherProfile = teacherProfiles[0];
        if (teacherProfile) {
            teacher = String(teacherProfile.display_name || teacherProfile.username).trim();
        }
    }
    // calendar.teacher is free text/display_name, not a teacher_profile username.
    // Only assistants are account assignments and need profile validation.
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
const createCalendarRecord = async (client, data) => {
    const hasAssistants = Object.prototype.hasOwnProperty.call(data, 'assistant_teacher');
    const assistantTeacher = data.assistant_teacher ?? null;
    const hasSessionId = Object.prototype.hasOwnProperty.call(data, 'session_id');
    const sessionId = data.session_id ?? null;
    const prismaData = { ...data };
    delete prismaData.assistant_teacher;
    delete prismaData.session_id;
    const created = await client.calendar.create({ data: prismaData });
    if (hasAssistants) {
        await client.$executeRaw `
      UPDATE calendar
      SET assistant_teacher = ${assistantTeacher}
      WHERE id = ${created.id}
    `;
    }
    if (hasSessionId) {
        await client.$executeRaw `
      UPDATE calendar
      SET session_id = ${sessionId}
      WHERE id = ${created.id}
    `;
    }
    const result = { ...created };
    await hydrateAssistantTeachers(client, [result]);
    return result;
};
const updateCalendarRecord = async (client, id, data) => {
    const hasAssistants = Object.prototype.hasOwnProperty.call(data, 'assistant_teacher');
    const assistantTeacher = data.assistant_teacher ?? null;
    const hasSessionId = Object.prototype.hasOwnProperty.call(data, 'session_id');
    const sessionId = data.session_id ?? null;
    const prismaData = { ...data };
    delete prismaData.assistant_teacher;
    delete prismaData.session_id;
    const updated = await client.calendar.update({ where: { id }, data: prismaData });
    if (hasAssistants) {
        await client.$executeRaw `
      UPDATE calendar
      SET assistant_teacher = ${assistantTeacher}
      WHERE id = ${id}
    `;
    }
    if (hasSessionId) {
        await client.$executeRaw `
      UPDATE calendar
      SET session_id = ${sessionId}
      WHERE id = ${id}
    `;
    }
    const result = { ...updated };
    await hydrateAssistantTeachers(client, [result]);
    return result;
};
const normalizeRoom = (data) => {
    if (data?.room && !data.channel_name) {
        data.channel_name = data.room;
    }
    delete data.room;
    return data;
};
const hydrateLessonData = async (tx, input) => {
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
        return data;
    }
    let parsedSessionId;
    try {
        parsedSessionId = BigInt(sessionId);
    }
    catch {
        throw new Error("session_id không hợp lệ");
    }
    const lessons = await tx.$queryRawUnsafe('SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1 FOR SHARE', parsedSessionId);
    const lesson = lessons[0];
    if (!lesson) {
        throw new Error("Bài học không tồn tại hoặc đã ngừng hoạt động");
    }
    return {
        ...data,
        session_id: parsedSessionId,
        learn_number: lesson.learn_number,
        subject: lesson.subject_name,
        lesson_name: customLessonName || lesson.lesson_name,
        lesson_document: lesson.lesson_document,
        evg_banner: lesson.evg_banner,
        evg_stream: lesson.evg_stream,
        lesson_link: lesson.lesson_link,
        lesson_baitap: lesson.lesson_baitap,
        lesson_tomtat: lesson.lesson_tomtat,
        lesson_phuongphap: lesson.lesson_phuongphap,
        lesson_luuy: lesson.lesson_luuy,
        lesson_ketqua: lesson.lesson_ketqua,
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
const ensureAfterStartOnSameDate = (value, previousStart) => {
    if (startOfDay(value).getTime() === startOfDay(previousStart).getTime()
        && value <= previousStart) {
        throw new Error(`Nếu chọn ngày cuối khóa, giờ bắt đầu phải sau ${String(previousStart.getHours()).padStart(2, '0')}:${String(previousStart.getMinutes()).padStart(2, '0')}`);
    }
};
const isSessionModifiable = (session, now = new Date()) => {
    if (Number(session.lesson_status) === 1)
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
            return await prisma.$transaction(operation, {
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
const getNextLessonCount = async (tx, code, systemType, learnNumber) => {
    const latest = await tx.calendar.findFirst({
        where: {
            code,
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
const lessonIdentityKey = (code, systemType, learnNumber) => `${systemType}::${code}::${learnNumber}`;
const assertLessonCountAvailable = async (tx, code, systemType, learnNumber, lessonCount) => {
    const existing = await tx.calendar.findFirst({
        where: {
            code,
            system_type: systemType,
            learn_number: learnNumber,
            lesson_count: lessonCount,
        },
        select: { id: true, key: true },
    });
    if (existing) {
        throw new Error(`Bài ${learnNumber} của khóa ${code} đã có lịch b${lessonCount + 1}${existing.key ? ` (${existing.key})` : ''}`);
    }
};
const prepareCalendarCreateData = async (tx, input, reservedCounts) => {
    const data = normalizeRoom(await hydrateLessonData(tx, input));
    await normalizeTeachingAssignments(tx, data);
    if (!data.code) {
        throw new Error("Vui lòng cung cấp mã khóa học");
    }
    data.system_type = data.system_type || 'topclass';
    data.learn_number = normalizePositiveInteger(data.learn_number, 'learn_number');
    data.start_time = new Date(data.start_time);
    data.end_time = new Date(data.end_time);
    ensureValidTimeRange(data.start_time, data.end_time);
    const identity = lessonIdentityKey(data.code, data.system_type, data.learn_number);
    const reserved = reservedCounts?.get(identity) || new Set();
    let lessonCount = normalizeLessonCount(data.lesson_count);
    const isLessonCountProvided = lessonCount !== undefined;
    if (lessonCount !== undefined) {
        if (reserved.has(lessonCount)) {
            throw new Error(`Bài ${data.learn_number} của khóa ${data.code} bị trùng lịch b${lessonCount + 1} trong danh sách tạo`);
        }
        await assertLessonCountAvailable(tx, data.code, data.system_type, data.learn_number, lessonCount);
    }
    else {
        lessonCount = await getNextLessonCount(tx, data.code, data.system_type, data.learn_number);
        while (reserved.has(lessonCount)) {
            lessonCount += 1;
        }
    }
    data.lesson_count = lessonCount;
    data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount);
    const existingKey = await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } });
    if (existingKey && isLessonCountProvided) {
        throw new Error(`SessionId ${data.key} đã tồn tại`);
    }
    while (!isLessonCountProvided && await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } })) {
        lessonCount += 1;
        if (reserved.has(lessonCount))
            continue;
        data.lesson_count = lessonCount;
        data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount);
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
const replacePackageLessonMappingForCalendar = async (tx, calendar, mappings) => {
    const key = String(calendar?.key || '').trim();
    if (!key) {
        throw new Error(`Buổi ${calendar?.id || ''}: Lịch học không có key để cập nhật mapping`);
    }
    await tx.package_lesson_mapping.deleteMany({ where: { key } });
    await createPackageLessonMappingForCalendar(tx, calendar, mappings);
    await tx.calendar.update({
        where: { id: Number(calendar.id) },
        data: { updated_at: new Date() },
    });
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
    while (await tx.calendar.findFirst({ where: { key } })) {
        canceledNumber += 1;
        key = `${normalizedKey}_huy${canceledNumber}`;
    }
    if (key.length > 100) {
        throw new Error("Key lịch nghỉ vượt quá 100 ký tự");
    }
    return key;
};
// 1.3 & 5 Kiểm tra trùng lặp
const checkConflict = async ({ teacher, assistant_teacher, channel_name, code, start_time, end_time, id, client = prisma, }) => {
    ensureValidTimeRange(start_time, end_time);
    if (teacher) {
        const conflictTeacher = await client.calendar.findFirst({
            where: {
                teacher,
                start_time: { lt: end_time },
                end_time: { gt: start_time },
                id: id ? { not: id } : undefined
            }
        });
        if (conflictTeacher)
            throw new Error("Trùng lịch giáo viên");
    }
    const assistantTeachers = parseAssistantTeachers(assistant_teacher);
    if (assistantTeachers.length) {
        const overlappingSessions = await client.$queryRaw(client_1.Prisma.sql `
      SELECT assistant_teacher
      FROM calendar
      WHERE start_time < ${end_time}
        AND end_time > ${start_time}
        AND assistant_teacher IS NOT NULL
        ${id ? client_1.Prisma.sql `AND id <> ${id}` : client_1.Prisma.empty}
    `);
        const conflictAssistant = overlappingSessions.some((session) => {
            const assigned = new Set(parseAssistantTeachers(session.assistant_teacher));
            return assistantTeachers.some((username) => assigned.has(username));
        });
        if (conflictAssistant)
            throw new Error("Trùng lịch trợ giảng");
    }
    if (channel_name) {
        const conflictRoom = await client.calendar.findFirst({
            where: {
                channel_name,
                start_time: { lt: end_time },
                end_time: { gt: start_time },
                id: id ? { not: id } : undefined
            }
        });
        if (conflictRoom)
            throw new Error("Trùng lịch phòng học");
    }
    if (code) {
        const conflictCourse = await client.calendar.findFirst({
            where: {
                code,
                start_time: { lt: end_time },
                end_time: { gt: start_time },
                id: id ? { not: id } : undefined
            }
        });
        if (conflictCourse)
            throw new Error("Hai buổi cùng khóa không được trùng thời gian");
    }
};
// 1.1. Thêm từng lịch
const createSingle = async (data, changeActor) => {
    const resolvedMappings = await resolvePackageLessonMappings(data?.package_lesson_mappings);
    return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const { calendarData } = await prepareCalendarCreateData(tx, data);
        await checkConflict({
            teacher: calendarData.teacher,
            assistant_teacher: calendarData.assistant_teacher,
            channel_name: calendarData.channel_name,
            code: calendarData.code,
            start_time: calendarData.start_time,
            end_time: calendarData.end_time,
            client: tx,
        });
        const calendar = await createCalendarRecord(tx, calendarData);
        await createPackageLessonMappingForCalendar(tx, calendar, resolvedMappings);
        if (resolvedMappings.length) {
            await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'create', calendar);
        }
        await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
            eventType: 'created',
            after: calendar,
            actor: changeActor,
        });
        return calendar;
    })));
};
exports.createSingle = createSingle;
const getProgramLessonsForScheduling = async (programCode) => {
    const code = String(programCode || '').trim();
    if (!code)
        throw new Error('Vui lòng chọn Chương trình');
    const rows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT lesson.id, lesson.learn_number, lesson.lesson_name,
      (
        SELECT COUNT(*)
        FROM calendar AS calendar_row
        WHERE calendar_row.code = ${code}
          AND (
            calendar_row.session_id = lesson.id
            OR calendar_row.learn_number = lesson.learn_number
          )
      ) AS scheduled_count,
      (
        SELECT COUNT(*)
        FROM calendar AS calendar_row
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
    const rows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT program.code, MAX(program.subject_name) AS subject_name
    FROM (
      SELECT subject_code AS code, subject_name
      FROM lessons
      WHERE subject_code IS NOT NULL AND TRIM(subject_code) <> ''
      UNION ALL
      SELECT code, subject AS subject_name
      FROM calendar
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
const getHocmaiSectionsForProgramLesson = async (programCode, lessonId) => {
    const code = String(programCode || '').trim();
    let parsedLessonId;
    try {
        parsedLessonId = BigInt(lessonId);
    }
    catch {
        throw new Error('Bài học không hợp lệ');
    }
    const mappings = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT DISTINCT mapping.package_id, mapping.course_id
    FROM lesson_course_mapping AS mapping
    INNER JOIN lessons AS lesson ON lesson.id = mapping.lesson_id
    WHERE lesson.id = ${parsedLessonId}
      AND lesson.subject_code = ${code}
      AND lesson.status <> 0
    ORDER BY mapping.package_id ASC, mapping.course_id ASC
  `);
    if (!mappings.length)
        return [];
    const identity = mappings
        .map((mapping) => `${mapping.package_id}:${mapping.course_id}`)
        .join('|');
    const cacheKey = `${code}:${lessonId}:${identity}`;
    const cached = hmoSectionsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now())
        return cached.data;
    const outlines = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)(mappings.map((mapping) => ({
        packageId: String(mapping.package_id),
        courseId: String(mapping.course_id),
    })));
    const data = outlines.flatMap((outline) => outline.lessons.map((section) => ({
        package_id: outline.packageId,
        course_id: outline.courseId,
        lesson_id: section.lessonId,
        lesson_name: section.name,
    })));
    hmoSectionsCache.set(cacheKey, {
        expiresAt: Date.now() + HMO_SECTIONS_CACHE_TTL_MS,
        data,
    });
    return data;
};
exports.getHocmaiSectionsForProgramLesson = getHocmaiSectionsForProgramLesson;
// 1.2. Thêm nhiều lịch
const createBulk = async (config, changeActor) => {
    // We assume frontend sends fully constructed objects in an array "calendars"
    const { calendars } = config;
    if (!calendars || !Array.isArray(calendars)) {
        throw new Error("Missing calendars array for bulk insert");
    }
    const reservedCounts = new Map();
    const resolvedMappingsByIndex = [];
    for (const calendar of calendars) {
        resolvedMappingsByIndex.push(await resolvePackageLessonMappings(calendar?.package_lesson_mappings));
    }
    return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const createdCalendars = [];
        for (let index = 0; index < calendars.length; index += 1) {
            const cal = calendars[index];
            try {
                const { calendarData } = await prepareCalendarCreateData(tx, cal, reservedCounts);
                await checkConflict({
                    teacher: calendarData.teacher,
                    assistant_teacher: calendarData.assistant_teacher,
                    channel_name: calendarData.channel_name,
                    code: calendarData.code,
                    start_time: calendarData.start_time,
                    end_time: calendarData.end_time,
                    client: tx,
                });
                const calendar = await createCalendarRecord(tx, calendarData);
                await createPackageLessonMappingForCalendar(tx, calendar, resolvedMappingsByIndex[index]);
                if (resolvedMappingsByIndex[index].length) {
                    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'create', calendar);
                }
                await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                    eventType: 'created',
                    after: calendar,
                    actor: changeActor,
                });
                createdCalendars.push(calendar);
            }
            catch (error) {
                const lessonLabel = cal.lesson_name ? ` (${cal.lesson_name})` : '';
                throw new Error(`Buổi ${index + 1}${lessonLabel}: ${error.message || 'Không thể tạo lịch học'}`);
            }
        }
        return { count: createdCalendars.length, calendars: createdCalendars };
    })));
};
exports.createBulk = createBulk;
const createValidatedCalendarImport = async (rows, changeActor) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('Không có lịch hợp lệ để import');
    }
    const reservedCounts = new Map();
    const timeout = Number(process.env.CALENDAR_IMPORT_TRANSACTION_TIMEOUT_MS || 60_000);
    return withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, async () => {
        const createdCalendars = [];
        for (const row of rows) {
            try {
                const { calendarData } = await prepareCalendarCreateData(tx, row.calendar, reservedCounts);
                await checkConflict({
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
                if (row.mappings.length) {
                    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'create', calendar);
                }
                await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                    eventType: 'created',
                    after: calendar,
                    actor: changeActor,
                });
                createdCalendars.push(calendar);
            }
            catch (error) {
                throw new Error(`Dòng ${row.row}: ${error?.message || 'Không thể tạo lịch học'}`);
            }
        }
        return {
            count: createdCalendars.length,
            calendars: createdCalendars,
        };
    }), {
        isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000,
    }));
};
exports.createValidatedCalendarImport = createValidatedCalendarImport;
const cancelWithoutMakeup = async (tx, current, reason) => {
    return await tx.calendar.update({
        where: { id: current.id },
        data: { lesson_status: 1, cancel_reason: reason },
    });
};
const cancelWithMakeup = async (tx, current, payload, reason) => {
    const newSessionInput = normalizeRoom({ ...(payload.new_session || payload) });
    delete newSessionInput.mode;
    delete newSessionInput.update_mode;
    delete newSessionInput.reason;
    delete newSessionInput.change_reason;
    delete newSessionInput.course_end_time;
    await normalizeTeachingAssignments(tx, newSessionInput);
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
    ensureNotAfterCourseEnd(endTime, payload.course_end_time);
    ensureNotBeforeDate(startTime, current.start_time, "Ngày học bù không được trước ngày của buổi học hiện tại");
    await checkConflict({
        teacher: newSessionInput.teacher ?? current.teacher,
        assistant_teacher: newSessionInput.assistant_teacher ?? current.assistant_teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const canceledKey = await generateUniqueCanceledKey(tx, current.key);
    const newSessionData = {
        ...copySessionData(current),
        ...newSessionInput,
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? current.teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        lesson_status: 0,
        lesson_count: normalizeLessonCount(current.lesson_count) ?? 0,
        key: current.key,
    };
    // Giải phóng key gốc trước, sau đó gắn chính key đó cho lịch học bù.
    // Mapping không đổi vì vẫn trỏ đến key gốc đang hoạt động.
    const updatedCurrent = await tx.calendar.update({
        where: { id: current.id },
        data: {
            lesson_status: 1,
            cancel_reason: reason,
            key: canceledKey,
        },
    });
    const createdSession = await createCalendarRecord(tx, newSessionData);
    return { canceled_session: updatedCurrent, created_session: createdSession };
};
const rescheduleFollowing = async (tx, current, payload, reason) => {
    const newSessionInput = normalizeRoom({ ...(payload.new_session || {}) });
    await normalizeTeachingAssignments(tx, newSessionInput);
    if (!newSessionInput.start_time || !newSessionInput.end_time) {
        throw new Error("Vui lòng cung cấp new_session.start_time và new_session.end_time");
    }
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
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
    const allSessions = [current, ...followings];
    const lastSource = allSessions[allSessions.length - 1];
    await checkConflict({
        teacher: newSessionInput.teacher ?? lastSource.teacher,
        assistant_teacher: newSessionInput.assistant_teacher ?? lastSource.assistant_teacher,
        channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const canceledKey = await generateUniqueCanceledKey(tx, current.key);
    const updatedCurrent = await tx.calendar.update({
        where: { id: current.id },
        // Key gốc đi cùng lesson xuống slot kế tiếp. Row nghỉ dùng key riêng để
        // lưu lịch sử và không chiếm key đang hoạt động của lesson.
        data: {
            lesson_status: 1,
            cancel_reason: reason,
            key: canceledKey,
        },
    });
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
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? lastSource.teacher,
        channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
        lesson_status: 0,
        lesson_count: normalizeLessonCount(lastSource.lesson_count) ?? 0,
        key: lastSource.key,
    };
    const createdSession = await createCalendarRecord(tx, newSessionData);
    return {
        canceled_session: updatedCurrent,
        shifted_sessions: shiftedSessions,
        created_session: createdSession,
    };
};
const rescheduleSessionInTransaction = async (tx, id, payload, changeActor) => {
    const mode = payload.mode || payload.update_mode || 'cancel';
    const reason = normalizeChangeReason(payload);
    const actor = normalizeChangeActor(changeActor);
    const operationId = crypto_1.default.randomUUID();
    // Đọc và validate bên trong transaction để không dùng snapshot cũ khi có
    // hai yêu cầu cùng dời lịch của một khóa.
    const current = await tx.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    await hydrateAssistantTeachers(tx, [current]);
    assertCanUpdateSession(current);
    let action;
    let result;
    let beforeFollowingSessions = [];
    if (['cancel', 'cancel_only', 'no_makeup', 'no_make_up'].includes(mode)) {
        action = 'cancel';
        result = await cancelWithoutMakeup(tx, current, reason);
    }
    else if (['makeup', 'make_up', 'compensate'].includes(mode)) {
        action = 'makeup';
        result = await cancelWithMakeup(tx, current, payload, reason);
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
        result = await rescheduleFollowing(tx, current, payload, reason);
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
    await writeCalendarChangeLog(tx, {
        operationId,
        action,
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
    if (action === 'cancel') {
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
            {
                eventType: 'cancelled',
                before: current,
                after: result.canceled_session,
                actor,
                operationId,
            },
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
            {
                eventType: 'cancelled',
                before: current,
                after: result.canceled_session,
                actor,
                operationId,
            },
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
const rescheduleSession = async (id, payload, changeActor) => withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, () => rescheduleSessionInTransaction(tx, id, payload, changeActor))));
exports.rescheduleSession = rescheduleSession;
const bulkRescheduleSessions = async (payload, changeActor) => {
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
            };
            if (operation === 'makeup') {
                const startTime = new Date(session.start_time);
                const endTime = new Date(session.end_time);
                startTime.setDate(startTime.getDate() + offsetDays);
                endTime.setDate(endTime.getDate() + offsetDays);
                sessionPayload.new_session = {
                    start_time: startTime,
                    end_time: endTime,
                };
            }
            results.push(await rescheduleSessionInTransaction(tx, session.id, sessionPayload, changeActor));
        }
        return {
            operation,
            count: results.length,
            offset_days: operation === 'makeup' ? offsetDays : undefined,
            results,
        };
    }), 3, 120_000));
};
exports.bulkRescheduleSessions = bulkRescheduleSessions;
// 2.1 & 2.2 Sửa lịch
const updateSchedule = async (id, data, updateMode, changeActor) => {
    if (updateMode && updateMode !== 'current') {
        return await (0, exports.rescheduleSession)(id, { ...data, mode: updateMode }, changeActor);
    }
    if (data?.lesson_status !== undefined || data?.cancel_reason !== undefined) {
        throw new Error('Chỉ được đánh dấu nghỉ học qua thao tác Nghỉ học để bắt buộc lưu lý do');
    }
    const rawMappingUpdate = data?.package_lesson_mappings;
    const auditReason = data?.reason ?? data?.change_reason;
    const hasMappingUpdate = Array.isArray(rawMappingUpdate);
    const resolvedMappingUpdate = hasMappingUpdate
        ? await normalizePackageLessonMappingsForUpdate(rawMappingUpdate)
        : undefined;
    if (data.sessionId !== undefined
        || data.session_id !== undefined
        || data.lesson_id !== undefined) {
        data = await hydrateLessonData(prisma, data);
    }
    normalizeRoom(data);
    await normalizeTeachingAssignments(prisma, data);
    delete data.package_lesson_mappings;
    delete data.key;
    delete data.new_session;
    delete data.reason;
    delete data.change_reason;
    const current = await prisma.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    await hydrateAssistantTeachers(prisma, [current]);
    assertCanUpdateSession(current);
    delete data.allow_past;
    if (data.start_time)
        data.start_time = new Date(data.start_time);
    if (data.end_time)
        data.end_time = new Date(data.end_time);
    if (data.start_time
        || data.end_time
        || data.teacher
        || data.assistant_teacher !== undefined
        || data.channel_name) {
        await checkConflict({
            teacher: data.teacher ?? current.teacher,
            assistant_teacher: data.assistant_teacher ?? current.assistant_teacher,
            channel_name: data.channel_name ?? current.channel_name,
            code: current.code,
            start_time: data.start_time ?? current.start_time,
            end_time: data.end_time ?? current.end_time,
            id,
        });
    }
    return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
        const operation = async () => {
            const updated = await updateCalendarRecord(tx, id, data);
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
exports.updateSchedule = updateSchedule;
// 2.3 Nghỉ không dời
const cancelSession = async (id, payload, changeActor) => (0, exports.rescheduleSession)(id, { ...payload, mode: 'cancel' }, changeActor);
exports.cancelSession = cancelSession;
const deleteSession = async (id, changeActor) => withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
    const current = await tx.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    assertCanUpdateSession(current);
    if (current.key) {
        await tx.package_lesson_mapping.deleteMany({
            where: { key: current.key },
        });
    }
    const deleted = await tx.calendar.delete({ where: { id } });
    await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
        eventType: 'deleted',
        before: current,
        actor: changeActor,
    });
    return deleted;
}));
exports.deleteSession = deleteSession;
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
    const rows = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT DISTINCT calendar_row.id
    FROM calendar AS calendar_row
    LEFT JOIN lessons AS session_lesson
      ON session_lesson.id = calendar_row.session_id
     AND session_lesson.status <> 0
    WHERE session_lesson.subject_code IN (${client_1.Prisma.join(programs)})
       OR (
         calendar_row.session_id IS NULL
         AND EXISTS (
           SELECT 1
           FROM lessons AS legacy_lesson
           WHERE legacy_lesson.subject_code = calendar_row.code
             AND legacy_lesson.learn_number = calendar_row.learn_number
             AND legacy_lesson.status <> 0
             AND legacy_lesson.subject_code IN (${client_1.Prisma.join(programs)})
         )
       )
  `);
    return rows.map((row) => Number(row.id));
};
const assertSchedulingProgramExists = async (programCode) => {
    const program = await prisma.lessons.findFirst({
        where: { subject_code: programCode, status: { not: 0 } },
        select: { id: true },
    });
    if (!program)
        throw new Error('Chương trình không tồn tại hoặc chưa có đề cương');
};
exports.assertSchedulingProgramExists = assertSchedulingProgramExists;
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
const getCalendar = async (query, allowedPrograms = null) => {
    const page = normalizeNumber(query.page, 'page') ?? 1;
    const limit = normalizeNumber(query.limit, 'limit') ?? 10;
    if (page < 1)
        throw new Error('page phải lớn hơn 0');
    if (limit < 1 || limit > 100)
        throw new Error('limit phải nằm trong khoảng 1-100');
    const skip = (page - 1) * limit;
    const take = limit;
    const keyword = normalizeString(query.keyword);
    const code = normalizeString(query.code);
    const exactCode = normalizeString(query.code_exact);
    let teacher = normalizeString(query.teacher);
    const subject = normalizeString(query.subject);
    const classroom = normalizeString(query.classroom);
    const systemType = normalizeString(query.system_type);
    const timeStatus = normalizeString(query.time_status);
    const startTime = normalizeDate(query.start_time, 'start_time');
    const endTime = normalizeDate(query.end_time, 'end_time');
    if (!exactCode && !code) {
        throw new Error('Vui lòng chọn Chương trình');
    }
    const sortFields = (normalizeString(query.sort_by) || '')
        .split(',')
        .map((field) => field.trim())
        .filter((field) => CALENDAR_SORT_FIELDS.includes(field));
    const requestedSortOrders = (normalizeString(query.sort_order) || '')
        .split(',')
        .map((order) => normalizeSortOrder(order));
    if (teacher) {
        const teacherProfiles = await prisma.$queryRaw(client_1.Prisma.sql `
      SELECT display_name
      FROM teacher_profiles
      WHERE username = ${teacher}
        AND can_view_stream_key = 1
        AND status = 1
      LIMIT 1
    `);
        if (teacherProfiles[0]?.display_name) {
            teacher = teacherProfiles[0].display_name.trim();
        }
    }
    if (systemType && !CALENDAR_SYSTEM_TYPES.includes(systemType)) {
        throw new Error('system_type không hợp lệ');
    }
    if (timeStatus && !['upcoming', 'ongoing', 'completed'].includes(timeStatus)) {
        throw new Error('time_status không hợp lệ');
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
    // The deployed Prisma client does not expose calendar.session_id yet.
    // Resolve canonical ownership in parameterized SQL, then use the stable id field in Prisma.
    const programCondition = scopedCalendarIds === null
        ? null
        : { id: { in: scopedCalendarIds } };
    const where = programCondition ? { AND: [programCondition] } : {};
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
    if (teacher)
        where.teacher = { contains: teacher };
    if (subject)
        where.subject = { contains: subject };
    if (classroom)
        where.channel_name = { contains: classroom };
    if (systemType)
        where.system_type = systemType;
    if (startTime || endTime) {
        where.start_time = {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
        };
    }
    if (timeStatus) {
        const now = (0, dateTime_1.getVietnamWallClockDate)();
        const timeConditions = timeStatus === 'upcoming'
            ? [{ start_time: { gt: now } }]
            : timeStatus === 'completed'
                ? [{ end_time: { lt: now } }]
                : [
                    { start_time: { lte: now } },
                    { end_time: { gte: now } },
                ];
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), ...timeConditions];
    }
    const orderBy = sortFields.length
        ? sortFields.map((field, index) => ({
            [field]: requestedSortOrders[index] ?? 'asc',
        }))
        : [{ start_time: 'asc' }];
    const [total, data] = await Promise.all([
        prisma.calendar.count({ where }),
        prisma.calendar.findMany({
            where,
            skip,
            take,
            orderBy,
        }),
    ]);
    await hydrateAssistantTeachers(prisma, data);
    const mappingKeys = data
        .map((record) => record.key)
        .filter((key) => Boolean(key));
    const mappingsByKey = await loadMappingsByKeys(prisma, mappingKeys);
    return {
        total,
        page,
        limit,
        data: data.map((record) => ({
            ...record,
            package_lesson_mappings: mappingsByKey.get(record.key || '') ?? [],
        })),
    };
};
exports.getCalendar = getCalendar;
const getCalendarRowsForExport = async (rawIds, allowedPrograms = null) => {
    const ids = String(rawIds ?? '')
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0);
    const scopedCalendarIds = allowedPrograms === null
        ? null
        : await getCalendarIdsForPrograms(allowedPrograms);
    const conditions = [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(scopedCalendarIds === null ? [] : [{ id: { in: scopedCalendarIds } }]),
    ];
    const calendars = await prisma.calendar.findMany({
        where: conditions.length ? { AND: conditions } : {},
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
    });
    await hydrateAssistantTeachers(prisma, calendars);
    const keys = calendars
        .map((calendar) => calendar.key)
        .filter((key) => Boolean(key));
    const mappings = keys.length
        ? await prisma.package_lesson_mapping.findMany({
            where: { key: { in: keys } },
            orderBy: [{ course_id: 'asc' }, { lesson_id: 'asc' }],
        })
        : [];
    const teachingUsernames = Array.from(new Set(calendars.flatMap((calendar) => [
        String(calendar.teacher || '').trim(),
        ...parseAssistantTeachers(calendar.assistant_teacher),
    ]).filter(Boolean)));
    const teachingProfiles = teachingUsernames.length
        ? await prisma.teacher_profiles.findMany({
            where: { username: { in: teachingUsernames } },
            select: { username: true, display_name: true },
        })
        : [];
    const displayNameByUsername = new Map(teachingProfiles.map((profile) => [
        profile.username,
        profile.display_name || profile.username,
    ]));
    const mappingsByKey = new Map();
    mappings.forEach((mapping) => {
        if (!mapping.key)
            return;
        const current = mappingsByKey.get(mapping.key) ?? [];
        current.push(mapping);
        mappingsByKey.set(mapping.key, current);
    });
    const formatVietnamDateTime = (value) => {
        const local = new Date(value.getTime() + 7 * 60 * 60 * 1000);
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
        const start = formatVietnamDateTime(calendar.start_time);
        const end = formatVietnamDateTime(calendar.end_time);
        const calendarMappings = mappingsByKey.get(calendar.key || '') ?? [];
        const assistants = parseAssistantTeachers(calendar.assistant_teacher);
        const weekday = start.weekday === 0 ? 'Chủ Nhật' : `Thứ ${start.weekday + 1}`;
        return {
            subject: calendar.subject || '',
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
            assistant_name: assistants
                .map((username) => displayNameByUsername.get(username) || username)
                .join(', '),
            sharepoint_link: calendar.lesson_link || '',
            course_ids: uniqueMappingValues(calendarMappings, 'course_id'),
            lesson_ids: uniqueMappingValues(calendarMappings, 'lesson_id'),
            package_ids: uniqueMappingValues(calendarMappings, 'package_id'),
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
            const calendar = await findCalendarForMappingUpdate(prisma, update);
            if (!calendar)
                throw new Error('Không tìm thấy lịch học cần cập nhật');
            assertCanUpdateSession(calendar);
            if (seenCalendarIds.has(Number(calendar.id))) {
                throw new Error('Lịch học bị lặp trong danh sách cập nhật');
            }
            seenCalendarIds.add(Number(calendar.id));
            const nextMappings = await normalizePackageLessonMappingsForUpdate(update.package_lesson_mappings);
            const currentMappings = calendar.key
                ? await prisma.package_lesson_mapping.findMany({
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
const updateCalendarMappings = async (payload, changeActor) => {
    const updates = normalizeCalendarMappingUpdates(payload?.updates);
    const plan = await buildMappingUpdatePlan(updates);
    return withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
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
                assertCanUpdateSession(calendar);
                await replacePackageLessonMappingForCalendar(tx, calendar, item.nextMappings);
                await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, operationId, index + 1, 'update', calendar);
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
    }));
};
exports.updateCalendarMappings = updateCalendarMappings;
// Sửa nhiều lịch (Bulk Update)
const updateBulk = async (config, changeActor) => {
    const { ids, config_mode, update_data } = config;
    // Một lần cập nhật có thể gồm nhiều lịch, mapping HMO và bản ghi audit/queue.
    // Prisma mặc định chỉ cho interactive transaction 5 giây, không đủ cho luồng này.
    const bulkTransactionOptions = { maxWait: 10_000, timeout: 60_000 };
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
        if (update_data.teacher)
            dataToUpdate.teacher = update_data.teacher;
        if (update_data.assistant_teacher !== undefined) {
            dataToUpdate.assistant_teacher = update_data.assistant_teacher;
        }
        if (update_data.room)
            dataToUpdate.channel_name = update_data.room;
        await normalizeTeachingAssignments(prisma, dataToUpdate);
        // LƯU Ý QUAN TRỌNG: 
        // Nếu đổi thời gian chung (ví dụ từ 19:00 -> 21:00) cho nhiều ngày khác nhau, 
        // ta KHÔNG THỂ dùng prisma.calendar.updateMany được, vì mỗi dòng có start_time/end_time thuộc ngày khác nhau.
        // Nếu có đổi thời gian, bắt buộc phải duyệt qua từng record để giữ ngày cũ và chỉ đắp giờ mới vào.
        if (update_data.start_time
            || update_data.end_time
            || dataToUpdate.teacher
            || dataToUpdate.assistant_teacher !== undefined
            || dataToUpdate.channel_name) {
            return await prisma.$transaction(async (tx) => {
                const results = [];
                const applyUpdates = async () => {
                    for (const idStr of ids) {
                        const id = Number(idStr);
                        const current = await tx.calendar.findUnique({ where: { id } });
                        if (!current)
                            continue;
                        await hydrateAssistantTeachers(tx, [current]);
                        assertCanUpdateSession(current);
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
                        // Check conflict
                        await checkConflict({
                            teacher: dataToUpdate.teacher || current.teacher,
                            assistant_teacher: dataToUpdate.assistant_teacher ?? current.assistant_teacher,
                            channel_name: dataToUpdate.channel_name || current.channel_name,
                            code: current.code,
                            start_time: newStart,
                            end_time: newEnd,
                            id
                        });
                        const updated = await updateCalendarRecord(tx, id, {
                            ...dataToUpdate,
                            start_time: newStart,
                            end_time: newEnd,
                        });
                        await auditTimeChange(tx, current, updated, changeActor, config?.reason ?? config?.change_reason);
                        if (commonMappingUpdate) {
                            await assertMappingsBelongToCalendarLesson(tx, current, commonMappingUpdate);
                            await replacePackageLessonMappingForCalendar(tx, updated, commonMappingUpdate);
                        }
                        await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'update', updated);
                        await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                            eventType: 'updated',
                            before: current,
                            after: updated,
                            actor: changeActor,
                        });
                        results.push(updated);
                    }
                };
                await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, applyUpdates);
                return results;
            }, bulkTransactionOptions);
        }
        // Dù chỉ đổi giáo viên/phòng vẫn phải khóa và kiểm tra từng buổi để
        // không cập nhật lịch đã bắt đầu.
        return await prisma.$transaction(async (tx) => {
            const normalizedIds = ids.map((id) => Number(id));
            const sessions = await tx.calendar.findMany({
                where: { id: { in: normalizedIds } },
            });
            sessions.forEach(assertCanUpdateSession);
            const results = [];
            const applyUpdates = async () => {
                for (const current of sessions) {
                    const updated = await updateCalendarRecord(tx, current.id, dataToUpdate);
                    await auditTimeChange(tx, current, updated, changeActor, config?.reason ?? config?.change_reason);
                    if (commonMappingUpdate) {
                        await assertMappingsBelongToCalendarLesson(tx, current, commonMappingUpdate);
                        await replacePackageLessonMappingForCalendar(tx, updated, commonMappingUpdate);
                    }
                    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'update', updated);
                    await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                        eventType: 'updated',
                        before: current,
                        after: updated,
                        actor: changeActor,
                    });
                    results.push(updated);
                }
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
        return await prisma.$transaction(async (tx) => {
            const results = [];
            const applyUpdates = async () => {
                for (const item of update_data) {
                    const id = Number(item.id);
                    const current = await tx.calendar.findUnique({ where: { id } });
                    if (!current)
                        continue;
                    await hydrateAssistantTeachers(tx, [current]);
                    assertCanUpdateSession(current);
                    const dataToUpdate = {};
                    if (item.teacher)
                        dataToUpdate.teacher = item.teacher;
                    if (item.assistant_teacher !== undefined) {
                        dataToUpdate.assistant_teacher = item.assistant_teacher;
                    }
                    if (item.room)
                        dataToUpdate.channel_name = item.room;
                    await normalizeTeachingAssignments(tx, dataToUpdate);
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
                    if (item.start_date || item.start_time || item.end_time) {
                        dataToUpdate.start_time = newStart;
                        dataToUpdate.end_time = newEnd;
                    }
                    const mappingUpdate = mappingUpdatesById.get(id);
                    if (!Object.keys(dataToUpdate).length && mappingUpdate === undefined)
                        continue;
                    let updated = current;
                    if (Object.keys(dataToUpdate).length) {
                        await checkConflict({
                            teacher: dataToUpdate.teacher || current.teacher,
                            assistant_teacher: dataToUpdate.assistant_teacher ?? current.assistant_teacher,
                            channel_name: dataToUpdate.channel_name || current.channel_name,
                            code: current.code,
                            start_time: newStart,
                            end_time: newEnd,
                            id
                        });
                        updated = await updateCalendarRecord(tx, id, dataToUpdate);
                        await auditTimeChange(tx, current, updated, changeActor, item?.reason ?? config?.reason);
                    }
                    if (mappingUpdate) {
                        await assertMappingsBelongToCalendarLesson(tx, current, mappingUpdate);
                        await replacePackageLessonMappingForCalendar(tx, updated, mappingUpdate);
                    }
                    await (0, hocmai_sync_queue_service_1.enqueueCalendarSync)(tx, crypto_1.default.randomUUID(), 1, 'update', updated);
                    await (0, teams_notifications_1.enqueueCalendarTeamsNotification)(tx, {
                        eventType: 'updated',
                        before: current,
                        after: updated,
                        actor: changeActor,
                    });
                    results.push(updated);
                }
            };
            await (0, hocmai_sync_queue_service_1.withManualHocmaiQueue)(tx, applyUpdates);
            return results;
        }, bulkTransactionOptions);
    }
    throw new Error("Invalid config_mode");
};
exports.updateBulk = updateBulk;
