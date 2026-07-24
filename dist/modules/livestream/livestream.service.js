"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBulk = exports.getCalendar = exports.cancelSession = exports.updateSchedule = exports.rescheduleSession = exports.createBulk = exports.createSingle = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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
    return `${sysCode}_${schoolYear}_${code}_${learnNumber}_b${sessionNum}`;
};
const SYLLABUS_FIELDS = [
    'subject',
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
    'lesson_noti',
];
const COPY_SESSION_FIELDS = [
    'code',
    'learn_number',
    'subject',
    'teacher',
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
    'lesson_noti',
    'system_type',
];
const normalizeRoom = (data) => {
    if (data?.room && !data.channel_name) {
        data.channel_name = data.room;
    }
    delete data.room;
    return data;
};
const hydrateLessonData = async (tx, input) => {
    const data = { ...input };
    const lessonId = data.lesson_id;
    const customLessonName = typeof data.lesson_name === 'string'
        ? data.lesson_name.trim()
        : '';
    if (customLessonName.length > 400) {
        throw new Error("lesson_name không được vượt quá 400 ký tự");
    }
    delete data.lesson_id;
    delete data.grade;
    delete data.subject_code;
    delete data.subject_name;
    // Các client cũ không gửi lesson_id vẫn tiếp tục dùng payload calendar hiện tại.
    if (lessonId === undefined || lessonId === null || lessonId === '') {
        return data;
    }
    let parsedLessonId;
    try {
        parsedLessonId = BigInt(lessonId);
    }
    catch {
        throw new Error("lesson_id không hợp lệ");
    }
    const lessons = await tx.$queryRawUnsafe('SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1', parsedLessonId);
    const lesson = lessons[0];
    if (!lesson) {
        throw new Error("Bài học không tồn tại hoặc đã ngừng hoạt động");
    }
    return {
        ...data,
        learn_number: lesson.learn_number,
        subject: lesson.subject_name,
        lesson_name: customLessonName || lesson.lesson_name,
        lesson_document: lesson.lesson_document,
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
const assertCanUpdateSession = (session, allowPast = false) => {
    if (!allowPast && session.end_time && new Date(session.end_time) <= new Date()) {
        throw new Error("Không được sửa buổi học đã diễn ra");
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
const replacePackageLessonMapping = async (tx, sourceKey, targetKey, targetLearnNumber) => {
    if (!sourceKey || !targetKey)
        return;
    const sourceMappings = await tx.package_lesson_mapping.findMany({
        where: { key: sourceKey },
    });
    await tx.package_lesson_mapping.deleteMany({
        where: { key: targetKey },
    });
    if (sourceMappings.length === 0)
        return;
    await tx.package_lesson_mapping.createMany({
        data: sourceMappings.map((mapping) => ({
            package_id: mapping.package_id,
            lesson_id: mapping.lesson_id,
            code: mapping.code,
            learn_number: targetLearnNumber,
            key: targetKey,
        })),
    });
};
const copySessionData = (source) => {
    const data = {};
    COPY_SESSION_FIELDS.forEach((field) => {
        data[field] = source[field];
    });
    return data;
};
const copySyllabusData = (source) => {
    const data = {
        learn_number: source.learn_number,
    };
    SYLLABUS_FIELDS.forEach((field) => {
        data[field] = source[field];
    });
    return data;
};
const clearSyllabusData = () => {
    const data = {};
    SYLLABUS_FIELDS.forEach((field) => {
        data[field] = null;
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
    return data;
};
const generateUniqueKey = async (tx, systemType, startTime, code, learnNumber, lessonCount) => {
    let nextLessonCount = lessonCount;
    let key = generateKey(systemType, startTime, code, learnNumber, nextLessonCount);
    while (await tx.calendar.findFirst({ where: { key } })) {
        nextLessonCount += 1;
        key = generateKey(systemType, startTime, code, learnNumber, nextLessonCount);
    }
    return { key, lesson_count: nextLessonCount };
};
// 1.3 & 5 Kiểm tra trùng lặp
const checkConflict = async ({ teacher, channel_name, code, start_time, end_time, id, client = prisma, }) => {
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
const createSingle = async (data) => {
    const calendarData = await prepareCalendarCreateData(prisma, data);
    await checkConflict({
        teacher: calendarData.teacher,
        channel_name: calendarData.channel_name,
        code: calendarData.code,
        start_time: calendarData.start_time,
        end_time: calendarData.end_time,
    });
    return await withCalendarTriggerErrorHint(() => prisma.calendar.create({ data: calendarData }));
};
exports.createSingle = createSingle;
// 1.2. Thêm nhiều lịch
const createBulk = async (config) => {
    // We assume frontend sends fully constructed objects in an array "calendars"
    const { calendars } = config;
    if (!calendars || !Array.isArray(calendars)) {
        throw new Error("Missing calendars array for bulk insert");
    }
    const reservedCounts = new Map();
    return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
        const createdCalendars = [];
        for (let index = 0; index < calendars.length; index += 1) {
            const cal = calendars[index];
            try {
                const calendarData = await prepareCalendarCreateData(tx, cal, reservedCounts);
                await checkConflict({
                    teacher: calendarData.teacher,
                    channel_name: calendarData.channel_name,
                    code: calendarData.code,
                    start_time: calendarData.start_time,
                    end_time: calendarData.end_time,
                    client: tx,
                });
                createdCalendars.push(await tx.calendar.create({ data: calendarData }));
            }
            catch (error) {
                const lessonLabel = cal.lesson_name ? ` (${cal.lesson_name})` : '';
                throw new Error(`Buổi ${index + 1}${lessonLabel}: ${error.message || 'Không thể tạo lịch học'}`);
            }
        }
        return { count: createdCalendars.length, calendars: createdCalendars };
    }));
};
exports.createBulk = createBulk;
const cancelWithoutMakeup = async (tx, current) => {
    return await tx.calendar.update({
        where: { id: current.id },
        data: { lesson_status: 1 },
    });
};
const cancelWithMakeup = async (tx, current, payload) => {
    const newSessionInput = normalizeRoom({ ...(payload.new_session || payload) });
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
    const systemType = String(current.system_type || 'topclass');
    ensureNotAfterCourseEnd(endTime, payload.course_end_time);
    ensureNotBeforeDate(startTime, current.start_time, "Ngày học bù không được trước ngày của buổi học hiện tại");
    await checkConflict({
        teacher: newSessionInput.teacher ?? current.teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const requestedLessonCount = await getNextLessonCount(tx, current.code, systemType, current.learn_number);
    const uniqueKey = await generateUniqueKey(tx, systemType, startTime, current.code, current.learn_number, requestedLessonCount);
    const newSessionData = {
        ...copySessionData(current),
        ...newSessionInput,
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? current.teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        lesson_status: 0,
        lesson_count: uniqueKey.lesson_count,
        key: uniqueKey.key,
    };
    const [updatedCurrent, createdSession] = await Promise.all([
        tx.calendar.update({
            where: { id: current.id },
            data: { lesson_status: 1 },
        }),
        tx.calendar.create({ data: newSessionData }),
    ]);
    await replacePackageLessonMapping(tx, current.key, createdSession.key, createdSession.learn_number);
    return { canceled_session: updatedCurrent, created_session: createdSession };
};
const rescheduleFollowing = async (tx, current, payload) => {
    const newSessionInput = normalizeRoom({ ...(payload.new_session || {}) });
    if (!newSessionInput.start_time || !newSessionInput.end_time) {
        throw new Error("Vui lòng cung cấp new_session.start_time và new_session.end_time");
    }
    const startTime = new Date(newSessionInput.start_time);
    const endTime = new Date(newSessionInput.end_time);
    const systemType = String(current.system_type || 'topclass');
    const lastCourseSession = await tx.calendar.findFirst({
        where: {
            code: current.code,
            system_type: current.system_type,
        },
        orderBy: [{ end_time: 'desc' }, { id: 'desc' }],
        select: { end_time: true },
    });
    ensureNotBeforeDate(startTime, lastCourseSession?.end_time ?? current.end_time, "Ngày buổi mới không được trước ngày kết thúc khóa");
    await checkConflict({
        teacher: newSessionInput.teacher ?? current.teacher,
        channel_name: newSessionInput.channel_name ?? current.channel_name,
        code: current.code,
        start_time: startTime,
        end_time: endTime,
        client: tx,
    });
    const followings = await tx.calendar.findMany({
        where: {
            code: current.code,
            system_type: current.system_type,
            start_time: { gt: current.start_time },
        },
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
    });
    const allSessions = [current, ...followings];
    const updatedCurrent = await tx.calendar.update({
        where: { id: current.id },
        data: {
            lesson_status: 1,
            ...clearSyllabusData(),
        },
    });
    const shiftedSessions = [];
    for (let i = 0; i < followings.length; i++) {
        const targetSession = followings[i];
        const sourceSession = allSessions[i];
        const updateData = copySyllabusData(sourceSession);
        const shiftedSession = await tx.calendar.update({
            where: { id: targetSession.id },
            data: updateData,
        });
        await replacePackageLessonMapping(tx, sourceSession.key, targetSession.key, sourceSession.learn_number);
        shiftedSessions.push(shiftedSession);
    }
    const lastSource = allSessions[allSessions.length - 1];
    const requestedLessonCount = await getNextLessonCount(tx, current.code, systemType, lastSource.learn_number);
    const uniqueKey = await generateUniqueKey(tx, systemType, startTime, current.code, lastSource.learn_number, requestedLessonCount);
    const newSessionData = {
        ...copySessionData(lastSource),
        ...newSessionInput,
        start_time: startTime,
        end_time: endTime,
        teacher: newSessionInput.teacher ?? lastSource.teacher,
        channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
        lesson_status: 0,
        lesson_count: uniqueKey.lesson_count,
        key: uniqueKey.key,
    };
    const createdSession = await tx.calendar.create({ data: newSessionData });
    await replacePackageLessonMapping(tx, lastSource.key, createdSession.key, createdSession.learn_number);
    return {
        canceled_session: updatedCurrent,
        shifted_sessions: shiftedSessions,
        created_session: createdSession,
    };
};
const rescheduleSession = async (id, payload) => {
    const mode = payload.mode || payload.update_mode || 'cancel';
    const current = await prisma.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    assertCanUpdateSession(current, Boolean(payload.allow_past));
    return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
        if (['cancel', 'cancel_only', 'no_makeup', 'no_make_up'].includes(mode)) {
            return await cancelWithoutMakeup(tx, current);
        }
        if (['makeup', 'make_up', 'compensate'].includes(mode)) {
            return await cancelWithMakeup(tx, current, payload);
        }
        if (mode === 'following') {
            return await rescheduleFollowing(tx, current, payload);
        }
        throw new Error("Invalid reschedule mode");
    }));
};
exports.rescheduleSession = rescheduleSession;
// 2.1 & 2.2 Sửa lịch
const updateSchedule = async (id, data, updateMode) => {
    if (updateMode && updateMode !== 'current') {
        return await (0, exports.rescheduleSession)(id, { ...data, mode: updateMode });
    }
    normalizeRoom(data);
    delete data.key;
    delete data.new_session;
    const current = await prisma.calendar.findUnique({ where: { id } });
    if (!current)
        throw new Error("Not found");
    assertCanUpdateSession(current, Boolean(data.allow_past));
    delete data.allow_past;
    if (data.start_time)
        data.start_time = new Date(data.start_time);
    if (data.end_time)
        data.end_time = new Date(data.end_time);
    if (data.start_time || data.end_time || data.teacher || data.channel_name) {
        await checkConflict({
            teacher: data.teacher ?? current.teacher,
            channel_name: data.channel_name ?? current.channel_name,
            code: current.code,
            start_time: data.start_time ?? current.start_time,
            end_time: data.end_time ?? current.end_time,
            id,
        });
    }
    return await withCalendarTriggerErrorHint(() => prisma.calendar.update({ where: { id }, data }));
};
exports.updateSchedule = updateSchedule;
// 2.3 Nghỉ không dời
const cancelSession = async (id) => (0, exports.rescheduleSession)(id, { mode: 'cancel' });
exports.cancelSession = cancelSession;
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
// 3. Lấy danh sách lịch
const getCalendar = async (query) => {
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
    const teacher = normalizeString(query.teacher);
    const subject = normalizeString(query.subject);
    const classroom = normalizeString(query.classroom);
    const systemType = normalizeString(query.system_type);
    const lessonStatus = normalizeNumber(query.lesson_status, 'lesson_status');
    const startTime = normalizeDate(query.start_time, 'start_time');
    const endTime = normalizeDate(query.end_time, 'end_time');
    const sortFields = (normalizeString(query.sort_by) || '')
        .split(',')
        .map((field) => field.trim())
        .filter((field) => CALENDAR_SORT_FIELDS.includes(field));
    const requestedSortOrders = (normalizeString(query.sort_order) || '')
        .split(',')
        .map((order) => normalizeSortOrder(order));
    if (systemType && !CALENDAR_SYSTEM_TYPES.includes(systemType)) {
        throw new Error('system_type không hợp lệ');
    }
    if (lessonStatus !== undefined && ![0, 1, 2].includes(lessonStatus)) {
        throw new Error('lesson_status không hợp lệ');
    }
    if (startTime && endTime && startTime > endTime) {
        throw new Error('Khoảng thời gian không hợp lệ');
    }
    const where = {};
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
    if (exactCode) {
        where.code = exactCode;
    }
    else if (code) {
        where.code = { contains: code };
    }
    if (teacher)
        where.teacher = { contains: teacher };
    if (subject)
        where.subject = { contains: subject };
    if (classroom)
        where.channel_name = { contains: classroom };
    if (systemType)
        where.system_type = systemType;
    if (lessonStatus !== undefined)
        where.lesson_status = lessonStatus;
    if (startTime || endTime) {
        where.start_time = {
            ...(startTime ? { gte: startTime } : {}),
            ...(endTime ? { lte: endTime } : {}),
        };
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
    return { total, page, limit, data };
};
exports.getCalendar = getCalendar;
// Sửa nhiều lịch (Bulk Update)
const updateBulk = async (config) => {
    const { ids, config_mode, update_data } = config;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new Error("Missing or invalid ids array for bulk update");
    }
    // 1. CẤU HÌNH CHUNG: Tất cả các lịch chọn được cập nhật bằng 1 data chung
    if (config_mode === 'common') {
        if (!update_data)
            throw new Error("Missing update_data for common bulk update");
        const dataToUpdate = {};
        if (update_data.teacher)
            dataToUpdate.teacher = update_data.teacher;
        if (update_data.room)
            dataToUpdate.room = update_data.room;
        // LƯU Ý QUAN TRỌNG: 
        // Nếu đổi thời gian chung (ví dụ từ 19:00 -> 21:00) cho nhiều ngày khác nhau, 
        // ta KHÔNG THỂ dùng prisma.calendar.updateMany được, vì mỗi dòng có start_time/end_time thuộc ngày khác nhau.
        // Nếu có đổi thời gian, bắt buộc phải duyệt qua từng record để giữ ngày cũ và chỉ đắp giờ mới vào.
        if (update_data.start_time || update_data.end_time) {
            return await prisma.$transaction(async (tx) => {
                const results = [];
                for (const idStr of ids) {
                    const id = Number(idStr);
                    const current = await tx.calendar.findUnique({ where: { id } });
                    if (!current)
                        continue;
                    let newStart = current.start_time;
                    let newEnd = current.end_time;
                    // Thay thế giờ/phút, giữ nguyên ngày/tháng/năm
                    if (update_data.start_time) {
                        const [hours, minutes] = update_data.start_time.split(':');
                        newStart = new Date(current.start_time);
                        newStart.setHours(Number(hours), Number(minutes), 0, 0);
                    }
                    if (update_data.end_time) {
                        const [hours, minutes] = update_data.end_time.split(':');
                        newEnd = new Date(current.end_time);
                        newEnd.setHours(Number(hours), Number(minutes), 0, 0);
                    }
                    // Check conflict
                    await checkConflict({
                        teacher: dataToUpdate.teacher || current.teacher,
                        start_time: newStart,
                        end_time: newEnd,
                        id
                    });
                    const updated = await tx.calendar.update({
                        where: { id },
                        data: {
                            ...dataToUpdate,
                            start_time: newStart,
                            end_time: newEnd,
                        }
                    });
                    results.push(updated);
                }
                return results;
            });
        }
        // Nếu không đổi thời gian (chỉ đổi giáo viên, phòng) thì dùng updateMany cho nhanh
        return await prisma.calendar.updateMany({
            where: { id: { in: ids.map((id) => Number(id)) } },
            data: dataToUpdate
        });
    }
    // 2. CẤU HÌNH RIÊNG: Mỗi bài học có data cập nhật riêng
    if (config_mode === 'separate') {
        if (!update_data || !Array.isArray(update_data)) {
            throw new Error("Missing or invalid update_data array for separate bulk update");
        }
        return await prisma.$transaction(async (tx) => {
            const results = [];
            for (const item of update_data) {
                const id = Number(item.id);
                const current = await tx.calendar.findUnique({ where: { id } });
                if (!current)
                    continue;
                const dataToUpdate = {};
                if (item.teacher)
                    dataToUpdate.teacher = item.teacher;
                if (item.room)
                    dataToUpdate.room = item.room;
                let newStart = current.start_time;
                let newEnd = current.end_time;
                if (item.start_time) {
                    const [hours, minutes] = item.start_time.split(':');
                    newStart = new Date(current.start_time);
                    newStart.setHours(Number(hours), Number(minutes), 0, 0);
                }
                if (item.end_time) {
                    const [hours, minutes] = item.end_time.split(':');
                    newEnd = new Date(current.end_time);
                    newEnd.setHours(Number(hours), Number(minutes), 0, 0);
                }
                if (item.start_time || item.end_time) {
                    dataToUpdate.start_time = newStart;
                    dataToUpdate.end_time = newEnd;
                }
                // Check conflict
                await checkConflict({
                    teacher: dataToUpdate.teacher || current.teacher,
                    start_time: newStart,
                    end_time: newEnd,
                    id
                });
                const updated = await tx.calendar.update({
                    where: { id },
                    data: dataToUpdate
                });
                results.push(updated);
            }
            return results;
        });
    }
    throw new Error("Invalid config_mode");
};
exports.updateBulk = updateBulk;
