import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import {
  QuizBulkUpdatePayload,
  QuizCreatePayload,
  QuizImportResult,
  QuizImportRow,
  QuizIndexSuggestionQuery,
  QuizListQuery,
  QuizPayload,
  QuizReorderPayload,
  QuizSubmissionQuery,
} from './quiz.types';

const buildQuizWhere = (query: QuizListQuery, allowedPrograms: string[] | null = null) => {
  const where: Record<string, any> = {};
  if (allowedPrograms !== null) where.code = { in: allowedPrograms };
  if (query.code) where.code = allowedPrograms === null
    ? query.code
    : (allowedPrograms.includes(query.code) ? query.code : { in: [] });
  if (query.learn_number !== undefined) where.learn_number = query.learn_number;
  if (query.quiz_type !== undefined) where.quiz_type = query.quiz_type;
  if (query.score_type !== undefined) where.score_type = query.score_type;
  if (query.quiz_status) where.quiz_status = query.quiz_status;
  if (query.keyword) where.quiz_name = { contains: query.keyword };
  return where;
};

export const findQuizzes = async (query: QuizListQuery, allowedPrograms: string[] | null = null) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const where = buildQuizWhere(query, allowedPrograms);
  const sortBy = query.sort_by ?? 'updated_at';
  const sortOrder = query.sort_order ?? 'desc';
  const [total, data] = await prisma.$transaction([
    prisma.quiz_content.count({ where: where as any }),
    prisma.quiz_content.findMany({
      where: where as any,
      orderBy: [{ [sortBy]: sortOrder } as any, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { total, page, limit, data };
};

export const findQuizzesForExport = async (query: QuizListQuery, quizIds?: string[], allowedPrograms: string[] | null = null) => (
  prisma.quiz_content.findMany({
    where: quizIds?.length
      ? { quiz_id: { in: quizIds }, ...(allowedPrograms === null ? {} : { code: { in: allowedPrograms } }) }
      : buildQuizWhere(query, allowedPrograms) as any,
    orderBy: [
      { code: 'asc' },
      { learn_number: 'asc' },
      { quiz_index: 'asc' },
      { id: 'asc' },
    ],
  })
);

export const findQuizById = async (quizId: string) => (
  prisma.quiz_content.findUnique({ where: { quiz_id: quizId } })
);

export const findQuizzesByIds = async (quizIds: string[]) => (
  prisma.quiz_content.findMany({ where: { quiz_id: { in: quizIds } } })
);

export const findEnabledQuizzesByGroup = async (code: string, learnNumber: number) => (
  prisma.quiz_content.findMany({
    where: { code, learn_number: learnNumber, quiz_status: { not: 'disable' } },
    orderBy: [{ quiz_index: 'asc' }, { id: 'asc' }],
  })
);

export const findQuizIndexSuggestion = async ({
  code,
  learn_number,
  quiz_index,
  exclude_quiz_id,
}: QuizIndexSuggestionQuery) => {
  const where = {
    code,
    learn_number,
    OR: [
      { quiz_status: null },
      { quiz_status: { not: 'disable' as const } },
    ],
    ...(exclude_quiz_id ? { quiz_id: { not: exclude_quiz_id } } : {}),
  };
  const [maxRow, duplicate] = await prisma.$transaction([
    prisma.quiz_content.findFirst({
      where,
      orderBy: [{ quiz_index: 'desc' }, { id: 'desc' }],
      select: { quiz_index: true },
    }),
    quiz_index === undefined
      ? prisma.quiz_content.findFirst({ where: { quiz_id: '__never__' } })
      : prisma.quiz_content.findFirst({
        where: { ...where, quiz_index },
        orderBy: [{ id: 'asc' }],
      }),
  ]);
  return {
    next_index: Number(maxRow?.quiz_index ?? 0) + 1,
    duplicate,
  };
};

export const findQuizClassOptions = async (allowedPrograms: string[] | null = null) => {
  const rows = await prisma.$queryRawUnsafe<Array<{
    code: string;
    subject_name: string | null;
    lesson_count: bigint | number;
  }>>(
    `SELECT calendar.code,
            MAX(NULLIF(TRIM(calendar.subject), '')) AS subject_name,
            COUNT(DISTINCT calendar.learn_number) AS lesson_count
     FROM calendar
     WHERE calendar.code IS NOT NULL AND TRIM(calendar.code) <> ''
     GROUP BY calendar.code
     ORDER BY subject_name ASC, calendar.code ASC`
  );
  return rows
    .filter((row) => allowedPrograms === null || allowedPrograms.includes(row.code))
    .map((row) => ({ ...row, lesson_count: Number(row.lesson_count) }));
};

export const findQuizLessonOptions = async (code: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{
    lesson_id: bigint | null;
    learn_number: number;
    lesson_name: string | null;
    subject_name: string | null;
    grade: number | null;
  }>>(
    `SELECT MAX(lesson.id) AS lesson_id,
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
     ORDER BY calendar.learn_number ASC`,
    code
  );
  return rows.map((row) => ({
    ...row,
    lesson_id: row.lesson_id == null ? null : String(row.lesson_id),
    learn_number: Number(row.learn_number),
    grade: row.grade == null ? null : Number(row.grade),
  }));
};

export const createQuiz = async (quizId: string, payload: QuizCreatePayload, creator: string) => (
  prisma.quiz_content.create({
    data: {
      quiz_id: quizId,
      code: payload.code,
      learn_number: payload.learn_number,
      quiz_type: payload.quiz_type,
      quiz_name: payload.quiz_name,
      ans: payload.ans as any,
      score_type: payload.score_type,
      ans_duration: payload.ans_duration,
      quiz_status: payload.quiz_status as any,
      quiz_index: payload.quiz_index,
      creator,
      updated_at: new Date(),
    },
  })
);

export const updateQuiz = async (quizId: string, payload: Partial<QuizPayload>) => (
  prisma.quiz_content.update({
    where: { quiz_id: quizId },
    data: { ...payload, ans: payload.ans as any, updated_at: new Date() } as any,
  })
);

export const setQuizStatus = async (quizId: string, status: 'done' | 'disable') => (
  prisma.quiz_content.update({
    where: { quiz_id: quizId },
    data: { quiz_status: status, updated_at: new Date() },
  })
);

export const bulkUpdateQuizzes = async ({ quiz_ids, data }: QuizBulkUpdatePayload) => {
  await prisma.quiz_content.updateMany({
    where: { quiz_id: { in: quiz_ids } },
    data: { ...data, updated_at: new Date() } as any,
  });
  return findQuizzesByIds(quiz_ids);
};

export const reorderQuizzes = async ({ code, learn_number, ordered_quiz_ids }: QuizReorderPayload) => {
  await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRawUnsafe<Array<{ quiz_id: string }>>(
      `SELECT quiz_id
       FROM quiz_content
       WHERE code = ? AND learn_number = ? AND (quiz_status IS NULL OR quiz_status <> 'disable')
       ORDER BY id ASC
       FOR UPDATE`,
      code,
      learn_number
    );
    const lockedIds = new Set(lockedRows.map((row) => row.quiz_id));
    if (
      lockedIds.size !== ordered_quiz_ids.length
      || ordered_quiz_ids.some((quizId) => !lockedIds.has(quizId))
    ) {
      throw new ApiError('Danh sách quiz đã thay đổi; vui lòng tải lại trước khi sắp xếp', 409);
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
  return findEnabledQuizzesByGroup(code, learn_number);
};

export const importQuizzes = async (
  rows: QuizImportRow[],
  mode: 'skip' | 'overwrite'
): Promise<QuizImportResult> => {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const existing = await tx.quiz_content.findUnique({ where: { quiz_id: row.quiz_id as string } });
      const data = {
        code: row.code,
        learn_number: row.learn_number,
        quiz_type: row.quiz_type,
        quiz_name: row.quiz_name,
        ans: row.ans as any,
        score_type: row.score_type,
        ans_duration: row.ans_duration,
        quiz_status: row.quiz_status as any,
        quiz_index: row.quiz_index,
        updated_at: new Date(),
      };
      if (existing) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }
        await tx.quiz_content.update({ where: { quiz_id: row.quiz_id as string }, data });
        updated += 1;
        continue;
      }
      await tx.quiz_content.create({
        data: { ...data, quiz_id: row.quiz_id as string, creator: (row as any).creator },
      });
      created += 1;
    }
  });
  return { total: rows.length, created, updated, skipped };
};

