import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';

type CountRow = { total: bigint | number };

type SummaryRow = {
  courses: bigint | number;
  lessons: bigint | number;
  quizzes: bigint | number;
  teaching_staff: bigint | number;
  teachers: bigint | number;
  assistants: bigint | number;
  admin_users: bigint | number;
  outlines_with_quiz: bigint | number;
  outlines_without_quiz: bigint | number;
};

type TodayRow = {
  total: bigint | number;
  upcoming: bigint | number;
  ongoing: bigint | number;
  completed: bigint | number;
  cancelled: bigint | number;
};

type OutlineQuizRow = {
  id: bigint | number;
  program_code: string;
  subject_name: string | null;
  learn_number: number;
  lesson_name: string | null;
  has_quiz: bigint | number;
};

const numberValue = (value: bigint | number | null | undefined) => Number(value ?? 0);

export type DashboardTimeFilter = { from?: Date; to?: Date };

export const getDashboardOverview = async (
  filter: DashboardTimeFilter = {},
  allowedPrograms: string[] | null = null
) => {
  const from = filter.from ?? new Date();
  const to = filter.to ?? new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new Error('Khoảng thời gian không hợp lệ');
  }
  const calendarRange = Prisma.sql`start_time >= ${from} AND start_time <= ${to}`;
  const lessonRange = Prisma.sql`updated_at >= ${from} AND updated_at <= ${to}`;
  const scoped = (column: string) => {
    if (allowedPrograms === null) return Prisma.empty;
    if (!allowedPrograms.length) return Prisma.sql` AND 1 = 0`;
    return Prisma.sql` AND ${Prisma.raw(column)} IN (${Prisma.join(allowedPrograms)})`;
  };
  const calendarScoped = (alias: string) => {
    if (allowedPrograms === null) return Prisma.empty;
    if (!allowedPrograms.length) return Prisma.sql` AND 1 = 0`;
    return Prisma.sql` AND (
      EXISTS (
        SELECT 1 FROM lessons AS scope_lesson
        WHERE scope_lesson.id = ${Prisma.raw(`${alias}.session_id`)}
          AND scope_lesson.status <> 0
          AND scope_lesson.subject_code IN (${Prisma.join(allowedPrograms)})
      )
      OR (
        ${Prisma.raw(`${alias}.session_id`)} IS NULL
        AND ${Prisma.raw(`${alias}.code`)} IN (${Prisma.join(allowedPrograms)})
      )
    )`;
  };

  const [summaryRows, todayRows, weeklyRows, upcomingRows, recentChanges, teamsRows, hocmaiRows, outlineQuizRows] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(DISTINCT calendar_summary.code) FROM calendar AS calendar_summary
          WHERE ${calendarRange}${calendarScoped('calendar_summary')}) AS courses,
        (SELECT COUNT(*) FROM lessons WHERE status = 1 AND ${lessonRange}${scoped('subject_code')}) AS lessons,
        (SELECT COUNT(*) FROM quiz_content WHERE (quiz_status <> 'disable' OR quiz_status IS NULL) AND updated_at >= ${from} AND updated_at <= ${to}${scoped('code')}) AS quizzes,
        (SELECT COUNT(*) FROM calendar AS calendar_outline
          LEFT JOIN lessons AS session_lesson ON session_lesson.id = calendar_outline.session_id
          WHERE ${calendarRange}${calendarScoped('calendar_outline')}
            AND EXISTS (
              SELECT 1 FROM quiz_content AS quiz
              WHERE quiz.code = COALESCE(NULLIF(TRIM(calendar_outline.code), ''), session_lesson.subject_code)
                AND quiz.learn_number = calendar_outline.learn_number
                AND (quiz.quiz_status <> 'disable' OR quiz.quiz_status IS NULL)
            )) AS outlines_with_quiz,
        (SELECT COUNT(*) FROM calendar AS calendar_outline
          LEFT JOIN lessons AS session_lesson ON session_lesson.id = calendar_outline.session_id
          WHERE ${calendarRange}${calendarScoped('calendar_outline')}
            AND NOT EXISTS (
              SELECT 1 FROM quiz_content AS quiz
              WHERE quiz.code = COALESCE(NULLIF(TRIM(calendar_outline.code), ''), session_lesson.subject_code)
                AND quiz.learn_number = calendar_outline.learn_number
                AND (quiz.quiz_status <> 'disable' OR quiz.quiz_status IS NULL)
            )) AS outlines_without_quiz,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1) AS teaching_staff,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1 AND can_view_stream_key = 1) AS teachers,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1 AND can_view_stream_key = 0) AS assistants,
        (SELECT COUNT(DISTINCT userId) FROM user_roles) AS admin_users
    `),
    prisma.$queryRaw<TodayRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND start_time > NOW() THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND start_time <= NOW() AND end_time >= NOW() THEN 1 ELSE 0 END) AS ongoing,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND end_time < NOW() THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN lesson_status = 1 THEN 1 ELSE 0 END) AS cancelled
      FROM calendar AS calendar_today
      WHERE ${calendarRange}${calendarScoped('calendar_today')}
    `),
    prisma.$queryRaw<Array<{ date: string; total: bigint; cancelled: bigint }>>(Prisma.sql`
      SELECT DATE_FORMAT(start_time, '%Y-%m-%d') AS date,
        COUNT(*) AS total,
        SUM(CASE WHEN lesson_status = 1 THEN 1 ELSE 0 END) AS cancelled
      FROM calendar AS calendar_weekly
      WHERE ${calendarRange}${calendarScoped('calendar_weekly')}
      GROUP BY DATE_FORMAT(start_time, '%Y-%m-%d')
      ORDER BY DATE_FORMAT(start_time, '%Y-%m-%d') ASC
    `),
    prisma.$queryRaw<Array<{
      id: number;
      code: string;
      learn_number: number;
      subject: string | null;
      lesson_name: string | null;
      teacher: string | null;
      assistant_teacher: string | null;
      start_time: string;
      end_time: string;
      channel_name: string | null;
    }>>(Prisma.sql`
      SELECT
        id, code, learn_number, subject, lesson_name, teacher, assistant_teacher,
        DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time,
        DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
        channel_name
      FROM calendar AS calendar_upcoming
      WHERE ${calendarRange}${calendarScoped('calendar_upcoming')}
        AND COALESCE(lesson_status, 0) <> 1
      ORDER BY start_time ASC, id ASC
      LIMIT 8
    `),
    prisma.$queryRaw<Array<{
      id: bigint;
      action: string;
      code: string;
      learn_number: number;
      reason: string;
      actor_username: string;
      created_at: string;
    }>>(Prisma.sql`
      SELECT
        id, action, code, learn_number, reason, actor_username,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM calendar_change_logs
      WHERE 1 = 1${allowedPrograms === null ? Prisma.empty : !allowedPrograms.length
        ? Prisma.sql` AND 1 = 0`
        : Prisma.sql` AND EXISTS (
            SELECT 1 FROM lessons AS change_lesson
            WHERE change_lesson.subject_code = calendar_change_logs.code
              AND change_lesson.learn_number = calendar_change_logs.learn_number
              AND change_lesson.status <> 0
              AND change_lesson.subject_code IN (${Prisma.join(allowedPrograms)})
          )`}
      ORDER BY created_at DESC, id DESC
      LIMIT 6
    `),
    prisma.$queryRaw<Array<{ pending: bigint; failed: bigint; sent_today: bigint }>>(Prisma.sql`
      SELECT
        SUM(CASE WHEN status IN (0, 2, 3) THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 1 AND DATE(sent_at) = CURDATE() THEN 1 ELSE 0 END) AS sent_today
      FROM teams_notification_outbox
    `),
    prisma.$queryRaw<Array<{ pending: bigint; failed: bigint; synced_today: bigint }>>(Prisma.sql`
      SELECT
        SUM(CASE WHEN COALESCE(status, 0) IN (0, 3) THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 1 AND DATE(synced_at) = CURDATE() THEN 1 ELSE 0 END) AS synced_today
      FROM hocmai_sync_queue
    `),
    prisma.$queryRaw<OutlineQuizRow[]>(Prisma.sql`
      SELECT calendar_outline.id,
             COALESCE(NULLIF(TRIM(calendar_outline.code), ''), session_lesson.subject_code) AS program_code,
             COALESCE(NULLIF(TRIM(session_lesson.subject_name), ''), NULLIF(TRIM(calendar_outline.subject), '')) AS subject_name,
             calendar_outline.learn_number,
             COALESCE(NULLIF(TRIM(calendar_outline.lesson_name), ''), NULLIF(TRIM(session_lesson.lesson_name), '')) AS lesson_name,
             CASE WHEN EXISTS (
               SELECT 1 FROM quiz_content AS quiz
               WHERE quiz.code = COALESCE(NULLIF(TRIM(calendar_outline.code), ''), session_lesson.subject_code)
                 AND quiz.learn_number = calendar_outline.learn_number
                 AND (quiz.quiz_status <> 'disable' OR quiz.quiz_status IS NULL)
             ) THEN 1 ELSE 0 END AS has_quiz
      FROM calendar AS calendar_outline
      LEFT JOIN lessons AS session_lesson ON session_lesson.id = calendar_outline.session_id
      WHERE ${calendarRange}${calendarScoped('calendar_outline')}
      ORDER BY calendar_outline.code ASC, calendar_outline.learn_number ASC, calendar_outline.start_time ASC, calendar_outline.id ASC
    `),
  ]);

  const summary = summaryRows[0];
  const today = todayRows[0];
  const teams = teamsRows[0];
  const hocmai = hocmaiRows[0];
  const outlineQuizDetails = outlineQuizRows.map((row) => ({
    id: String(row.id),
    programCode: row.program_code,
    subjectName: row.subject_name,
    learnNumber: Number(row.learn_number),
    lessonName: row.lesson_name || `Bài ${Number(row.learn_number)}`,
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      courses: numberValue(summary?.courses),
      lessons: numberValue(summary?.lessons),
      quizzes: numberValue(summary?.quizzes),
      teachingStaff: numberValue(summary?.teaching_staff),
      teachers: numberValue(summary?.teachers),
      assistants: numberValue(summary?.assistants),
      adminUsers: numberValue(summary?.admin_users),
      outlinesWithQuiz: numberValue(summary?.outlines_with_quiz),
      outlinesWithoutQuiz: numberValue(summary?.outlines_without_quiz),
    },
    outlineQuizDetails: {
      withQuiz: outlineQuizRows
        .map((row, index) => ({ row, detail: outlineQuizDetails[index] }))
        .filter(({ row }) => numberValue(row.has_quiz) > 0)
        .map(({ detail }) => detail),
      withoutQuiz: outlineQuizRows
        .map((row, index) => ({ row, detail: outlineQuizDetails[index] }))
        .filter(({ row }) => numberValue(row.has_quiz) === 0)
        .map(({ detail }) => detail),
    },
    today: {
      total: numberValue(today?.total),
      upcoming: numberValue(today?.upcoming),
      ongoing: numberValue(today?.ongoing),
      completed: numberValue(today?.completed),
      cancelled: numberValue(today?.cancelled),
    },
    nextSevenDays: weeklyRows.map((row) => ({
      date: row.date,
      total: numberValue(row.total),
      cancelled: numberValue(row.cancelled),
    })),
    upcomingSchedules: upcomingRows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      learnNumber: Number(row.learn_number),
      subject: row.subject,
      lessonName: row.lesson_name,
      teacher: row.teacher,
      assistantTeacher: row.assistant_teacher,
      startTime: row.start_time,
      endTime: row.end_time,
      room: row.channel_name,
    })),
    recentChanges: recentChanges.map((row) => ({
      id: row.id.toString(),
      action: row.action,
      code: row.code,
      learnNumber: row.learn_number,
      reason: row.reason,
      actorUsername: row.actor_username,
      createdAt: row.created_at,
    })),
    integrations: {
      teams: {
        pending: numberValue(teams?.pending),
        failed: numberValue(teams?.failed),
        sentToday: numberValue(teams?.sent_today),
      },
      hocmai: {
        pending: numberValue(hocmai?.pending),
        failed: numberValue(hocmai?.failed),
        syncedToday: numberValue(hocmai?.synced_today),
      },
    },
  };
};
