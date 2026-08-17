import prisma from '../../lib/prisma';
import { LessonExportQuery, LessonImportMode, LessonImportResult, LessonImportRow, LessonListQuery, LessonPayload } from './lesson.types';

// Các trường tài liệu/nội dung buổi học vẫn được giữ ở DB để không mất dữ liệu
// cũ, nhưng không còn là dữ liệu của đề cương và không được trả về từ module này.
const LESSON_COLUMNS = 'id, grade, system_type, subject_code, subject_name, learn_number, lesson_name, status, created_at, updated_at';

const syncCalendarsFromLessons = async (tx: any, lessonIds: bigint[]) => {
  if (lessonIds.length === 0) return;
  const placeholders = lessonIds.map(() => '?').join(', ');
  await tx.$executeRawUnsafe(
    `UPDATE calendar AS calendar_row
     INNER JOIN lessons AS lesson ON lesson.id = calendar_row.session_id
     SET calendar_row.subject = lesson.subject_name,
         calendar_row.lesson_name = lesson.lesson_name,
         calendar_row.updated_at = CURRENT_TIMESTAMP
     WHERE lesson.id IN (${placeholders})`,
    ...lessonIds
  );
};

/**
 * Khi sắp xếp nội dung, learn_number của calendar đại diện cho slot lịch và
 * phải đứng yên. Nội dung bài mới được gắn vào slot cùng learn_number; tuyệt
 * đối không di chuyển start/end time hoặc phân công giảng dạy theo lesson id.
 */
const syncCalendarSlotsAfterLessonReorder = async (
  tx: any,
  grade: number | undefined,
  subjectCode: string,
  lessonIds: bigint[],
  learnNumbers: number[]
) => {
  if (lessonIds.length === 0 || learnNumbers.length === 0) return;
  const lessonPlaceholders = lessonIds.map(() => '?').join(', ');
  const learnNumberPlaceholders = learnNumbers.map(() => '?').join(', ');

  await tx.$executeRawUnsafe(
    `UPDATE calendar AS calendar_row
     INNER JOIN lessons AS lesson
       ON lesson.grade <=> ?
      AND lesson.subject_code = ?
      AND lesson.learn_number = calendar_row.learn_number
      AND lesson.status <> 0
      AND lesson.id IN (${lessonPlaceholders})
     SET calendar_row.session_id = lesson.id,
         calendar_row.subject = lesson.subject_name,
         calendar_row.lesson_name = lesson.lesson_name,
         calendar_row.updated_at = CURRENT_TIMESTAMP
     WHERE calendar_row.code = ?
       AND calendar_row.learn_number IN (${learnNumberPlaceholders})`,
    grade,
    subjectCode,
    ...lessonIds,
    subjectCode,
    ...learnNumbers
  );
};

const syncCalendarFromLesson = async (tx: any, lessonId: bigint) =>
  syncCalendarsFromLessons(tx, [lessonId]);

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
  const programCode = query.subject_code || query.course_code;
  const selectSql = programCode
    ? `lessons.${LESSON_COLUMNS}, (
        SELECT COUNT(*)
        FROM calendar
        WHERE calendar.session_id = lessons.id
           OR (calendar.code = lessons.subject_code
             AND calendar.learn_number = lessons.learn_number)
      ) AS scheduled_count, (
        SELECT COUNT(*)
        FROM calendar
        WHERE (calendar.session_id = lessons.id
          OR (calendar.code = lessons.subject_code
            AND calendar.learn_number = lessons.learn_number))
          AND calendar.start_time <= NOW()
      ) AS past_scheduled_count`
    : `lessons.${LESSON_COLUMNS}`;
  const selectValues = values;

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

export const findLessonProgramOptions = async (allowedPrograms: string[] | null = null) => {
  const rows = await prisma.$queryRawUnsafe<Array<{
    grade: number | null;
    system_type: 'topclass' | 'topuni' | null;
    subject_name: string | null;
    subject_code: string;
  }>>(
    `SELECT program.subject_code,
            COALESCE(
              MAX(CASE
                WHEN program.subject_name IS NOT NULL
                 AND TRIM(program.subject_name) <> ''
                 AND TRIM(program.subject_name) <> TRIM(program.subject_code)
                THEN program.subject_name
              END),
              MAX(program.subject_name)
            ) AS subject_name,
            MIN(program.grade) AS grade,
            MAX(program.system_type) AS system_type
     FROM (
       SELECT subject_code, subject_name, grade, system_type
       FROM lessons
       WHERE subject_code IS NOT NULL AND TRIM(subject_code) <> ''
       UNION ALL
       SELECT code AS subject_code, subject AS subject_name, NULL AS grade, NULL AS system_type
       FROM calendar
       WHERE code IS NOT NULL AND TRIM(code) <> ''
     ) AS program
     GROUP BY program.subject_code
     ORDER BY subject_name ASC, grade ASC, subject_code ASC`
  );
  return allowedPrograms === null
    ? rows
    : rows.filter((row) => allowedPrograms.includes(row.subject_code));
};

