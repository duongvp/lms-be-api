"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.softDeleteLesson = exports.importLessons = exports.reorderLessonsInGroup = exports.bulkUpdateLessons = exports.updateLesson = exports.createLesson = exports.findLessonsByGroup = exports.findNextLearnNumber = exports.findLessonByIdentity = exports.findLessonById = exports.findLessonsForExport = exports.findLessonProgramOptions = exports.findLessonSubjectOptions = exports.findLessons = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const buildWhere = (query) => {
    const clauses = ['status = ?'];
    const values = [query.status ?? 1];
    if (query.grade !== undefined) {
        clauses.push('grade = ?');
        values.push(query.grade);
    }
    if (query.subject_code) {
        clauses.push('subject_code = ?');
        values.push(query.subject_code);
    }
    if (query.subject) {
        clauses.push('(subject_code LIKE ? OR subject_name LIKE ?)');
        values.push(`%${query.subject}%`, `%${query.subject}%`);
    }
    if (query.learn_number !== undefined) {
        clauses.push('learn_number = ?');
        values.push(query.learn_number);
    }
    if (query.keyword) {
        clauses.push('lesson_name LIKE ?');
        values.push(`%${query.keyword}%`);
    }
    return {
        whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        values,
    };
};
const findLessons = async (query) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const { whereSql, values } = buildWhere(query);
    const sortBy = query.sort_by ?? 'updated_at';
    const sortOrder = query.sort_order ?? 'desc';
    const selectSql = query.course_code
        ? `lessons.*, (
        SELECT COUNT(*)
        FROM calendar
        WHERE calendar.code = ?
          AND calendar.learn_number = lessons.learn_number
      ) AS scheduled_count`
        : 'lessons.*';
    const selectValues = query.course_code ? [query.course_code, ...values] : values;
    const countRows = await prisma_1.default.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM lessons ${whereSql}`, ...values);
    const data = await prisma_1.default.$queryRawUnsafe(`SELECT ${selectSql} FROM lessons ${whereSql} ORDER BY ${sortBy} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`, ...selectValues, limit, skip);
    return {
        total: Number(countRows[0]?.total ?? 0),
        page,
        limit,
        data,
    };
};
exports.findLessons = findLessons;
const findLessonSubjectOptions = async () => {
    return prisma_1.default.$queryRawUnsafe(`SELECT subject_name, MIN(subject_code) AS subject_code
     FROM lessons
     WHERE status <> 0
       AND subject_name IS NOT NULL
       AND TRIM(subject_name) <> ''
     GROUP BY subject_name
     ORDER BY subject_name ASC`);
};
exports.findLessonSubjectOptions = findLessonSubjectOptions;
const findLessonProgramOptions = async () => {
    return prisma_1.default.$queryRawUnsafe(`SELECT DISTINCT grade, subject_name, subject_code
     FROM lessons
     WHERE status <> 0
       AND subject_code IS NOT NULL
       AND TRIM(subject_code) <> ''
     ORDER BY subject_name ASC, grade ASC, subject_code ASC`);
};
exports.findLessonProgramOptions = findLessonProgramOptions;
const findLessonsForExport = async (query) => {
    if (query.ids?.length) {
        const placeholders = query.ids.map(() => '?').join(', ');
        return prisma_1.default.$queryRawUnsafe(`SELECT * FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`, ...query.ids);
    }
    const { whereSql, values } = buildWhere({ ...query, page: undefined, limit: undefined });
    const sortBy = query.sort_by ?? 'grade';
    const sortOrder = query.sort_order ?? 'asc';
    return prisma_1.default.$queryRawUnsafe(`SELECT * FROM lessons ${whereSql} ORDER BY ${sortBy} ${sortOrder.toUpperCase()}, subject_code ASC, learn_number ASC`, ...values);
};
exports.findLessonsForExport = findLessonsForExport;
const findLessonById = async (id) => {
    const rows = await prisma_1.default.$queryRawUnsafe('SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1', id);
    return rows[0] ?? null;
};
exports.findLessonById = findLessonById;
const findLessonByIdentity = async (grade, subjectCode, learnNumber, excludeId) => {
    const rows = await prisma_1.default.$queryRawUnsafe(`SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND learn_number = ? AND status <> 0${excludeId ? ' AND id <> ?' : ''} LIMIT 1`, ...(excludeId ? [grade, subjectCode, learnNumber, excludeId] : [grade, subjectCode, learnNumber]));
    return rows[0] ?? null;
};
exports.findLessonByIdentity = findLessonByIdentity;
const findNextLearnNumber = async (grade, subjectCode) => {
    const rows = await prisma_1.default.$queryRawUnsafe('SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0', grade, subjectCode);
    return Number(rows[0]?.next_learn_number ?? 1);
};
exports.findNextLearnNumber = findNextLearnNumber;
const findLessonsByGroup = async (grade, subjectCode) => {
    return prisma_1.default.$queryRawUnsafe('SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0 ORDER BY learn_number ASC, id ASC', grade, subjectCode);
};
exports.findLessonsByGroup = findLessonsByGroup;
const createLesson = async (payload) => {
    return prisma_1.default.$transaction(async (tx) => {
        let learnNumber = payload.learn_number;
        if (learnNumber === undefined) {
            const nextRows = await tx.$queryRawUnsafe('SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0', payload.grade, payload.subject_code);
            learnNumber = Number(nextRows[0]?.next_learn_number ?? 1);
        }
        await tx.$executeRawUnsafe(`INSERT INTO lessons (
        grade, subject_code, subject_name, learn_number,
        lesson_name, lesson_document, evg_banner, evg_stream, lesson_link,
        lesson_baitap, lesson_tomtat, lesson_phuongphap,
        lesson_luuy, lesson_ketqua, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`, payload.grade, payload.subject_code, payload.subject_name, learnNumber, payload.lesson_name, payload.lesson_document ?? null, payload.evg_banner ?? null, payload.evg_stream ?? null, payload.lesson_link ?? null, payload.lesson_baitap ?? null, payload.lesson_tomtat ?? null, payload.lesson_phuongphap ?? null, payload.lesson_luuy ?? null, payload.lesson_ketqua ?? null, payload.status ?? 1);
        const rows = await tx.$queryRawUnsafe('SELECT * FROM lessons WHERE id = LAST_INSERT_ID() LIMIT 1');
        return rows[0] ?? null;
    });
};
exports.createLesson = createLesson;
const updateLesson = async (id, payload) => {
    const entries = Object.entries(payload);
    const setSql = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value ?? null);
    await prisma_1.default.$executeRawUnsafe(`UPDATE lessons SET ${setSql}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, ...values, id);
    return (0, exports.findLessonById)(id);
};
exports.updateLesson = updateLesson;
const bulkUpdateLessons = async (ids, payload) => {
    const entries = Object.entries(payload);
    const setSql = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value ?? null);
    const placeholders = ids.map(() => '?').join(', ');
    await prisma_1.default.$executeRawUnsafe(`UPDATE lessons SET ${setSql}, updated_at = CURRENT_TIMESTAMP(3) WHERE id IN (${placeholders}) AND status <> 0`, ...values, ...ids);
    return prisma_1.default.$queryRawUnsafe(`SELECT * FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`, ...ids);
};
exports.bulkUpdateLessons = bulkUpdateLessons;
const reorderLessonsInGroup = async (grade, subjectCode, orderedIds) => {
    await prisma_1.default.$transaction(async (tx) => {
        for (let index = 0; index < orderedIds.length; index += 1) {
            await tx.$executeRawUnsafe('UPDATE lessons SET learn_number = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND grade = ? AND subject_code = ? AND status <> 0', -(index + 1), orderedIds[index], grade, subjectCode);
        }
        for (let index = 0; index < orderedIds.length; index += 1) {
            await tx.$executeRawUnsafe('UPDATE lessons SET learn_number = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND grade = ? AND subject_code = ? AND status <> 0', index + 1, orderedIds[index], grade, subjectCode);
        }
    });
    return (0, exports.findLessonsByGroup)(grade, subjectCode);
};
exports.reorderLessonsInGroup = reorderLessonsInGroup;
const importLessons = async (rows, mode) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const nextLearnNumberByGroup = new Map();
    await prisma_1.default.$transaction(async (tx) => {
        for (const row of rows) {
            let learnNumber = row.learn_number;
            const groupKey = `${row.grade}|${row.subject_code}`;
            if (learnNumber === undefined) {
                if (!nextLearnNumberByGroup.has(groupKey)) {
                    const maxRows = await tx.$queryRawUnsafe('SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0', row.grade, row.subject_code);
                    nextLearnNumberByGroup.set(groupKey, Number(maxRows[0]?.next_learn_number ?? 1));
                }
                learnNumber = nextLearnNumberByGroup.get(groupKey);
                nextLearnNumberByGroup.set(groupKey, learnNumber + 1);
            }
            const existingRows = await tx.$queryRawUnsafe('SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND learn_number = ? AND status <> 0 LIMIT 1', row.grade, row.subject_code, learnNumber);
            const existing = existingRows[0];
            if (existing) {
                if (mode === 'skip') {
                    skipped += 1;
                    continue;
                }
                if (row.status === 0) {
                    await tx.$executeRawUnsafe(`UPDATE lessons SET
              lesson_name = ?, lesson_document = ?, evg_banner = ?, evg_stream = ?, lesson_link = ?,
              lesson_baitap = ?, lesson_tomtat = ?,
              lesson_phuongphap = ?, lesson_luuy = ?, lesson_ketqua = ?, status = 0,
              learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`, row.lesson_name, row.lesson_document ?? null, row.evg_banner ?? null, row.evg_stream ?? null, row.lesson_link ?? null, row.lesson_baitap ?? null, row.lesson_tomtat ?? null, row.lesson_phuongphap ?? null, row.lesson_luuy ?? null, row.lesson_ketqua ?? null, existing.id);
                }
                else {
                    await tx.$executeRawUnsafe(`UPDATE lessons SET
              subject_name = ?, lesson_name = ?, lesson_document = ?,
              evg_banner = ?, evg_stream = ?, lesson_link = ?,
              lesson_baitap = ?, lesson_tomtat = ?,
              lesson_phuongphap = ?, lesson_luuy = ?, lesson_ketqua = ?, status = ?,
              updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`, row.subject_name, row.lesson_name, row.lesson_document ?? null, row.evg_banner ?? null, row.evg_stream ?? null, row.lesson_link ?? null, row.lesson_baitap ?? null, row.lesson_tomtat ?? null, row.lesson_phuongphap ?? null, row.lesson_luuy ?? null, row.lesson_ketqua ?? null, row.status ?? 1, existing.id);
                }
                updated += 1;
                continue;
            }
            await tx.$executeRawUnsafe(`INSERT INTO lessons (
          grade, subject_code, subject_name, learn_number,
          lesson_name, lesson_document, evg_banner, evg_stream, lesson_link,
          lesson_baitap, lesson_tomtat, lesson_phuongphap,
          lesson_luuy, lesson_ketqua, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`, row.grade, row.subject_code, row.subject_name, learnNumber, row.lesson_name, row.lesson_document ?? null, row.evg_banner ?? null, row.evg_stream ?? null, row.lesson_link ?? null, row.lesson_baitap ?? null, row.lesson_tomtat ?? null, row.lesson_phuongphap ?? null, row.lesson_luuy ?? null, row.lesson_ketqua ?? null, row.status ?? 1);
            if (row.status === 0) {
                await tx.$executeRawUnsafe('UPDATE lessons SET learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3) WHERE id = LAST_INSERT_ID()');
            }
            created += 1;
        }
    });
    return {
        total: rows.length,
        created,
        updated,
        skipped,
    };
};
exports.importLessons = importLessons;
const softDeleteLesson = async (id) => {
    await prisma_1.default.$executeRawUnsafe('UPDATE lessons SET status = 0, learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?', id);
    return prisma_1.default.$queryRawUnsafe('SELECT * FROM lessons WHERE id = ? LIMIT 1', id)
        .then((rows) => rows[0] ?? null);
};
exports.softDeleteLesson = softDeleteLesson;
