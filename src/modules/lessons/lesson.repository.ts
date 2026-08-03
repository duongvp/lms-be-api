import prisma from '../../lib/prisma';
import { LessonExportQuery, LessonImportMode, LessonImportResult, LessonImportRow, LessonListQuery, LessonPayload } from './lesson.types';

const syncCalendarFromLesson = async (tx: any, lessonId: bigint) => {
  await tx.$executeRawUnsafe(
    `UPDATE calendar AS calendar_row
     INNER JOIN lessons AS lesson ON lesson.id = calendar_row.session_id
     SET calendar_row.learn_number = lesson.learn_number,
         calendar_row.subject = lesson.subject_name,
         calendar_row.lesson_name = lesson.lesson_name,
         calendar_row.lesson_document = lesson.lesson_document,
         calendar_row.evg_banner = lesson.evg_banner,
         calendar_row.evg_stream = lesson.evg_stream,
         calendar_row.lesson_link = lesson.lesson_link,
         calendar_row.lesson_baitap = lesson.lesson_baitap,
         calendar_row.lesson_tomtat = lesson.lesson_tomtat,
         calendar_row.lesson_phuongphap = lesson.lesson_phuongphap,
         calendar_row.lesson_luuy = lesson.lesson_luuy,
         calendar_row.lesson_ketqua = lesson.lesson_ketqua,
         calendar_row.updated_at = CURRENT_TIMESTAMP
     WHERE lesson.id = ?`,
    lessonId
  );
};

const buildWhere = (query: LessonListQuery) => {
  const clauses: string[] = ['status = ?'];
  const values: any[] = [query.status ?? 1];

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

export const findLessons = async (query: LessonListQuery) => {
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

  const countRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*) AS total FROM lessons ${whereSql}`,
    ...values
  );
  const data = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${selectSql} FROM lessons ${whereSql} ORDER BY ${sortBy} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`,
    ...selectValues,
    limit,
    skip
  );

  return {
    total: Number(countRows[0]?.total ?? 0),
    page,
    limit,
    data,
  };
};

export const findLessonSubjectOptions = async () => {
  return prisma.$queryRawUnsafe<Array<{ subject_name: string; subject_code: string }>>(
    `SELECT subject_name, MIN(subject_code) AS subject_code
     FROM lessons
     WHERE status <> 0
       AND subject_name IS NOT NULL
       AND TRIM(subject_name) <> ''
     GROUP BY subject_name
     ORDER BY subject_name ASC`
  );
};

export const findLessonProgramOptions = async () => {
  return prisma.$queryRawUnsafe<Array<{
    grade: number;
    subject_name: string;
    subject_code: string;
  }>>(
    `SELECT DISTINCT grade, subject_name, subject_code
     FROM lessons
     WHERE status <> 0
       AND subject_code IS NOT NULL
       AND TRIM(subject_code) <> ''
     ORDER BY subject_name ASC, grade ASC, subject_code ASC`
  );
};

export const findLessonsForExport = async (query: LessonExportQuery) => {
  if (query.ids?.length) {
    const placeholders = query.ids.map(() => '?').join(', ');
    return prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`,
      ...query.ids
    );
  }

  const { whereSql, values } = buildWhere({ ...query, page: undefined, limit: undefined });
  const sortBy = query.sort_by ?? 'grade';
  const sortOrder = query.sort_order ?? 'asc';

  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM lessons ${whereSql} ORDER BY ${sortBy} ${sortOrder.toUpperCase()}, subject_code ASC, learn_number ASC`,
    ...values
  );
};

export const findLessonById = async (id: bigint) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1',
    id
  );
  return rows[0] ?? null;
};