const buildSubmissionFilter = (quizId: string, query: QuizSubmissionQuery, alias = '') => {
  const prefix = alias ? `${alias}.` : '';
  const clauses = [`${prefix}quiz_id = ?`];
  const values: any[] = [quizId];
  if (query.username) {
    clauses.push(`${prefix}username = ?`);
    values.push(query.username);
  }
  if (query.class_id) {
    clauses.push(`${prefix}class_id = ?`);
    values.push(query.class_id);
  }
  return { sql: clauses.join(' AND '), values };
};

export const findQuizSubmissions = async (quizId: string, query: QuizSubmissionQuery) => {
  const offset = (query.page - 1) * query.limit;
  const order = query.sort_order.toUpperCase();
  const filter = buildSubmissionFilter(quizId, query);

  if (query.latest) {
    const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT COUNT(*) AS total FROM (
         SELECT MAX(id) AS id FROM quiz_logs WHERE ${filter.sql} GROUP BY username
       ) latest_rows`,
      ...filter.values
    );
    const data = await prisma.$queryRawUnsafe<any[]>(
      `SELECT ql.*,
              CASE WHEN CAST(ql.ans_info AS CHAR) LIKE '%star%' THEN 1 ELSE 0 END AS is_star
       FROM quiz_logs ql
       INNER JOIN (
         SELECT MAX(id) AS id FROM quiz_logs WHERE ${filter.sql} GROUP BY username
       ) latest_rows ON latest_rows.id = ql.id
       ORDER BY ql.created_at ${order}, ql.id ${order}
       LIMIT ? OFFSET ?`,
      ...filter.values,
      query.limit,
      offset
    );
    return { total: Number(countRows[0]?.total ?? 0), page: query.page, limit: query.limit, data };
  }

  const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total FROM quiz_logs WHERE ${filter.sql}`,
    ...filter.values
  );
  const data = await prisma.$queryRawUnsafe<any[]>(
    `SELECT quiz_logs.*,
            CASE WHEN CAST(ans_info AS CHAR) LIKE '%star%' THEN 1 ELSE 0 END AS is_star
     FROM quiz_logs WHERE ${filter.sql}
     ORDER BY created_at ${order}, id ${order}
     LIMIT ? OFFSET ?`,
    ...filter.values,
    query.limit,
    offset
  );
  return { total: Number(countRows[0]?.total ?? 0), page: query.page, limit: query.limit, data };
};

export const getQuizAnalytics = async (quizId: string) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
       COUNT(*) AS submission_count,
       COUNT(DISTINCT username) AS student_count,
       COALESCE(AVG(score), 0) AS average_score,
       COALESCE(MIN(score), 0) AS minimum_score,
       COALESCE(MAX(score), 0) AS maximum_score,
       COALESCE(AVG(duration), 0) AS average_duration,
       SUM(CASE WHEN CAST(ans_info AS CHAR) LIKE '%star%' THEN 1 ELSE 0 END) AS star_record_count,
       MIN(created_at) AS first_submission_at,
       MAX(created_at) AS last_submission_at
     FROM quiz_logs
     WHERE quiz_id = ?`,
    quizId
  );
  return rows[0] ?? null;
};
