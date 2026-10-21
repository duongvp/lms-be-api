import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { getCalendarRoomReport as buildCalendarRoomReport } from '../src/modules/livestream/calendar-room-report.service';
import { buildCalendarRoomClassId } from '../src/modules/livestream/calendar-user-sync.service';

const getCalendarRoomReport = (...args: Parameters<typeof buildCalendarRoomReport>) => buildCalendarRoomReport(
  args[0], args[1], args[2], args[3], args[4] ?? (async () => new Map()),
);

const databaseUrl = process.env.TEST_CALENDAR_ROOM_REPORT_DATABASE_URL;
test('MySQL: session EVG, room lịch sử, HS học/tổng HS và biên giờ được tổng hợp đúng', { skip: !databaseUrl }, async (context) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, 'localhost');
  assert.match(url.pathname, /^\/calendar_room_report_test\w*$/);
  assert.match(url.searchParams.get('socket') || '', /^\/tmp\/lms-room-report-test\//);
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  context.after(() => client.$disconnect());
  const tables = [
    'CREATE TABLE IF NOT EXISTS evg_callbacks (id INT PRIMARY KEY AUTO_INCREMENT, live_session_id VARCHAR(100), channel_id VARCHAR(100), channel_name VARCHAR(255), start_on DATETIME, end_on DATETIME)',
    'CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY, username VARCHAR(100), student_hmid VARCHAR(50), code VARCHAR(50), learn_number INT, room_id INT, class_id VARCHAR(100))',
    'CREATE TABLE IF NOT EXISTS teacher_profiles (id INT PRIMARY KEY, username VARCHAR(100), student_hmid VARCHAR(50))',
    'CREATE TABLE IF NOT EXISTS classroom_assignment_history (id INT PRIMARY KEY, calendar_id INT, user_id INT, new_room_id INT, created_at DATETIME)',
    'CREATE TABLE IF NOT EXISTS users_logs (id INT PRIMARY KEY AUTO_INCREMENT, username VARCHAR(100), name VARCHAR(150), code VARCHAR(50), learn_number INT, created_at DATETIME, status INT)',
  ];
  for (const sql of tables) await client.$executeRawUnsafe(sql);
  const indexes = await client.$queryRawUnsafe<Array<{ Key_name: string }>>('SHOW INDEX FROM users_logs');
  if (!indexes.some((index) => index.Key_name === 'idx_logs_time')) {
    await client.$executeRawUnsafe('CREATE INDEX idx_logs_time ON users_logs(created_at)');
  }
  for (const table of ['evg_callbacks', 'users', 'teacher_profiles', 'classroom_assignment_history', 'users_logs']) await client.$executeRawUnsafe(`DELETE FROM ${table}`);
  const calendar = { id: 4836, code: 'feed-tsa-1-2027', learn_number: 1, teacher: 'assigned-teacher', assistant_teacher: ' assigned-assistant , another-assistant ', start_time: new Date('2026-10-14T21:00:00Z'), end_time: new Date('2026-10-14T22:00:00Z'), evg_stream: '123', channel_name: 'feed-channel' };
  const roomOne = buildCalendarRoomClassId(calendar.code, calendar.start_time, 1, 1);
  await client.$executeRaw`INSERT INTO users(id, username, student_hmid, code, learn_number, room_id, class_id) VALUES
    (1,'alice','101',${calendar.code},1,9,'old-session'),
    (2,'bob','102',${calendar.code},1,1,${roomOne}),
    (3,'carol','103',${calendar.code},1,3,'other-date'),
    (4,'teacher-a',NULL,${calendar.code},1,1,${roomOne}),
    (5,'alice','101','other-program',1,1,'other'),
    (6,'assistant-a','201',${calendar.code},1,1,${roomOne}),
    (7,'assistant-alias','201',${calendar.code},1,1,${roomOne}),
    (8,'assigned-assistant',NULL,${calendar.code},1,1,${roomOne}),
    (9,'assigned-teacher',NULL,${calendar.code},1,1,${roomOne})`;
  await client.$executeRaw`INSERT INTO teacher_profiles(id, username, student_hmid) VALUES(1,'teacher-a',NULL),(2,'assistant-a','201')`;
  await client.$executeRaw`INSERT INTO classroom_assignment_history(id,calendar_id,user_id,new_room_id,created_at) VALUES
    (1,4836,1,1,'2026-10-13 08:00:00'), (2,4836,1,2,'2026-10-14 08:00:00'),
    (3,9999,1,8,'2026-10-15 08:00:00')`;
  await client.$executeRaw`INSERT INTO evg_callbacks(live_session_id,channel_id,channel_name,start_on,end_on) VALUES
    ('a','123','feed-channel','2026-10-14 20:58:00',NULL),
    ('a','123','feed-channel',NULL,'2026-10-14 21:30:00'),
    ('b','123','feed-channel','2026-10-14 21:35:00','2026-10-14 22:00:00'),
    ('previous','123','feed-channel','2026-10-13 20:00:00',NULL),
    ('previous','123','feed-channel',NULL,'2026-10-13 21:00:00'),
    ('other','456','another-channel','2026-10-14 21:00:00','2026-10-14 22:00:00')`;
  await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status) VALUES
    ('alice','101 - Alice',${calendar.code},1,'2026-10-14 20:59:00',2),
    ('old-alice','101 - Alice',${calendar.code},1,'2026-10-14 21:10:00',2),
    ('bob','102 - Bob',${calendar.code},1,'2026-10-14 21:10:00',2),
    ('bob','102 - Bob',${calendar.code},1,'2026-10-14 21:30:00',2),
    ('bob','102 - Bob',${calendar.code},1,'2026-10-14 21:30:00',2),
    ('alice','101 - Alice',${calendar.code},1,'2026-10-14 21:40:00',2),
    ('bob','102 - Bob',${calendar.code},1,'2026-10-14 21:40:00',2),
    ('bob','102 - Bob',${calendar.code},1,'2026-10-14 21:50:00',2),
    ('teacher-a','Teacher',${calendar.code},1,'2026-10-14 21:10:00',2),
    ('teacher-a','Teacher',${calendar.code},1,'2026-10-14 21:20:00',2),
    ('carol','103 - Carol','other-program',1,'2026-10-14 21:10:00',2)`;
  const report = await getCalendarRoomReport({ calendar_source: 'feed', group_by: 'room' }, async () => ({ total: 1, data: [calendar] }), false, client);
  assert.equal(report.data.length, 2);
  const find = (roomId: number | null) => report.data.find((row) => row.room_id === roomId)!;
  assert.equal(find(2).attended_students, 1);
  assert.equal(find(2).added_students, 1);
  assert.equal(find(1).attended_students, 1);
  assert.equal(find(null), undefined, 'class_id của lịch khác không được đưa vào nhóm chưa chia room');
  assert.equal(find(1).actual_start_time, '2026-10-14T20:58:00.000Z');
  assert.equal(find(1).actual_end_time, '2026-10-14T22:00:00.000Z');
  assert.equal(report.data.reduce((sum, row) => sum + row.added_students, 0), 2, 'Roster chỉ tính một lần qua các phiên, loại nhân sự');
  const summary = await getCalendarRoomReport({ calendar_source: 'feed' }, async () => ({ total: 1, data: [calendar] }), false, client);
  assert.equal(summary.data.length, 1);
  assert.deepEqual(summary.data.map((row) => [row.attended_students, row.added_students]), [[2, 2]]);

  // Cùng chương trình nhưng roster và chuyên cần của buổi 2 khác buổi 1.
  const secondCalendar = { ...calendar, id: 6003, learn_number: 2, evg_stream: null, channel_name: null,
    start_time: new Date('2026-10-15T21:00:00Z'), end_time: new Date('2026-10-15T22:00:00Z') };
  const secondRoom = buildCalendarRoomClassId(calendar.code, secondCalendar.start_time, 2, 1);
  await client.$executeRaw`INSERT INTO users(id, username, student_hmid, code, learn_number, room_id, class_id) VALUES
    (10,'alice','101',${calendar.code},2,1,${secondRoom}),
    (11,'dave','104',${calendar.code},2,1,${secondRoom}),
    (12,'erin','105',${calendar.code},2,NULL,NULL),
    (13,'teacher-a',NULL,${calendar.code},2,1,${secondRoom}),
    (14,'assigned-assistant',NULL,${calendar.code},2,1,${secondRoom}),
    (15,'frank','106',${calendar.code},2,NULL,NULL)`;
  await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status) VALUES
    ('alice','101 - Alice',${calendar.code},2,'2026-10-15 21:05:00',2),
    ('alice','101 - Alice',${calendar.code},2,'2026-10-15 21:10:00',2),
    ('dave','104 - Dave',${calendar.code},2,'2026-10-15 21:05:00',2),
    ('dave','104 - Dave',${calendar.code},2,'2026-10-15 21:06:00',1),
    ('dave','104 - Dave',${calendar.code},2,'2026-10-15 21:11:00',2),
    ('alice','101 - Alice',${calendar.code},1,'2026-10-14 21:45:00',2)`;
  const both = async () => ({ total: 2, data: [calendar, secondCalendar] });
  const bothReport = await getCalendarRoomReport({ group_by: 'room' }, both, false, client);
  assert.ok(bothReport.data.filter((row) => row.calendar_id === calendar.id).every((row) => row.lesson_attended_students === 2 && row.lesson_added_students === 3), 'Alice học cả hai phiên chỉ được tính một lần trong tổng buổi 1');
  assert.ok(bothReport.data.filter((row) => row.calendar_id === secondCalendar.id).every((row) => row.lesson_attended_students === 1 && row.lesson_added_students === 4), 'Buổi 2 dùng roster riêng, không tính giáo viên/trợ giảng hoặc ghép chuỗi khi join lại');
  const roomFiltered = await getCalendarRoomReport({ group_by: 'room', room_id: 1 }, both, true, client);
  assert.ok(roomFiltered.data.every((row) => row.lesson_added_students === (row.calendar_id === calendar.id ? 3 : 4)), 'Lọc room không làm mất HS ở room khác/chưa chia room trong tổng buổi');
  assert.equal(roomFiltered.data.find((row) => row.calendar_id === secondCalendar.id)!.added_students, 2);

  // Lịch học lại cùng số bài nhưng ngày khác: phải dựa vào class_id,
  // không chỉ code + learn_number. Class_id sai hậu tố cũng không được nhận.
  const repeatedCalendar = { ...calendar, id: 6004, evg_stream: null, channel_name: null,
    start_time: new Date('2026-10-15T21:00:00Z'), end_time: new Date('2026-10-15T22:00:00Z') };
  const repeatedClass = buildCalendarRoomClassId(calendar.code, repeatedCalendar.start_time, 1, 12);
  await client.$executeRaw`INSERT INTO users(id, username, student_hmid, code, learn_number, room_id, class_id) VALUES
    (16,'dora','116',${calendar.code},1,12,${repeatedClass}),
    (17,'bad-class','117',${calendar.code},1,12,${repeatedClass + 'junk'})`;
  await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status) VALUES
    ('dora','116 - Dora',${calendar.code},1,'2026-10-14 21:05:00',2),
    ('dora','116 - Dora',${calendar.code},1,'2026-10-14 21:10:00',2),
    ('dora','116 - Dora',${calendar.code},1,'2026-10-15 21:05:00',2),
    ('dora','116 - Dora',${calendar.code},1,'2026-10-15 21:10:00',2),
    ('bad-class','117 - Bad Class',${calendar.code},1,'2026-10-15 21:05:00',2),
    ('bad-class','117 - Bad Class',${calendar.code},1,'2026-10-15 21:10:00',2)`;
  const repeated = await getCalendarRoomReport({ group_by: 'room' }, async () => ({ total: 2, data: [calendar, repeatedCalendar] }), false, client);
  const repeatedRows = repeated.data.filter((row) => row.calendar_id === repeatedCalendar.id);
  assert.equal(repeatedRows.length, 1);
  assert.deepEqual([repeatedRows[0].room_id, repeatedRows[0].attended_students, repeatedRows[0].added_students], [12, 1, 1]);
  assert.deepEqual([repeatedRows[0].lesson_attended_students, repeatedRows[0].lesson_added_students], [4, 5]);
  assert.ok(repeated.data.filter((row) => row.calendar_id === calendar.id).every((row) => row.lesson_added_students === 5));
  const selectedRepeated = await getCalendarRoomReport({ calendar_ids: String(repeatedCalendar.id), start_time: '2026-10-15' }, async (query) => {
    if (query.keyword === calendar.code) return { total: 2, data: [calendar, repeatedCalendar] };
    return { total: 1, data: [repeatedCalendar] };
  }, false, client);
  assert.equal(selectedRepeated.data.length, 1);
  assert.deepEqual([selectedRepeated.data[0].attended_students, selectedRepeated.data[0].lesson_attended_students, selectedRepeated.data[0].lesson_added_students], [1, 4, 5], 'Chỉ hiển thị lịch 2 nhưng tổng phải hợp nhất cả lịch 1 ngoài ngày/ID đang lọc, không đếm Dora hai lần');


  const scenarios: Array<{ label: string; events: Array<[string, number, string?]>; attended: number }> = [
    { label: 'join, hai heartbeat liên tiếp đủ 10 phút', events: [['21:00', 1], ['21:05', 2], ['21:10', 2]], attended: 1 },
    { label: 'ra vào lại ngắt hai heartbeat', events: [['21:00', 1], ['21:05', 2], ['21:06', 1], ['21:11', 2]], attended: 0 },
    { label: 'đủ chuỗi mới sau khi join lại', events: [['21:00', 1], ['21:05', 2], ['21:06', 1], ['21:11', 2], ['21:16', 2]], attended: 1 },
    { label: 'không đếm đôi một log khớp cả username và HMID', events: [['21:05', 2]], attended: 0 },
    { label: 'đổi username vẫn ghép được chuỗi qua HMID', events: [['21:00', 1], ['21:05', 2], ['21:10', 2, 'old-alice']], attended: 1 },
    { label: 'join lại qua username khác cũng ngắt chuỗi', events: [['21:00', 1], ['21:05', 2], ['21:06', 1, 'old-alice'], ['21:11', 2]], attended: 0 },
    { label: 'status khác 2 ngắt chuỗi', events: [['21:00', 1], ['21:05', 2], ['21:06', 0], ['21:11', 2]], attended: 0 },
    { label: 'xếp theo thời gian dù log chèn sai thứ tự', events: [['21:11', 2], ['21:06', 1], ['21:05', 2]], attended: 0 },
    { label: 'trùng thời gian thì thứ tự ID quyết định join ngắt chuỗi', events: [['21:05', 2], ['21:05', 1], ['21:05', 2]], attended: 0 },
    { label: 'không ghép heartbeat qua hai phiên học', events: [['21:25', 2], ['21:40', 2]], attended: 0 },
    { label: 'log trước phiên không được ghép vào', events: [['20:57', 2], ['21:05', 2]], attended: 0 },
    { label: 'log tại giờ kết thúc không được ghép vào', events: [['21:25', 2], ['21:30', 2]], attended: 0 },
    { label: 'không có log', events: [], attended: 0 },
  ];
  for (const scenario of scenarios) {
    await client.$executeRaw`DELETE FROM users_logs`;
    for (const [time, status, username = 'alice'] of scenario.events) {
      const createdAt = new Date(`2026-10-14T${time}:00Z`);
      await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status)
        VALUES (${username},'101 - Alice',${calendar.code},1,${createdAt},${status})`;
    }
    const result = await getCalendarRoomReport({}, async () => ({ total: 1, data: [calendar] }), false, client);
    assert.equal(result.data[0].attended_students, scenario.attended, scenario.label);
    assert.ok(result.data.every((row) => row.added_students === 2), `${scenario.label}: tổng HS theo class_id không thay đổi`);
    if (scenario.label === 'không ghép heartbeat qua hai phiên học') {
      assert.equal(result.data[0].attended_students, 0, scenario.label);
    }
  }

  // Cùng dải giờ chỉ đọc chung, không dùng log ngoài cửa sổ của từng buổi;
  // chuỗi liên tiếp phải được giữ khi qua ranh giới hai lần đọc (21:00).
  await client.$executeRaw`DELETE FROM users_logs`;
  await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status) VALUES
    ('alice','101 - Alice',${calendar.code},1,'2026-10-14 20:55:00',2),
    ('alice','101 - Alice',${calendar.code},1,'2026-10-14 21:00:00',2),
    ('alice','101 - Alice','other-program',1,'2026-10-14 20:55:00',2),
    ('alice','101 - Alice','other-program',1,'2026-10-14 21:05:00',2)`;
  const shared = [
    { ...calendar, evg_stream: null, channel_name: null, start_time: new Date('2026-10-14T20:00:00Z'), end_time: new Date('2026-10-14T23:00:00Z') },
    { ...calendar, id: 6001, code: 'other-program', evg_stream: null, channel_name: null },
    { ...calendar, id: 6002, evg_stream: null, channel_name: null },
  ];
  let logReads = 0;
  const sharedClient = { $queryRaw: async (query: any) => {
    if (query.sql.includes('FROM users_logs')) logReads++;
    return client.$queryRaw(query);
  } } as any;
  const sharedReport = await getCalendarRoomReport({}, async () => ({ total: 3, data: shared }), false, sharedClient);
  assert.equal(logReads, 3, 'mỗi dải giờ chỉ đọc một lần chung cho các buổi');
  assert.deepEqual(sharedReport.data.map((row) => [row.attended_students, row.added_students]), [[1, 2], [0, 0], [0, 1]]);
  await client.$executeRaw`INSERT INTO users_logs(username,name,code,learn_number,created_at,status)
    VALUES ('alice','101 - Alice',${calendar.code},1,'2026-10-14 20:59:00',1)`;
  const resetReport = await getCalendarRoomReport({}, async () => ({ total: 3, data: shared }), false, client);
  assert.ok(resetReport.data.every((row) => row.attended_students === 0), 'join lại qua ranh giới lần đọc phải ngắt chuỗi');

  if (process.env.CALENDAR_ROOM_REPORT_BENCHMARK === '1') {
    await client.$executeRaw`DELETE FROM users_logs`;
    await client.$executeRaw`DELETE FROM users`;
    await client.$executeRaw`DELETE FROM teacher_profiles`;
    await client.$executeRaw`DELETE FROM classroom_assignment_history`;
    const loadCalendars = Array.from({ length: 20 }, (_, index) => ({
      id: 6000 + index, code: `report-load-${index}-2027`, learn_number: 1,
      start_time: new Date(Date.UTC(2026, 8, 1, 18)), end_time: new Date(Date.UTC(2026, 8, 1, 19)),
    }));
    for (const entry of loadCalendars) {
      await client.$executeRaw`
        INSERT INTO users(id, username, student_hmid, code, learn_number, room_id)
        WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 1000)
        SELECT ${entry.id * 1000}+n, CONCAT('student-',n), CAST(n AS CHAR), ${entry.code}, ${entry.learn_number}, CEIL(n/20) FROM seq
      `;
      await client.$executeRaw`
        INSERT INTO users_logs(username,name,code,learn_number,created_at,status)
        WITH RECURSIVE ticks(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM ticks WHERE n < 11)
        SELECT student.username, CONCAT(student.student_hmid,' - Student'), student.code, student.learn_number,
               TIMESTAMPADD(MINUTE, ticks.n*5, ${entry.start_time}), CASE WHEN ticks.n = 0 THEN 1 ELSE 2 END
        FROM users student CROSS JOIN ticks WHERE student.code = ${entry.code} AND student.learn_number = ${entry.learn_number}
      `;
    }
    // Lưu lượng cùng khung giờ của chương trình khác, để index chỉ theo giờ
    // phải đọc nhiều dòng ngoài chương trình cần báo cáo như dữ liệu thực.
    await client.$executeRaw`
      INSERT INTO users_logs(username,name,code,learn_number,created_at,status)
      SELECT username,name,'unrelated-program',learn_number,created_at,status FROM users_logs
    `;
    const started = performance.now();
    const loadReport = await getCalendarRoomReport({}, async () => ({ total: 20, data: loadCalendars }), false, client);
    context.diagnostic(`Không thêm index: 20 buổi cùng giờ, 20.000 enrollments, 480.000 logs: ${Math.round(performance.now() - started)} ms`);
    assert.equal(loadReport.data.length, 20);
    assert.ok(loadReport.data.every((row) => row.added_students === 1000 && row.attended_students === 1000));

  }
});
