"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCalendarTeachingUsers = exports.ensureCalendarTeachingUsers = exports.resolveCalendarTeacherProfile = exports.buildCalendarRoomClassId = exports.buildCalendarClassId = exports.excelDateSerialFromCalendarDate = void 0;
const client_1 = require("@prisma/client");
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const normalizeText = (value) => String(value ?? '').trim();
const parseAssistantTeachers = (value) => Array.from(new Set((Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(normalizeText)
    .filter(Boolean)));
const isActiveSchedule = (calendar) => (!!calendar && Number(calendar.lesson_status ?? 0) !== 1);
const teachingAssignmentsMatch = (before, after) => (normalizeText(before.teacher) === normalizeText(after.teacher)
    && parseAssistantTeachers(before.assistant_teacher).sort().join(',')
        === parseAssistantTeachers(after.assistant_teacher).sort().join(','));
/**
 * Excel dùng hệ ngày 1900 và giữ lại leap-year bug lịch sử. Epoch 30/12/1899
 * cho kết quả tương đương VALUE(date) với mọi ngày nghiệp vụ hiện đại.
 * Calendar đang lưu giờ Việt Nam dưới dạng UTC wall-clock nên phải lấy các
 * thành phần UTC, không đổi timezone trước khi tính ngày.
 */
const excelDateSerialFromCalendarDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        throw new Error('Ngày lịch học không hợp lệ');
    const dateOnlyUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((dateOnlyUtc - EXCEL_EPOCH_UTC) / DAY_IN_MS);
};
exports.excelDateSerialFromCalendarDate = excelDateSerialFromCalendarDate;
const buildCalendarClassId = (code, startTime, learnNumber) => {
    const normalizedCode = normalizeText(code);
    const normalizedLearnNumber = Number(learnNumber);
    if (!normalizedCode)
        throw new Error('Không thể tạo class_id khi thiếu code');
    if (!Number.isInteger(normalizedLearnNumber) || normalizedLearnNumber <= 0) {
        throw new Error('Không thể tạo class_id khi learn_number không hợp lệ');
    }
    const classId = `${normalizedCode}${(0, exports.excelDateSerialFromCalendarDate)(startTime)}${normalizedLearnNumber}1`;
    if (classId.length > 100)
        throw new Error('class_id vượt quá 100 ký tự');
    return classId;
};
exports.buildCalendarClassId = buildCalendarClassId;
/**
 * Công thức class_id có room 1 ở ký tự cuối. Các classroom tiếp theo giữ
 * nguyên code + ngày lịch + bài và chỉ thay hậu tố bằng room_id tương ứng.
 */