export const findLessonByIdentity = async (
  grade: number,
  subjectCode: string,
  learnNumber: number,
  excludeId?: bigint
) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND learn_number = ? AND status <> 0${excludeId ? ' AND id <> ?' : ''} LIMIT 1`,
    ...(excludeId ? [grade, subjectCode, learnNumber, excludeId] : [grade, subjectCode, learnNumber])
  );
  return rows[0] ?? null;
};

export const findNextLearnNumber = async (grade: number, subjectCode: string) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    'SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0',
    grade,
    subjectCode
  );
  return Number(rows[0]?.next_learn_number ?? 1);
};

export const findLessonsByGroup = async (grade: number, subjectCode: string) => {
  return prisma.$queryRawUnsafe<any[]>(
    'SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0 ORDER BY learn_number ASC, id ASC',
    grade,
    subjectCode
  );
};

export const createLesson = async (payload: LessonPayload) => {
  return prisma.$transaction(async (tx) => {
    let learnNumber = payload.learn_number;
    if (learnNumber === undefined) {
      const nextRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0',
        payload.grade,
        payload.subject_code
      );
      learnNumber = Number(nextRows[0]?.next_learn_number ?? 1);
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO lessons (
        grade, subject_code, subject_name, learn_number,
        lesson_name, lesson_document, evg_banner, evg_stream, lesson_link,
        lesson_baitap, lesson_tomtat, lesson_phuongphap,
        lesson_luuy, lesson_ketqua, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      payload.grade,
      payload.subject_code,
      payload.subject_name,
      learnNumber,
      payload.lesson_name,
      payload.lesson_document ?? null,
      payload.evg_banner ?? null,
      payload.evg_stream ?? null,
      payload.lesson_link ?? null,
      payload.lesson_baitap ?? null,
      payload.lesson_tomtat ?? null,
      payload.lesson_phuongphap ?? null,
      payload.lesson_luuy ?? null,
      payload.lesson_ketqua ?? null,
      payload.status ?? 1
    );

    const rows = await tx.$queryRawUnsafe<any[]>('SELECT * FROM lessons WHERE id = LAST_INSERT_ID() LIMIT 1');
    return rows[0] ?? null;
  });
};

export const updateLesson = async (id: bigint, payload: Partial<LessonPayload>) => {
  const entries = Object.entries(payload);
  const setSql = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value ?? null);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE lessons SET ${setSql}, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      ...values,
      id
    );
    await syncCalendarFromLesson(tx, id);
    const rows = await tx.$queryRawUnsafe<any[]>(
      'SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1',
      id
    );
    return rows[0] ?? null;
  });
};

export const bulkUpdateLessons = async (ids: bigint[], payload: Partial<LessonPayload>) => {
  const entries = Object.entries(payload);
  const setSql = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value ?? null);
  const placeholders = ids.map(() => '?').join(', ');

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE lessons SET ${setSql}, updated_at = CURRENT_TIMESTAMP(3) WHERE id IN (${placeholders}) AND status <> 0`,
      ...values,
      ...ids
    );
    for (const id of ids) await syncCalendarFromLesson(tx, id);
    return tx.$queryRawUnsafe<any[]>(
      `SELECT * FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`,
      ...ids
    );
  });
};

export const reorderLessonsInGroup = async (
  grade: number,
  subjectCode: string,
  orderedIds: bigint[]
) => {
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.$executeRawUnsafe(
        'UPDATE lessons SET learn_number = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND grade = ? AND subject_code = ? AND status <> 0',
        -(index + 1),
        orderedIds[index],
        grade,
        subjectCode
      );
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      await tx.$executeRawUnsafe(
        'UPDATE lessons SET learn_number = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND grade = ? AND subject_code = ? AND status <> 0',
        index + 1,
        orderedIds[index],
        grade,
        subjectCode
      );
      await syncCalendarFromLesson(tx, orderedIds[index]);
    }
  });

  return findLessonsByGroup(grade, subjectCode);
};

