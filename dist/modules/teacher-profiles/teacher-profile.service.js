"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importTeacherProfiles = exports.getTeacherProfilesForExport = exports.deleteTeacherProfile = exports.updateTeacherProfileStatus = exports.updateTeacherProfile = exports.createTeacherProfile = exports.getTeacherProfile = exports.listTeacherProfiles = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const teacher_profile_types_1 = require("./teacher-profile.types");
const normalizeProfileRow = (row) => ({
    ...row,
    id: Number(row.id),
    teacher_type: Number(row.teacher_type),
    status: Number(row.status),
});
const assistantUsernames = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const findUsage = async (username) => {
    const [teacherRows, possibleAssistantRows] = await Promise.all([
        prisma_1.default.$queryRaw `
      SELECT COUNT(*) AS total
      FROM calendar
      WHERE teacher = ${username}
    `,
        prisma_1.default.$queryRaw `
      SELECT assistant_teacher
      FROM calendar
      WHERE assistant_teacher LIKE ${`%${username}%`}
    `,
    ]);
    return {
        teacherCount: Number(teacherRows[0]?.total ?? 0),
        assistantCount: possibleAssistantRows.filter((row) => assistantUsernames(row.assistant_teacher).includes(username)).length,
    };
};
const getProfileRow = async (id) => {
    const rows = await prisma_1.default.$queryRaw `
    SELECT id, username, teacher_type, display_name, status, created_at, updated_at
    FROM teacher_profiles
    WHERE id = ${id}
    LIMIT 1
  `;
    const profile = rows[0] ? normalizeProfileRow(rows[0]) : undefined;
    if (!profile)
        throw new ApiError_1.default('Không tìm thấy nhân sự giảng dạy', 404);
    return profile;
};
const throwDatabaseError = (error) => {
    const message = String(error?.message || '');
    if (message.includes('1062') || message.toLowerCase().includes('duplicate')) {
        throw new ApiError_1.default('Mã nhân sự đã tồn tại', 409);
    }
    throw error;
};
const listTeacherProfiles = async (query) => {
    const conditions = [];
    if (query.teacher_type !== undefined) {
        conditions.push(client_1.Prisma.sql `teacher_type = ${query.teacher_type}`);
    }
    if (query.status !== undefined) {
        conditions.push(client_1.Prisma.sql `status = ${query.status}`);
    }
    if (query.search) {
        const pattern = `%${query.search}%`;
        conditions.push(client_1.Prisma.sql `(username LIKE ${pattern} OR display_name LIKE ${pattern})`);
    }
    const where = conditions.length
        ? client_1.Prisma.sql `WHERE ${client_1.Prisma.join(conditions, ' AND ')}`
        : client_1.Prisma.empty;
    const offset = (query.page - 1) * query.limit;
    const [countRows, data] = await Promise.all([
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT COUNT(*) AS total
      FROM teacher_profiles
      ${where}
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT id, username, teacher_type, display_name, status, created_at, updated_at
      FROM teacher_profiles
      ${where}
      ORDER BY status DESC, display_name ASC, username ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `),
    ]);
    return {
        data: data.map(normalizeProfileRow),
        pagination: {
            page: query.page,
            limit: query.limit,
            total: Number(countRows[0]?.total ?? 0),
        },
    };
};
exports.listTeacherProfiles = listTeacherProfiles;
exports.getTeacherProfile = getProfileRow;
const createTeacherProfile = async (payload) => {
    try {
        await prisma_1.default.$executeRaw `
      INSERT INTO teacher_profiles (
        username, display_name, teacher_type, status, created_at, updated_at
      ) VALUES (
        ${payload.username},
        ${payload.display_name ?? null},
        ${payload.teacher_type ?? teacher_profile_types_1.TEACHER_TYPES.TEACHER},
        ${payload.status ?? 1},
        NOW(),
        NOW()
      )
    `;
        const rows = await prisma_1.default.$queryRaw `
      SELECT id, username, teacher_type, display_name, status, created_at, updated_at
      FROM teacher_profiles
      WHERE username = ${payload.username}
      LIMIT 1
    `;
        return rows[0] ? normalizeProfileRow(rows[0]) : undefined;
    }
    catch (error) {
        return throwDatabaseError(error);
    }
};
exports.createTeacherProfile = createTeacherProfile;
const assertTypeCanChange = async (username, currentType, nextType) => {
    if (nextType === undefined || nextType === currentType)
        return;
    const usage = await findUsage(username);
    if (usage.teacherCount > 0 || usage.assistantCount > 0) {
        throw new ApiError_1.default('Không thể đổi loại nhân sự vì username đang được sử dụng trong lịch học', 409);
    }
};
const updateTeacherProfile = async (id, payload) => {
    const current = await getProfileRow(id);
    await assertTypeCanChange(current.username, current.teacher_type, payload.teacher_type);
    const assignments = [];
    if (payload.display_name !== undefined) {
        assignments.push(client_1.Prisma.sql `display_name = ${payload.display_name}`);
    }
    if (payload.teacher_type !== undefined) {
        assignments.push(client_1.Prisma.sql `teacher_type = ${payload.teacher_type}`);
    }
    if (payload.status !== undefined) {
        assignments.push(client_1.Prisma.sql `status = ${payload.status}`);
    }
    assignments.push(client_1.Prisma.sql `updated_at = NOW()`);
    await prisma_1.default.$executeRaw(client_1.Prisma.sql `
    UPDATE teacher_profiles
    SET ${client_1.Prisma.join(assignments, ', ')}
    WHERE id = ${id}
  `);
    return getProfileRow(id);
};
exports.updateTeacherProfile = updateTeacherProfile;
const updateTeacherProfileStatus = async (id, status) => {
    await getProfileRow(id);
    await prisma_1.default.$executeRaw `
    UPDATE teacher_profiles
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
  `;
    return getProfileRow(id);
};
exports.updateTeacherProfileStatus = updateTeacherProfileStatus;
const deleteTeacherProfile = async (id) => {
    const current = await getProfileRow(id);
    const usage = await findUsage(current.username);
    if (usage.teacherCount > 0 || usage.assistantCount > 0) {
        throw new ApiError_1.default('Không thể xóa nhân sự đang được sử dụng trong lịch học; hãy chuyển sang trạng thái ngừng hoạt động', 409);
    }
    await prisma_1.default.$executeRaw `DELETE FROM teacher_profiles WHERE id = ${id}`;
    return current;
};
exports.deleteTeacherProfile = deleteTeacherProfile;
const getTeacherProfilesForExport = async (filters) => {
    const rows = [];
    let page = 1;
    let total = 0;
    do {
        const result = await (0, exports.listTeacherProfiles)({
            ...filters,
            page,
            limit: 100,
        });
        rows.push(...result.data);
        total = result.pagination.total;
        page += 1;
    } while (rows.length < total);
    return rows;
};
exports.getTeacherProfilesForExport = getTeacherProfilesForExport;
const importTeacherProfiles = async (rows, mode) => prisma_1.default.$transaction(async (tx) => {
    const usernames = rows.map((row) => row.username);
    const existingRows = usernames.length
        ? await tx.$queryRaw(client_1.Prisma.sql `
        SELECT id, username, teacher_type, display_name, status, created_at, updated_at
        FROM teacher_profiles
        WHERE username IN (${client_1.Prisma.join(usernames)})
      `)
        : [];
    const existingByUsername = new Map(existingRows.map((row) => [row.username.toLowerCase(), normalizeProfileRow(row)]));
    const typeChanges = rows.filter((row) => {
        const current = existingByUsername.get(row.username.toLowerCase());
        return current && current.teacher_type !== row.teacher_type;
    });
    if (mode === 'overwrite' && typeChanges.length) {
        const changingUsernames = new Set(typeChanges.map((row) => row.username.toLowerCase()));
        const usageConditions = typeChanges.flatMap((row) => [
            client_1.Prisma.sql `teacher = ${row.username}`,
            client_1.Prisma.sql `assistant_teacher LIKE ${`%${row.username}%`}`,
        ]);
        const calendarRows = await tx.$queryRaw(client_1.Prisma.sql `
      SELECT teacher, assistant_teacher
      FROM calendar
      WHERE ${client_1.Prisma.join(usageConditions, ' OR ')}
    `);
        const usedUsernames = new Set();
        calendarRows.forEach((calendar) => {
            const teacher = String(calendar.teacher || '').toLowerCase();
            if (changingUsernames.has(teacher))
                usedUsernames.add(teacher);
            assistantUsernames(calendar.assistant_teacher).forEach((assistant) => {
                const normalized = assistant.toLowerCase();
                if (changingUsernames.has(normalized))
                    usedUsernames.add(normalized);
            });
        });
        if (usedUsernames.size) {
            const labels = typeChanges
                .filter((row) => usedUsernames.has(row.username.toLowerCase()))
                .map((row) => `${row.username} (dòng ${row.row})`);
            throw new ApiError_1.default(`Không thể đổi loại nhân sự đang được dùng trong lịch: ${labels.join(', ')}`, 409);
        }
    }
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
        const existing = existingByUsername.get(row.username.toLowerCase());
        if (existing) {
            if (mode === 'skip') {
                skipped += 1;
                continue;
            }
            await tx.$executeRaw `
        UPDATE teacher_profiles
        SET
          display_name = ${row.display_name},
          teacher_type = ${row.teacher_type},
          status = ${row.status},
          updated_at = NOW()
        WHERE id = ${existing.id}
      `;
            updated += 1;
            continue;
        }
        await tx.$executeRaw `
      INSERT INTO teacher_profiles (
        username, display_name, teacher_type, status, created_at, updated_at
      ) VALUES (
        ${row.username},
        ${row.display_name},
        ${row.teacher_type},
        ${row.status},
        NOW(),
        NOW()
      )
    `;
        created += 1;
    }
    return { total: rows.length, created, updated, skipped };
});
exports.importTeacherProfiles = importTeacherProfiles;