const buildCalendarRoomClassId = (code, startTime, learnNumber, roomId) => {
    const normalizedRoomId = Number(roomId);
    if (!Number.isInteger(normalizedRoomId) || normalizedRoomId <= 0) {
        throw new Error('Không thể tạo class_id khi room_id không hợp lệ');
    }
    const roomOneClassId = (0, exports.buildCalendarClassId)(code, startTime, learnNumber);
    const classId = `${roomOneClassId.slice(0, -1)}${normalizedRoomId}`;
    if (classId.length > 100)
        throw new Error('class_id vượt quá 100 ký tự');
    return classId;
};
exports.buildCalendarRoomClassId = buildCalendarRoomClassId;
const resolveCalendarTeacherProfile = async (client, identifier) => {
    const normalizedIdentifier = normalizeText(identifier);
    if (!normalizedIdentifier)
        return null;
    const profiles = await client.teacher_profiles.findMany({
        where: {
            can_view_stream_key: 1,
            status: 1,
            OR: [
                { username: normalizedIdentifier },
                { display_name: normalizedIdentifier },
            ],
        },
        select: { username: true, display_name: true },
        orderBy: { id: 'asc' },
    });
    const exactUsername = profiles.find((profile) => profile.username === normalizedIdentifier);
    if (exactUsername)
        return exactUsername;
    if (profiles.length === 1)
        return profiles[0];
    if (profiles.length > 1) {
        throw new Error(`Tên giáo viên "${normalizedIdentifier}" trùng nhiều tài khoản`);
    }
    throw new Error(`Không xác định được tài khoản giáo viên "${normalizedIdentifier}"`);
};
exports.resolveCalendarTeacherProfile = resolveCalendarTeacherProfile;
const resolveTeachingProfiles = async (client, calendar) => {
    const teacher = await (0, exports.resolveCalendarTeacherProfile)(client, calendar.teacher);
    const assistantUsernames = parseAssistantTeachers(calendar.assistant_teacher);
    const assistants = assistantUsernames.length
        ? await client.teacher_profiles.findMany({
            where: {
                username: { in: assistantUsernames },
                can_view_stream_key: 0,
            },
            select: { username: true, display_name: true },
        })
        : [];
    const assistantByUsername = new Map(assistants.map((profile) => [profile.username, profile]));
    const missingAssistants = assistantUsernames.filter((username) => !assistantByUsername.has(username));
    if (missingAssistants.length) {
        throw new Error(`Không xác định được tài khoản trợ giảng: ${missingAssistants.join(', ')}`);
    }
    return [
        ...(teacher ? [{ ...teacher, role: 'teacher' }] : []),
        ...assistantUsernames.map((username) => ({
            ...assistantByUsername.get(username),
            role: 'assistant',
        })),
    ];
};
const resolvePreviousTeachingProfiles = async (client, calendar) => {
    try {
        return {
            profiles: await resolveTeachingProfiles(client, calendar),
            hasLegacyIdentityIssue: false,
        };
    }
    catch (error) {
        // Lịch cũ từng lưu display_name thay vì username. Nếu tên hiện trùng,
        // không được chặn thao tác cập nhật lịch; user legacy sẽ không bị xóa
        // cho đến khi người dùng chọn lại nhân sự bằng username.
        if (error instanceof Error
            && (error.message.includes('trùng nhiều tài khoản')
                || error.message.includes('Không xác định được tài khoản giáo viên'))) {
            return {
                profiles: [],
                hasLegacyIdentityIssue: true,
            };
        }
        throw error;
    }
};
const findTeachingStudentHmid = async (client, username, code) => {
    const validHmidWhere = {
        username,
        student_hmid: { not: null },
        NOT: { student_hmid: '' },
    };
    // Cùng username có thể mang HMID khác nhau giữa các chương trình. Luôn ưu
    // tiên row của chính chương trình đang quét để không sao chép nhầm HMID.
    const sameProgram = await client.users.findFirst({
        where: { ...validHmidWhere, code },
        select: { student_hmid: true },
        orderBy: { id: 'asc' },
    });
    const sameProgramHmid = normalizeText(sameProgram?.student_hmid);
    if (sameProgramHmid)
        return sameProgramHmid;
    const fallback = await client.users.findFirst({
        where: validHmidWhere,
        select: { student_hmid: true },
        orderBy: { id: 'asc' },
    });
    return normalizeText(fallback?.student_hmid) || null;
};
const upsertTeachingUser = async (client, calendar, profile, classId) => {
    const username = normalizeText(profile.username);
    if (username.length > 100) {
        throw new Error(`Username nhân sự "${username}" vượt quá 100 ký tự`);
    }
    const studentHmid = await findTeachingStudentHmid(client, username, calendar.code);
    // Giáo viên chính hiển thị theo tên hồ sơ. Trợ giảng trong bảng users dùng
    // đúng quy ước nghiệp vụ HMID - Giáo viên, giống luồng quét/bổ sung user.
    const displayName = profile.role === 'assistant'
        ? [normalizeText(studentHmid), 'Giáo viên'].filter(Boolean).join(' - ')
        : normalizeText(profile.display_name) || username;
    const identityWhere = {
        username,
        code: calendar.code,
        learn_number: calendar.learn_number,
    };
    const existing = await client.users.findFirst({
        where: identityWhere,
        select: { id: true },
    });
    const createData = {
        username,
        student_hmid: studentHmid,
        email: username,
        phone: null,
        name: displayName,
        code: calendar.code,
        learn_number: calendar.learn_number,
        islearn: 0,
        room_id: 1,
        class_id: classId,
        created_at: new Date(),
        updated_at: new Date(),
    };
    const updateData = {
        name: displayName,
        islearn: 0,
        room_id: 1,
        class_id: classId,
        ...(studentHmid ? { student_hmid: studentHmid } : {}),
        updated_at: new Date(),
    };
    if (existing) {
        await client.users.update({ where: { id: existing.id }, data: updateData });
        return;
    }
    try {
        await client.users.create({ data: createData });
    }
    catch (error) {
        // Hai request có thể cùng không tìm thấy row rồi tạo đồng thời. Unique
        // index 3 cột chặn duplicate; request thua race cập nhật row vừa được tạo.
        if (error?.code !== 'P2002')
            throw error;
        const concurrent = await client.users.findFirst({
            where: identityWhere,
            select: { id: true },
        });
        if (!concurrent)
            throw error;
        await client.users.update({ where: { id: concurrent.id }, data: updateData });
    }
};
/**
 * Bổ sung enrollment cho nhân sự đã gán trên calendar nhưng chưa có trong
 * users. Dùng ở cập nhật hàng loạt để khôi phục các lịch legacy đã tồn tại
 * trước khi cơ chế tự đồng bộ được bật. Với enrollment đã có, hàm chỉ vá
 * student_hmid còn thiếu và chuẩn hóa tên trợ giảng; không xóa user.
 */