export const importLessons = async (rows: LessonImportRow[], mode: LessonImportMode): Promise<LessonImportResult> => {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const nextLearnNumberByGroup = new Map<string, number>();

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      let learnNumber = row.learn_number;
      const groupKey = `${row.grade}|${row.subject_code}`;

      if (learnNumber === undefined) {
        if (!nextLearnNumberByGroup.has(groupKey)) {
          const maxRows = await tx.$queryRawUnsafe<any[]>(
            'SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE grade = ? AND subject_code = ? AND status <> 0',
            row.grade,
            row.subject_code
          );
          nextLearnNumberByGroup.set(groupKey, Number(maxRows[0]?.next_learn_number ?? 1));
        }
        learnNumber = nextLearnNumberByGroup.get(groupKey) as number;
        nextLearnNumberByGroup.set(groupKey, learnNumber + 1);
      }

      const existingRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT * FROM lessons WHERE grade = ? AND subject_code = ? AND learn_number = ? AND status <> 0 LIMIT 1',
        row.grade,
        row.subject_code,
        learnNumber
      );
      const existing = existingRows[0];

      if (existing) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }

        if (row.status === 0) {
          await tx.$executeRawUnsafe(
            `UPDATE lessons SET
              lesson_name = ?, lesson_document = ?, evg_banner = ?, evg_stream = ?, lesson_link = ?,
              lesson_baitap = ?, lesson_tomtat = ?,
              lesson_phuongphap = ?, lesson_luuy = ?, lesson_ketqua = ?, status = 0,
              learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
            row.lesson_name,
            row.lesson_document ?? null,
            row.evg_banner ?? null,
            row.evg_stream ?? null,
            row.lesson_link ?? null,
            row.lesson_baitap ?? null,
            row.lesson_tomtat ?? null,
            row.lesson_phuongphap ?? null,
            row.lesson_luuy ?? null,
            row.lesson_ketqua ?? null,
            existing.id
          );
        } else {
          await tx.$executeRawUnsafe(
            `UPDATE lessons SET
              subject_name = ?, lesson_name = ?, lesson_document = ?,
              evg_banner = ?, evg_stream = ?, lesson_link = ?,
              lesson_baitap = ?, lesson_tomtat = ?,
              lesson_phuongphap = ?, lesson_luuy = ?, lesson_ketqua = ?, status = ?,
              updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
            row.subject_name,
            row.lesson_name,
            row.lesson_document ?? null,
            row.evg_banner ?? null,
            row.evg_stream ?? null,
            row.lesson_link ?? null,
            row.lesson_baitap ?? null,
            row.lesson_tomtat ?? null,
            row.lesson_phuongphap ?? null,
            row.lesson_luuy ?? null,
            row.lesson_ketqua ?? null,
            row.status ?? 1,
            existing.id
          );
          await syncCalendarFromLesson(tx, BigInt(existing.id));
        }
        updated += 1;
        continue;
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO lessons (
          grade, subject_code, subject_name, learn_number,
          lesson_name, lesson_document, evg_banner, evg_stream, lesson_link,
          lesson_baitap, lesson_tomtat, lesson_phuongphap,
          lesson_luuy, lesson_ketqua, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        row.grade,
        row.subject_code,
        row.subject_name,
        learnNumber,
        row.lesson_name,
        row.lesson_document ?? null,
        row.evg_banner ?? null,
        row.evg_stream ?? null,
        row.lesson_link ?? null,
        row.lesson_baitap ?? null,
        row.lesson_tomtat ?? null,
        row.lesson_phuongphap ?? null,
        row.lesson_luuy ?? null,
        row.lesson_ketqua ?? null,
        row.status ?? 1
      );

      if (row.status === 0) {
        await tx.$executeRawUnsafe(
          'UPDATE lessons SET learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3) WHERE id = LAST_INSERT_ID()'
        );
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

export const deleteLessonIfUnscheduled = async (id: bigint) => {
  return prisma.$transaction(async (tx) => {
    const lessons = await tx.$queryRawUnsafe<any[]>(
      'SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1 FOR UPDATE',
      id
    );
    const lesson = lessons[0] ?? null;
    if (!lesson) return { lesson: null, scheduledCount: 0 };

    const counts = await tx.$queryRawUnsafe<Array<{ total: bigint }>>(
      'SELECT COUNT(*) AS total FROM calendar WHERE session_id = ?',
      id
    );
    const scheduledCount = Number(counts[0]?.total ?? 0);
    if (scheduledCount > 0) return { lesson, scheduledCount };

    await tx.$executeRawUnsafe('DELETE FROM lessons WHERE id = ?', id);
    return { lesson, scheduledCount: 0 };
  });
};
