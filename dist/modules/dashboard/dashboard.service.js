"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardOverview = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const numberValue = (value) => Number(value ?? 0);
const getDashboardOverview = async () => {
    const [summaryRows, todayRows, weeklyRows, upcomingRows, recentChanges, teamsRows, hocmaiRows] = await Promise.all([
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        (SELECT COUNT(DISTINCT code) FROM calendar) AS courses,
        (SELECT COUNT(*) FROM lessons WHERE status = 1) AS lessons,
        (SELECT COUNT(*) FROM quiz_content WHERE quiz_status <> 'disable' OR quiz_status IS NULL) AS quizzes,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1) AS teaching_staff,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1 AND teacher_type = 1) AS teachers,
        (SELECT COUNT(*) FROM teacher_profiles WHERE status = 1 AND teacher_type = 2) AS assistants,
        (SELECT COUNT(DISTINCT userId) FROM user_roles) AS admin_users
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND start_time > NOW() THEN 1 ELSE 0 END) AS upcoming,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND start_time <= NOW() AND end_time >= NOW() THEN 1 ELSE 0 END) AS ongoing,
        SUM(CASE WHEN COALESCE(lesson_status, 0) <> 1 AND end_time < NOW() THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN lesson_status = 1 THEN 1 ELSE 0 END) AS cancelled
      FROM calendar
      WHERE DATE(start_time) = CURDATE()
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        DATE_FORMAT(days.day_value, '%Y-%m-%d') AS date,
        COUNT(calendar.id) AS total,
        SUM(CASE WHEN calendar.lesson_status = 1 THEN 1 ELSE 0 END) AS cancelled
      FROM (
        SELECT CURDATE() AS day_value
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 2 DAY)
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 4 DAY)
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 5 DAY)
        UNION ALL SELECT DATE_ADD(CURDATE(), INTERVAL 6 DAY)
      ) AS days
      LEFT JOIN calendar ON DATE(calendar.start_time) = days.day_value
      GROUP BY days.day_value
      ORDER BY days.day_value ASC
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        id, code, learn_number, subject, lesson_name, teacher, assistant_teacher,
        DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time,
        DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
        channel_name
      FROM calendar
      WHERE start_time >= NOW()
        AND COALESCE(lesson_status, 0) <> 1
      ORDER BY start_time ASC, id ASC
      LIMIT 8
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        id, action, code, learn_number, reason, actor_username,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM calendar_change_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 6
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        SUM(CASE WHEN status IN (0, 2, 3) THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 1 AND DATE(sent_at) = CURDATE() THEN 1 ELSE 0 END) AS sent_today
      FROM teams_notification_outbox
    `),
        prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT
        SUM(CASE WHEN COALESCE(status, 0) IN (0, 3) THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 1 AND DATE(synced_at) = CURDATE() THEN 1 ELSE 0 END) AS synced_today
      FROM hocmai_sync_queue
    `),
    ]);
    const summary = summaryRows[0];
    const today = todayRows[0];
    const teams = teamsRows[0];
    const hocmai = hocmaiRows[0];
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
exports.getDashboardOverview = getDashboardOverview;