const ensureCalendarTeachingUsers = async (client, calendar, profileCache) => {
    if (!isActiveSchedule(calendar))
        return { created: 0, updated: 0 };
    const profileCacheKey = [
        normalizeText(calendar.teacher),
        parseAssistantTeachers(calendar.assistant_teacher).sort().join(','),
    ].join('|');
    let profiles = profileCache?.get(profileCacheKey);
    if (!profiles) {
        profiles = await resolveTeachingProfiles(client, calendar);
        profileCache?.set(profileCacheKey, profiles);
    }
    if (!profiles.length)
        return { created: 0, updated: 0 };
    const classId = (0, exports.buildCalendarClassId)(calendar.code, calendar.start_time, calendar.learn_number);
    let created = 0;
    let updated = 0;
    for (const profile of profiles) {
        const username = normalizeText(profile.username);
        const identityWhere = {
            username,
            code: calendar.code,
            learn_number: calendar.learn_number,
        };
        const existing = await client.users.findFirst({
            where: identityWhere,
            select: { id: true, student_hmid: true, name: true },
        });
        const studentHmid = normalizeText(existing?.student_hmid)
            || await findTeachingStudentHmid(client, username, calendar.code);
        const displayName = profile.role === 'assistant'
            ? [normalizeText(studentHmid), 'Giáo viên'].filter(Boolean).join(' - ')
            : normalizeText(profile.display_name) || username;
        const updateData = {
            name: displayName,
            islearn: 0,
            room_id: 1,
            class_id: classId,
            ...(studentHmid ? { student_hmid: studentHmid } : {}),
            updated_at: new Date(),
        };
        if (existing) {
            await client.users.update({
                where: { id: existing.id },
                data: updateData,
            });
            updated += 1;
            continue;
        }
        try {
            await client.users.create({
                data: {
                    username,
                    student_hmid: studentHmid,
                    email: username,
                    phone: null,
                    name: displayName,
                    code: calendar.code,
                    learn_number: calendar.learn_number,
                    islearn: 0,
                    room_id: 1,
                    class_id: classId,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            });
            created += 1;
        }
        catch (error) {
            if (error?.code !== 'P2002')
                throw error;
            // Unique index 3 cột xử lý race giữa bước kiểm tra và tạo. Request thua
            // race đọc lại đúng enrollment rồi cập nhật, thay vì bỏ qua dữ liệu mới.
            const concurrent = await client.users.findFirst({
                where: identityWhere,
                select: { id: true },
            });
            if (!concurrent)
                throw error;
            await client.users.update({
                where: { id: concurrent.id },
                data: updateData,
            });
            updated += 1;
        }
    }
    return { created, updated };
};
exports.ensureCalendarTeachingUsers = ensureCalendarTeachingUsers;
const isStillAssigned = async (client, calendar, profile) => {
    const rows = await client.$queryRaw(client_1.Prisma.sql `
    SELECT teacher, assistant_teacher
    FROM calendar
    WHERE code = ${calendar.code}
      AND learn_number = ${calendar.learn_number}
      AND (lesson_status IS NULL OR lesson_status <> 1)
      ${calendar.id ? client_1.Prisma.sql `AND id <> ${calendar.id}` : client_1.Prisma.empty}
  `);
    const identifiers = new Set([
        normalizeText(profile.username),
        normalizeText(profile.display_name),
    ].filter(Boolean));
    return rows.some((row) => (identifiers.has(normalizeText(row.teacher))
        || parseAssistantTeachers(row.assistant_teacher).includes(profile.username)));
};
const removeUnassignedTeachingUser = async (client, calendar, profile) => {
    // Một row users được định danh bởi username + code + learn_number. class_id
    // là trạng thái lớp hiện tại, không phải thành phần identity của enrollment.
    if (await isStillAssigned(client, calendar, profile))
        return;
    await client.users.deleteMany({
        where: {
            username: profile.username,
            code: calendar.code,
            learn_number: calendar.learn_number,
            room_id: 1,
            islearn: 0,
            userRoles: { none: {} },
        },
    });
};
const removeLegacyTeachingUsersNotInNext = async (client, calendar, nextUsernames) => {
    // Only runs with the Prisma client. Keeping this guard also makes the
    // synchronizer usable by lightweight test clients.
    if (typeof client.users.findMany !== 'function')
        return;
    const users = await client.users.findMany({
        where: {
            code: calendar.code,
            learn_number: calendar.learn_number,
            room_id: 1,
            islearn: 0,
        },
        select: { username: true, name: true },
    });
    for (const user of users) {
        if (nextUsernames.has(user.username))
            continue;
        await removeUnassignedTeachingUser(client, calendar, {
            username: user.username,
            display_name: user.name,
        });
    }
};
const calendarSyncSignature = (calendar) => {
    if (!calendar)
        return '';
    const date = new Date(calendar.start_time);
    return [
        calendar.code,
        calendar.learn_number,
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        normalizeText(calendar.teacher),
        parseAssistantTeachers(calendar.assistant_teacher).sort().join(','),
        Number(calendar.lesson_status ?? 0) === 1 ? 'cancelled' : 'active',
    ].join('|');
};
/** Đồng bộ enrollment của giáo viên/trợ giảng theo trạng thái calendar cuối cùng. */
const syncCalendarTeachingUsers = async (client, before, after) => {
    if (before && calendarSyncSignature(before) === calendarSyncSignature(after))
        return;
    // Khi chỉ thay ngày/giờ của lịch cũ, teacher có thể là display_name trùng
    // nhiều profile. Không cần resolve lại tên đó: cập nhật class_id trực tiếp
    // trên các user đã được liên kết với code + learn_number.
    if (before
        && isActiveSchedule(before)
        && isActiveSchedule(after)
        && teachingAssignmentsMatch(before, after)) {
        const classId = (0, exports.buildCalendarClassId)(after.code, after.start_time, after.learn_number);
        await client.users.updateMany({
            where: {
                code: after.code,
                learn_number: after.learn_number,
                room_id: 1,
                islearn: 0,
            },
            data: {
                room_id: 1,
                class_id: classId,
                updated_at: new Date(),
            },
        });
        return;
    }
    const previousProfileResolution = before && isActiveSchedule(before)
        ? await resolvePreviousTeachingProfiles(client, before)
        : { profiles: [], hasLegacyIdentityIssue: false };
    const beforeProfiles = previousProfileResolution.profiles;
    const afterProfiles = isActiveSchedule(after)
        ? await resolveTeachingProfiles(client, after)
        : [];
    const nextUsernames = new Set(afterProfiles.map((profile) => profile.username));
    if (afterProfiles.length) {
        const classId = (0, exports.buildCalendarClassId)(after.code, after.start_time, after.learn_number);
        for (const profile of afterProfiles) {
            await upsertTeachingUser(client, after, profile, classId);
        }
    }
    if (before) {
        for (const profile of beforeProfiles) {
            if (!nextUsernames.has(profile.username)) {
                await removeUnassignedTeachingUser(client, before, profile);
            }
        }
        if (previousProfileResolution.hasLegacyIdentityIssue) {
            await removeLegacyTeachingUsersNotInNext(client, before, nextUsernames);
        }
    }
};
exports.syncCalendarTeachingUsers = syncCalendarTeachingUsers;