export const findLessonProgramByCode = async (programCode: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{
    grade: number | null;
    system_type: 'topclass' | 'topuni';
    subject_name: string;
    subject_code: string;
  }>>(
    `SELECT grade, system_type, subject_name, subject_code
     FROM lessons
     WHERE status <> 0 AND subject_code = ?
     ORDER BY id ASC
     LIMIT 1`,
    programCode
  );
  return rows[0] ?? null;
};

export const findLessonCourseMappings = async (programCode: string) =>
  prisma.$queryRawUnsafe<any[]>(
    `SELECT mapping.id, mapping.lesson_id, mapping.package_id, mapping.course_id,
            lesson.learn_number, lesson.lesson_name
     FROM lesson_course_mapping AS mapping
     INNER JOIN lessons AS lesson ON lesson.id = mapping.lesson_id
     WHERE lesson.subject_code = ? AND lesson.status <> 0
     ORDER BY lesson.learn_number ASC, mapping.package_id ASC, mapping.course_id ASC`,
    programCode
  );

export const updateLessonCourseMappings = async (input: {
  programCode: string;
  action: 'add' | 'delete';
  packageId: string;
  courseId: string;
  lessonIds?: bigint[];
}) => prisma.$transaction(async (tx) => {
  const params: any[] = [input.programCode];
  const lessonFilter = input.lessonIds?.length
    ? ` AND lesson.id IN (${input.lessonIds.map(() => '?').join(', ')})`
    : '';
  params.push(...(input.lessonIds ?? []));
  const lessons = await tx.$queryRawUnsafe<Array<{ id: bigint }>>(
    `SELECT lesson.id
     FROM lessons AS lesson
     WHERE lesson.subject_code = ? AND lesson.status <> 0${lessonFilter}
     ORDER BY lesson.learn_number ASC
     FOR UPDATE`,
    ...params
  );
  if (!lessons.length) throw new Error('Chương trình không có bài học phù hợp');

  const lockedIds = await tx.$queryRawUnsafe<Array<{ id: bigint }>>(
    `SELECT DISTINCT lesson.id
     FROM lessons AS lesson
     INNER JOIN calendar AS calendar_row
       ON calendar_row.session_id = lesson.id
       OR (calendar_row.code = lesson.subject_code AND calendar_row.learn_number = lesson.learn_number)
     WHERE lesson.subject_code = ?
       AND calendar_row.start_time <= NOW()
       AND lesson.id IN (${lessons.map(() => '?').join(', ')})`,
    input.programCode,
    ...lessons.map((lesson) => lesson.id)
  );
  const locked = new Set(lockedIds.map((row) => String(row.id)));
  const eligible = lessons.filter((lesson) => !locked.has(String(lesson.id)));

  for (const lesson of eligible) {
    if (input.action === 'add') {
      await tx.$executeRawUnsafe(
        `INSERT INTO lesson_course_mapping (lesson_id, package_id, course_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
        lesson.id,
        input.packageId,
        input.courseId
      );
    } else {
      await tx.$executeRawUnsafe(
        `DELETE FROM lesson_course_mapping
         WHERE lesson_id = ? AND package_id = ? AND course_id = ?`,
        lesson.id,
        input.packageId,
        input.courseId
      );
    }
  }

  return { affected: eligible.length, skipped_past: locked.size, total: lessons.length };
});

export const findLessonsForExport = async (query: LessonExportQuery) => {
  if (query.ids?.length) {
    const placeholders = query.ids.map(() => '?').join(', ');
    return prisma.$queryRawUnsafe<any[]>(
      `SELECT ${LESSON_COLUMNS} FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`,
      ...query.ids
    );
  }

  const { whereSql, values } = buildWhere({ ...query, page: undefined, limit: undefined });
  const sortBy = query.sort_by ?? 'grade';
  const sortOrder = query.sort_order ?? 'asc';

  return prisma.$queryRawUnsafe<any[]>(
    `SELECT ${LESSON_COLUMNS} FROM lessons ${whereSql} ORDER BY ${sortBy} ${sortOrder.toUpperCase()}, subject_code ASC, learn_number ASC`,
    ...values
  );
};

export const findLessonById = async (id: bigint) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = ? AND status <> 0 LIMIT 1`,
    id
  );
  return rows[0] ?? null;
};

export const findLessonByIdentity = async (
  _grade: number | undefined,
  subjectCode: string,
  learnNumber: number,
  excludeId?: bigint
) => {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${LESSON_COLUMNS} FROM lessons WHERE subject_code = ? AND learn_number = ? AND status <> 0${excludeId ? ' AND id <> ?' : ''} LIMIT 1`,
    ...(excludeId ? [subjectCode, learnNumber, excludeId] : [subjectCode, learnNumber])
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

export const findLessonsByGroup = async (_grade: number | undefined, subjectCode: string) => {
  return prisma.$queryRawUnsafe<any[]>(
    `SELECT ${LESSON_COLUMNS} FROM lessons WHERE subject_code = ? AND status <> 0 ORDER BY learn_number ASC, id ASC`,
    subjectCode
  );
};

export const findPastScheduledLessonIds = async (
  ids: bigint[]
): Promise<Set<string>> => {
  if (!ids.length) return new Set();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    `SELECT DISTINCT lesson.id
     FROM lessons AS lesson
     INNER JOIN calendar AS calendar_row
       ON (calendar_row.session_id = lesson.id
         OR (calendar_row.code = lesson.subject_code
           AND calendar_row.learn_number = lesson.learn_number))
     WHERE lesson.id IN (${placeholders})
       AND calendar_row.start_time <= NOW()`,
    ...ids
  );
  return new Set(rows.map((row) => String(row.id)));
};

export const createLesson = async (payload: LessonPayload) => {
  return prisma.$transaction(async (tx) => {
    let learnNumber = payload.learn_number;
    if (learnNumber === undefined) {
      const nextRows = await tx.$queryRawUnsafe<any[]>(
        'SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE subject_code = ? AND status <> 0',
        payload.subject_code
      );
      learnNumber = Number(nextRows[0]?.next_learn_number ?? 1);
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO lessons (
        grade, system_type, subject_code, subject_name, learn_number,
        lesson_name, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      payload.grade,
      payload.system_type ?? 'topclass',
      payload.subject_code,
      payload.subject_name,
      learnNumber,
      payload.lesson_name,
      payload.status ?? 1
    );

    const rows = await tx.$queryRawUnsafe<any[]>(`SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = LAST_INSERT_ID() LIMIT 1`);
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
      `SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = ? AND status <> 0 LIMIT 1`,
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
      `SELECT ${LESSON_COLUMNS} FROM lessons WHERE id IN (${placeholders}) ORDER BY grade ASC, subject_code ASC, learn_number ASC`,
      ...ids
    );
  });
};

export const reorderLessonsInGroup = async (
  grade: number | undefined,
  subjectCode: string,
  orderedIds: bigint[],
  learnNumbers: number[]
) => {
  if (orderedIds.length !== learnNumbers.length) {
    throw new Error('Số lượng bài học và số thứ tự không khớp');
  }

  await prisma.$transaction(async (tx) => {
    const idPlaceholders = orderedIds.map(() => '?').join(', ');

    // Tạm chuyển toàn bộ số hiện tại sang âm trong một câu lệnh để tránh
    // vi phạm unique (grade, subject_code, learn_number) khi hoán đổi.
    await tx.$executeRawUnsafe(
      `UPDATE lessons
       SET learn_number = -learn_number, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id IN (${idPlaceholders})
         AND grade <=> ? AND subject_code = ? AND status <> 0`,
      ...orderedIds,
      grade,
      subjectCode
    );

    const cases = orderedIds.map(() => 'WHEN ? THEN ?').join(' ');
    const caseValues = orderedIds.flatMap((id, index) => [id, learnNumbers[index]]);
    await tx.$executeRawUnsafe(
      `UPDATE lessons
       SET learn_number = CASE id ${cases} ELSE learn_number END,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id IN (${idPlaceholders})
         AND grade <=> ? AND subject_code = ? AND status <> 0`,
      ...caseValues,
      ...orderedIds,
      grade,
      subjectCode
    );

    // Calendar giữ nguyên slot (learn_number, thời gian, giáo viên, trợ giảng),
    // chỉ nhận lại session_id và nội dung của lesson sau khi sắp xếp.
    await syncCalendarSlotsAfterLessonReorder(
      tx,
      grade,
      subjectCode,
      orderedIds,
      learnNumbers
    );
  }, {
    maxWait: 5_000,
    timeout: 30_000,
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
            'SELECT COALESCE(MAX(learn_number), 0) + 1 AS next_learn_number FROM lessons WHERE subject_code = ? AND status <> 0',
            row.subject_code
          );
          nextLearnNumberByGroup.set(groupKey, Number(maxRows[0]?.next_learn_number ?? 1));
        }
        learnNumber = nextLearnNumberByGroup.get(groupKey) as number;
        nextLearnNumberByGroup.set(groupKey, learnNumber + 1);
      }

      const existingRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT ${LESSON_COLUMNS} FROM lessons WHERE subject_code = ? AND learn_number = ? AND status <> 0 LIMIT 1`,
        row.subject_code,
        learnNumber
      );
      const existing = existingRows[0];

      if (existing) {
        if (mode === 'skip') {
          skipped += 1;
          continue;
        }

        const taughtRows = await tx.$queryRawUnsafe<Array<{ id: bigint }>>(
          `SELECT calendar_row.id
           FROM calendar AS calendar_row
           WHERE (calendar_row.session_id = ?
             OR (calendar_row.code = ? AND calendar_row.learn_number = ?))
             AND calendar_row.start_time <= NOW()
           LIMIT 1`,
          existing.id,
          row.subject_code,
          learnNumber
        );
        if (taughtRows.length) {
          throw new Error(`Dòng ${row.row_number}: không thể ghi đè bài học đã được dạy`);
        }

        if (row.status === 0) {
          await tx.$executeRawUnsafe(
            `UPDATE lessons SET
              lesson_name = ?, status = 0,
              learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
            row.lesson_name,
            existing.id
          );
        } else {
          await tx.$executeRawUnsafe(
            `UPDATE lessons SET
              system_type = ?, subject_name = ?, lesson_name = ?, status = ?,
              updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ?`,
            row.system_type ?? 'topclass',
            row.subject_name,
            row.lesson_name,
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
          grade, system_type, subject_code, subject_name, learn_number,
          lesson_name, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
        row.grade,
        row.system_type ?? 'topclass',
        row.subject_code,
        row.subject_name,
        learnNumber,
        row.lesson_name,
        row.status ?? 1
      );

      if (row.status === 0) {
        await tx.$executeRawUnsafe(
          'UPDATE lessons SET learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3) WHERE id = LAST_INSERT_ID()'
        );
      }

      created += 1;
    }
  }, {
    // Import Google Sheets có thể vài trăm dòng; timeout mặc định 5 giây làm
    // transaction bị Prisma đóng khi còn đang xử lý các dòng sau.
    maxWait: 10_000,
    timeout: 120_000,
  });

  return {
    total: rows.length,
    created,
    updated,
    skipped,
  };
};

export const importNewProgramLessons = async (rows: LessonImportRow[]): Promise<LessonImportResult> => {
  const usedNumbers = new Map<string, Set<number>>();
  const normalizedRows = rows.map((row) => {
    const key = row.subject_code;
    const used = usedNumbers.get(key) ?? new Set<number>();
    let learnNumber = row.learn_number;
    if (learnNumber === undefined) {
      learnNumber = 1;
      while (used.has(learnNumber)) learnNumber += 1;
    }
    if (row.status !== 0) used.add(learnNumber);
    usedNumbers.set(key, used);
    return { ...row, learn_number: learnNumber };
  });

  const placeholders = normalizedRows.map(() => '(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))').join(', ');
  const values = normalizedRows.flatMap((row) => [
    row.grade ?? null,
    row.system_type ?? 'topclass',
    row.subject_code,
    row.subject_name,
    row.learn_number,
    row.lesson_name,
    row.status ?? 1,
  ]);
  const programCodes = Array.from(new Set(normalizedRows.map((row) => row.subject_code)));

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO lessons (
        grade, system_type, subject_code, subject_name, learn_number,
        lesson_name, status, updated_at
      ) VALUES ${placeholders}`,
      ...values
    );
    if (normalizedRows.some((row) => row.status === 0)) {
      const codePlaceholders = programCodes.map(() => '?').join(', ');
      await tx.$executeRawUnsafe(
        `UPDATE lessons SET learn_number = -CAST(id AS SIGNED), updated_at = CURRENT_TIMESTAMP(3)
         WHERE status = 0 AND learn_number > 0 AND subject_code IN (${codePlaceholders})`,
        ...programCodes
      );
    }
  }, { maxWait: 10_000, timeout: 30_000 });

  return { total: rows.length, created: rows.length, updated: 0, skipped: 0 };
};

export const deleteLessonIfUnscheduled = async (id: bigint) => {
  return prisma.$transaction(async (tx) => {
    const lessons = await tx.$queryRawUnsafe<any[]>(
      `SELECT ${LESSON_COLUMNS} FROM lessons WHERE id = ? AND status <> 0 LIMIT 1 FOR UPDATE`,
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
