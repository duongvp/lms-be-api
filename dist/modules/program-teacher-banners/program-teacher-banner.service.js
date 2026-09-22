"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProgramTeacherBanner = exports.importBanners = exports.getBannerOptions = exports.deleteBanner = exports.updateBanner = exports.createBanner = exports.getBanner = exports.getBannersForExport = exports.listBanners = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const rowSelect = client_1.Prisma.sql `
  SELECT banner.id, banner.program_code, banner.teacher_profile_id,
    banner.banner_url, banner.status, banner.created_by, banner.updated_by,
    banner.created_at, banner.updated_at, teacher.username,
    teacher.display_name
  FROM program_teacher_banners banner
  JOIN teacher_profiles teacher ON teacher.id = banner.teacher_profile_id
`;
const normalizeBannerRow = (row) => ({
    ...row,
    id: Number(row.id),
    teacher_profile_id: Number(row.teacher_profile_id),
    status: Number(row.status),
});
const listBanners = async (query) => {
    const conditions = [];
    if (query.search) {
        const search = `%${query.search}%`;
        conditions.push(client_1.Prisma.sql `(banner.program_code LIKE ${search} OR teacher.username LIKE ${search} OR teacher.display_name LIKE ${search})`);
    }
    if (query.program_code)
        conditions.push(client_1.Prisma.sql `banner.program_code = ${query.program_code}`);
    if (query.status !== undefined)
        conditions.push(client_1.Prisma.sql `banner.status = ${query.status}`);
    const where = conditions.length ? client_1.Prisma.sql `WHERE ${client_1.Prisma.join(conditions, ' AND ')}` : client_1.Prisma.empty;
    const offset = (query.page - 1) * query.limit;
    const rawData = await prisma_1.default.$queryRaw(client_1.Prisma.sql `${rowSelect} ${where} ORDER BY banner.updated_at DESC, banner.id DESC LIMIT ${query.limit} OFFSET ${offset}`);
    const data = rawData.map(normalizeBannerRow);
    const countRows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    SELECT COUNT(*) total FROM program_teacher_banners banner
    JOIN teacher_profiles teacher ON teacher.id = banner.teacher_profile_id ${where}
  `);
    return { data, pagination: { page: query.page, limit: query.limit, total: Number(countRows[0]?.total || 0) } };
};
exports.listBanners = listBanners;
const getBannersForExport = async (search) => {
    const normalizedSearch = String(search || '').trim();
    const where = normalizedSearch
        ? (() => {
            const value = `%${normalizedSearch}%`;
            return client_1.Prisma.sql `WHERE banner.program_code LIKE ${value}
          OR teacher.username LIKE ${value}
          OR teacher.display_name LIKE ${value}`;
        })()
        : client_1.Prisma.empty;
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    ${rowSelect} ${where}
    ORDER BY banner.updated_at DESC, banner.id DESC
  `);
    return rows.map(normalizeBannerRow);
};
exports.getBannersForExport = getBannersForExport;
const getBanner = async (id) => {
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `${rowSelect} WHERE banner.id = ${id} LIMIT 1`);
    if (!rows[0])
        throw new ApiError_1.default('Không tìm thấy cấu hình banner', 404);
    return normalizeBannerRow(rows[0]);
};
exports.getBanner = getBanner;
const assertTeacher = async (teacherProfileId) => {
    const teacher = await prisma_1.default.teacher_profiles.findUnique({ where: { id: teacherProfileId } });
    if (!teacher)
        throw new ApiError_1.default('Không tìm thấy giáo viên', 400);
    if (teacher.teacher_type !== 1)
        throw new ApiError_1.default('Banner chỉ được cấu hình cho giáo viên', 400);
};
const syncFutureStreams = async (programCode, teacherProfileId, bannerUrl) => prisma_1.default.$executeRaw `
  UPDATE stream stream_row
  JOIN (
    SELECT DISTINCT calendar_row.code, calendar_row.learn_number
    FROM calendar calendar_row
    JOIN teacher_profiles profile ON profile.id = ${teacherProfileId}
    WHERE calendar_row.code = ${programCode}
      AND calendar_row.start_time >= NOW()
      AND (
        LOWER(calendar_row.teacher) = LOWER(profile.username)
        OR LOWER(calendar_row.teacher) = LOWER(profile.display_name)
      )
  ) matched_calendar
    ON matched_calendar.code = stream_row.code
    AND matched_calendar.learn_number = stream_row.learn_number
  SET stream_row.banner_url = ${bannerUrl}, stream_row.updated_at = NOW()
`;
const createBanner = async (payload, actor) => {
    await assertTeacher(payload.teacher_profile_id);
    try {
        await prisma_1.default.$executeRaw `
      INSERT INTO program_teacher_banners
        (program_code, teacher_profile_id, banner_url, status, created_by, updated_by)
      VALUES (${payload.program_code}, ${payload.teacher_profile_id}, ${payload.banner_url}, ${payload.status}, ${actor || null}, ${actor || null})
    `;
        const ids = await prisma_1.default.$queryRaw `SELECT LAST_INSERT_ID() id`;
        await syncFutureStreams(payload.program_code, payload.teacher_profile_id, payload.status ? payload.banner_url : null);
        return (0, exports.getBanner)(Number(ids[0].id));
    }
    catch (error) {
        if (error?.code === 'P2002')
            throw new ApiError_1.default('Chương trình và giáo viên này đã có banner', 409);
        throw error;
    }
};
exports.createBanner = createBanner;
const updateBanner = async (id, payload, actor) => {
    const current = await (0, exports.getBanner)(id);
    await assertTeacher(payload.teacher_profile_id);
    try {
        await prisma_1.default.$executeRaw `
      UPDATE program_teacher_banners SET
        program_code = ${payload.program_code},
        teacher_profile_id = ${payload.teacher_profile_id},
        banner_url = ${payload.banner_url},
        status = ${payload.status},
        updated_by = ${actor || null}
      WHERE id = ${id}
    `;
        if (current.program_code !== payload.program_code || current.teacher_profile_id !== payload.teacher_profile_id) {
            await syncFutureStreams(current.program_code, current.teacher_profile_id, null);
        }
        await syncFutureStreams(payload.program_code, payload.teacher_profile_id, payload.status ? payload.banner_url : null);
        return (0, exports.getBanner)(id);
    }
    catch (error) {
        if (error?.code === 'P2002')
            throw new ApiError_1.default('Chương trình và giáo viên này đã có banner', 409);
        throw error;
    }
};
exports.updateBanner = updateBanner;
const deleteBanner = async (id) => {
    const current = await (0, exports.getBanner)(id);
    await prisma_1.default.$executeRaw `DELETE FROM program_teacher_banners WHERE id = ${id}`;
    await syncFutureStreams(current.program_code, current.teacher_profile_id, null);
    return current;
};
exports.deleteBanner = deleteBanner;
const getBannerOptions = async (programCode, teacherProfileId) => {
    // Tránh JOIN calendar × teacher_profiles khi modal vừa mở. JOIN theo tên
    // (LOWER + OR) không dùng được index và từng làm endpoint options bị timeout.
    // Chỉ JOIN calendar khi người dùng đã chọn một vế để lọc vế còn lại.
    const programs = teacherProfileId
        ? await prisma_1.default.$queryRaw(client_1.Prisma.sql `
        SELECT calendar_row.code,
          COALESCE(MAX(lesson.subject_name), MAX(calendar_row.subject), calendar_row.code) subject_name
        FROM calendar calendar_row
        JOIN teacher_profiles profile ON profile.id = ${teacherProfileId}
          AND (
            LOWER(calendar_row.teacher) = LOWER(profile.username)
            OR LOWER(calendar_row.teacher) = LOWER(profile.display_name)
          )
        LEFT JOIN (
          SELECT subject_code, MAX(subject_name) subject_name
          FROM lessons WHERE status <> 0 GROUP BY subject_code
        ) lesson ON lesson.subject_code = calendar_row.code
        WHERE calendar_row.code IS NOT NULL AND TRIM(calendar_row.code) <> ''
        GROUP BY calendar_row.code ORDER BY subject_name, calendar_row.code
      `)
        : await prisma_1.default.$queryRaw(client_1.Prisma.sql `
        SELECT calendar_row.code,
          COALESCE(MAX(lesson.subject_name), MAX(calendar_row.subject), calendar_row.code) subject_name
        FROM calendar calendar_row
        LEFT JOIN (
          SELECT subject_code, MAX(subject_name) subject_name
          FROM lessons WHERE status <> 0 GROUP BY subject_code
        ) lesson ON lesson.subject_code = calendar_row.code
        WHERE calendar_row.code IS NOT NULL AND TRIM(calendar_row.code) <> ''
        GROUP BY calendar_row.code ORDER BY subject_name, calendar_row.code
      `);
    const teachersRaw = programCode
        ? await prisma_1.default.$queryRaw(client_1.Prisma.sql `
        SELECT DISTINCT profile.id, profile.username, profile.display_name
        FROM calendar calendar_row
        JOIN teacher_profiles profile ON
          LOWER(calendar_row.teacher) = LOWER(profile.username)
          OR LOWER(calendar_row.teacher) = LOWER(profile.display_name)
        WHERE profile.teacher_type = 1 AND profile.status = 1
          AND calendar_row.code = ${programCode}
        ORDER BY profile.display_name, profile.username
      `)
        : await prisma_1.default.$queryRaw(client_1.Prisma.sql `
        SELECT profile.id, profile.username, profile.display_name
        FROM teacher_profiles profile
        WHERE profile.teacher_type = 1 AND profile.status = 1
        ORDER BY profile.display_name, profile.username
      `);
    const teachers = teachersRaw.map((teacher) => ({ ...teacher, id: Number(teacher.id) }));
    return { programs, teachers };
};
exports.getBannerOptions = getBannerOptions;
const importBanners = async (rows, mode, actor) => {
    if (!rows.length)
        throw new ApiError_1.default('File không có dữ liệu', 400);
    if (rows.length > 2000)
        throw new ApiError_1.default('Mỗi lần chỉ import tối đa 2.000 dòng', 400);
    const errors = [];
    const resolved = [];
    const seen = new Set();
    const validRows = [];
    for (const row of rows) {
        if (!row.program_code || row.program_code.length > 50) {
            errors.push({ row: row.row, field: 'code', message: 'Mã chương trình không hợp lệ' });
            continue;
        }
        if (!row.teacher) {
            errors.push({ row: row.row, field: 'teacher', message: 'Thiếu giáo viên' });
            continue;
        }
        try {
            const url = new URL(row.banner_url);
            if (!['http:', 'https:'].includes(url.protocol) || row.banner_url.length > 500)
                throw new Error();
        }
        catch {
            errors.push({ row: row.row, field: 'banner_url', message: 'URL banner không hợp lệ' });
            continue;
        }
        validRows.push(row);
    }
    const teacherIdentifiers = Array.from(new Set(validRows.map((row) => row.teacher.toLowerCase())));
    const teacherProfilesRaw = teacherIdentifiers.length ? await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    SELECT id, username, display_name FROM teacher_profiles
    WHERE teacher_type = 1 AND (
      LOWER(username) IN (${client_1.Prisma.join(teacherIdentifiers)})
      OR LOWER(display_name) IN (${client_1.Prisma.join(teacherIdentifiers)})
    )
  `) : [];
    const teacherProfiles = teacherProfilesRaw.map((profile) => ({ ...profile, id: Number(profile.id) }));
    const teachersByIdentifier = new Map();
    teacherProfiles.forEach((profile) => {
        [profile.username, profile.display_name].filter(Boolean).forEach((value) => {
            const key = String(value).toLowerCase();
            const matches = teachersByIdentifier.get(key) || [];
            if (!matches.some((item) => item.id === profile.id))
                matches.push(profile);
            teachersByIdentifier.set(key, matches);
        });
    });
    for (const row of validRows) {
        const teachers = teachersByIdentifier.get(row.teacher.toLowerCase()) || [];
        if (!teachers.length) {
            errors.push({ row: row.row, field: 'teacher', message: `Không tìm thấy giáo viên “${row.teacher}”` });
            continue;
        }
        if (teachers.length > 1) {
            errors.push({ row: row.row, field: 'teacher', message: `Có nhiều giáo viên tên “${row.teacher}”; hãy dùng mã nhân sự` });
            continue;
        }
        const key = `${row.program_code.toLowerCase()}::${teachers[0].id}`;
        if (seen.has(key)) {
            errors.push({ row: row.row, field: 'row', message: 'Cặp chương trình - giáo viên bị trùng trong file' });
            continue;
        }
        seen.add(key);
        resolved.push({ row: row.row, program_code: row.program_code, teacher_profile_id: teachers[0].id, banner_url: row.banner_url, status: 1 });
    }
    if (errors.length)
        return { imported: false, errors, created: 0, updated: 0, skipped: 0 };
    const resolvedProgramCodes = Array.from(new Set(resolved.map((row) => row.program_code)));
    const resolvedTeacherIds = Array.from(new Set(resolved.map((row) => row.teacher_profile_id)));
    const existingRows = resolved.length ? await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    SELECT id, program_code, teacher_profile_id FROM program_teacher_banners
    WHERE program_code IN (${client_1.Prisma.join(resolvedProgramCodes)})
      AND teacher_profile_id IN (${client_1.Prisma.join(resolvedTeacherIds)})
  `) : [];
    const existingByKey = new Map(existingRows.map((row) => [
        `${row.program_code.toLowerCase()}::${row.teacher_profile_id}`,
        row.id,
    ]));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of resolved) {
        const existingId = existingByKey.get(`${row.program_code.toLowerCase()}::${row.teacher_profile_id}`);
        if (existingId) {
            if (mode === 'skip') {
                skipped += 1;
                continue;
            }
            await (0, exports.updateBanner)(existingId, row, actor);
            updated += 1;
        }
        else {
            await (0, exports.createBanner)(row, actor);
            created += 1;
        }
    }
    return { imported: true, errors: [], created, updated, skipped };
};
exports.importBanners = importBanners;
const resolveProgramTeacherBanner = async (client, programCode, teacherIdentifier) => {
    const code = String(programCode || '').trim();
    const teacher = String(teacherIdentifier || '').trim();
    if (!code || !teacher)
        return null;
    const rows = await client.$queryRaw(client_1.Prisma.sql `
    SELECT banner.banner_url
    FROM program_teacher_banners banner
    JOIN teacher_profiles profile ON profile.id = banner.teacher_profile_id
    WHERE banner.program_code = ${code} AND banner.status = 1
      AND (LOWER(profile.username) = LOWER(${teacher}) OR LOWER(profile.display_name) = LOWER(${teacher}))
    ORDER BY CASE WHEN LOWER(profile.username) = LOWER(${teacher}) THEN 0 ELSE 1 END, banner.id
    LIMIT 2
  `);
    if (rows.length > 1)
        throw new ApiError_1.default(`Có nhiều hồ sơ giáo viên khớp với “${teacher}”; vui lòng dùng mã nhân sự`, 409);
    return rows[0]?.banner_url || null;
};
exports.resolveProgramTeacherBanner = resolveProgramTeacherBanner;
