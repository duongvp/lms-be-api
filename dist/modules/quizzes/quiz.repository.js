"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importQuizzes = exports.reorderQuizzes = exports.bulkUpdateQuizzes = exports.setQuizStatus = exports.updateQuiz = exports.createQuiz = exports.findQuizLessonOptions = exports.findQuizClassOptions = exports.findQuizIndexSuggestion = exports.findEnabledQuizzesByGroup = exports.findQuizzesByIds = exports.findQuizById = exports.findQuizzesForExport = exports.findQuizzes = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const buildQuizWhere = (query, allowedPrograms = null) => {
    const where = {};
    if (allowedPrograms !== null)
        where.code = { in: allowedPrograms };
    if (query.code)
        where.code = allowedPrograms === null
            ? query.code
            : (allowedPrograms.includes(query.code) ? query.code : { in: [] });
    if (query.learn_number !== undefined)
        where.learn_number = query.learn_number;
    if (query.quiz_type !== undefined) {
        where.quiz_type = Array.isArray(query.quiz_type) ? { in: query.quiz_type } : query.quiz_type;
    }
    if (query.score_type !== undefined)
        where.score_type = query.score_type;
    if (query.quiz_status)
        where.quiz_status = query.quiz_status;
    if (query.keyword)
        where.quiz_name = { contains: query.keyword };
    return where;
};
const findQuizzes = async (query, allowedPrograms = null) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = buildQuizWhere(query, allowedPrograms);
    const sortBy = query.sort_by ?? 'updated_at';
    const sortOrder = query.sort_order ?? 'desc';
    const [total, data] = await prisma_1.default.$transaction([
        prisma_1.default.quiz_content.count({ where: where }),
        prisma_1.default.quiz_content.findMany({
            where: where,
            orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return { total, page, limit, data };
};
exports.findQuizzes = findQuizzes;
const findQuizzesForExport = async (query, quizIds, allowedPrograms = null) => (prisma_1.default.quiz_content.findMany({
    where: quizIds?.length
        ? { quiz_id: { in: quizIds }, ...(allowedPrograms === null ? {} : { code: { in: allowedPrograms } }) }
        : buildQuizWhere(query, allowedPrograms),
    orderBy: [
        { code: 'asc' },
        { learn_number: 'asc' },
        { quiz_index: 'asc' },
        { id: 'asc' },
    ],
}));
exports.findQuizzesForExport = findQuizzesForExport;
const findQuizById = async (quizId) => (prisma_1.default.quiz_content.findUnique({ where: { quiz_id: quizId } }));
exports.findQuizById = findQuizById;
const findQuizzesByIds = async (quizIds) => (prisma_1.default.quiz_content.findMany({ where: { quiz_id: { in: quizIds } } }));
exports.findQuizzesByIds = findQuizzesByIds;
const findEnabledQuizzesByGroup = async (code, learnNumber) => (prisma_1.default.quiz_content.findMany({
    where: { code, learn_number: learnNumber, quiz_status: { not: 'disable' } },
    orderBy: [{ quiz_index: 'asc' }, { id: 'asc' }],
}));
exports.findEnabledQuizzesByGroup = findEnabledQuizzesByGroup;
const findQuizIndexSuggestion = async ({ code, learn_number, quiz_index, exclude_quiz_id, }) => {
    const where = {
        code,
        learn_number,
        OR: [
            { quiz_status: null },
            { quiz_status: { not: 'disable' } },
        ],
        ...(exclude_quiz_id ? { quiz_id: { not: exclude_quiz_id } } : {}),
    };
    const [maxRow, duplicate] = await prisma_1.default.$transaction([
        prisma_1.default.quiz_content.findFirst({
            where,
            orderBy: [{ quiz_index: 'desc' }, { id: 'desc' }],
            select: { quiz_index: true },
        }),
        quiz_index === undefined
            ? prisma_1.default.quiz_content.findFirst({ where: { quiz_id: '__never__' } })
            : prisma_1.default.quiz_content.findFirst({
                where: { ...where, quiz_index },
                orderBy: [{ id: 'asc' }],
            }),
    ]);
    return {
        next_index: Number(maxRow?.quiz_index ?? 0) + 1,
        duplicate,
    };
};
exports.findQuizIndexSuggestion = findQuizIndexSuggestion;
const findQuizClassOptions = async (allowedPrograms = null) => {
    const rows = await prisma_1.default.$queryRawUnsafe(`SELECT calendar.code,
            MAX(NULLIF(TRIM(calendar.subject), '')) AS subject_name,
            COUNT(DISTINCT calendar.learn_number) AS lesson_count
     FROM calendar
     WHERE calendar.code IS NOT NULL AND TRIM(calendar.code) <> ''
     GROUP BY calendar.code
     ORDER BY subject_name ASC, calendar.code ASC`);
    return rows
        .filter((row) => allowedPrograms === null || allowedPrograms.includes(row.code))
        .map((row) => ({ ...row, lesson_count: Number(row.lesson_count) }));
};
exports.findQuizClassOptions = findQuizClassOptions;
const findQuizLessonOptions = async (code) => {
    const rows = await prisma_1.default.$queryRawUnsafe(`SELECT MAX(lesson.id) AS lesson_id,
            calendar.learn_number,
            COALESCE(
              MAX(NULLIF(TRIM(lesson.lesson_name), '')),
              MAX(NULLIF(TRIM(calendar.lesson_name), '')),
              CONCAT('Bài ', calendar.learn_number)
            ) AS lesson_name,
            COALESCE(
              MAX(NULLIF(TRIM(lesson.subject_name), '')),
              MAX(NULLIF(TRIM(calendar.subject), ''))
            ) AS subject_name,
            MAX(lesson.grade) AS grade
     FROM calendar
     LEFT JOIN lessons AS lesson ON lesson.id = calendar.session_id
     WHERE calendar.code = ?
     GROUP BY calendar.learn_number
     ORDER BY calendar.learn_number ASC`, code);
    return rows.map((row) => ({
        ...row,
        lesson_id: row.lesson_id == null ? null : String(row.lesson_id),
        learn_number: Number(row.learn_number),
        grade: row.grade == null ? null : Number(row.grade),
    }));
};
exports.findQuizLessonOptions = findQuizLessonOptions;
const createQuiz = async (quizId, payload, creator) => (prisma_1.default.quiz_content.create({
    data: {
        quiz_id: quizId,
        code: payload.code,
        learn_number: payload.learn_number,
        quiz_type: payload.quiz_type,
        quiz_name: payload.quiz_name,
        ans: payload.ans,
        score_type: payload.score_type,
        ans_duration: payload.ans_duration,
        quiz_status: payload.quiz_status,
        quiz_index: payload.quiz_index,
        creator,
        updated_at: new Date(),
    },
}));
exports.createQuiz = createQuiz;
const updateQuiz = async (quizId, payload) => (prisma_1.default.quiz_content.update({
    where: { quiz_id: quizId },
    data: { ...payload, ans: payload.ans, updated_at: new Date() },
}));
exports.updateQuiz = updateQuiz;
const setQuizStatus = async (quizId, status) => (prisma_1.default.quiz_content.update({
    where: { quiz_id: quizId },
    data: { quiz_status: status, updated_at: new Date() },
}));
exports.setQuizStatus = setQuizStatus;
const bulkUpdateQuizzes = async ({ quiz_ids, data }) => {
    await prisma_1.default.quiz_content.updateMany({
        where: { quiz_id: { in: quiz_ids } },
        data: { ...data, updated_at: new Date() },
    });
    return (0, exports.findQuizzesByIds)(quiz_ids);
};
exports.bulkUpdateQuizzes = bulkUpdateQuizzes;
const reorderQuizzes = async ({ code, learn_number, ordered_quiz_ids }) => {
    await prisma_1.default.$transaction(async (tx) => {
        const lockedRows = await tx.$queryRawUnsafe(`SELECT quiz_id
       FROM quiz_content
       WHERE code = ? AND learn_number = ? AND (quiz_status IS NULL OR quiz_status <> 'disable')
       ORDER BY id ASC
       FOR UPDATE`, code, learn_number);
        const lockedIds = new Set(lockedRows.map((row) => row.quiz_id));
        if (lockedIds.size !== ordered_quiz_ids.length
            || ordered_quiz_ids.some((quizId) => !lockedIds.has(quizId))) {
            throw new ApiError_1.default('Danh sách quiz đã thay đổi; vui lòng tải lại trước khi sắp xếp', 409);
        }
        for (let index = 0; index < ordered_quiz_ids.length; index += 1) {
            await tx.quiz_content.update({
                where: { quiz_id: ordered_quiz_ids[index] },
                data: { quiz_index: -(index + 1), updated_at: new Date() },
            });
        }
        for (let index = 0; index < ordered_quiz_ids.length; index += 1) {
            await tx.quiz_content.update({
                where: { quiz_id: ordered_quiz_ids[index] },
                data: { quiz_index: index + 1, updated_at: new Date() },
            });
        }
    });
    return (0, exports.findEnabledQuizzesByGroup)(code, learn_number);
};
exports.reorderQuizzes = reorderQuizzes;
const importQuizzes = async (rows, mode) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    await prisma_1.default.$transaction(async (tx) => {
        for (const row of rows) {
            const existing = await tx.quiz_content.findUnique({ where: { quiz_id: row.quiz_id } });
            const data = {
                code: row.code,
                learn_number: row.learn_number,
                quiz_type: row.quiz_type,
                quiz_name: row.quiz_name,
                ans: row.ans,
                score_type: row.score_type,
                ans_duration: row.ans_duration,
                quiz_status: row.quiz_status,
                quiz_index: row.quiz_index,
                updated_at: new Date(),
            };
            if (existing) {
                if (mode === 'skip') {
                    skipped += 1;
                    continue;
                }
                await tx.quiz_content.update({ where: { quiz_id: row.quiz_id }, data });
                updated += 1;
                continue;
            }
            await tx.quiz_content.create({
                data: { ...data, quiz_id: row.quiz_id, creator: row.creator },
            });
            created += 1;
        }
    });
    return { total: rows.length, created, updated, skipped };
};
exports.importQuizzes = importQuizzes;
