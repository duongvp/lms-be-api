import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  buildReportWindows, assembleRoomReport, assembleProgramReport, getCalendarRoomReport as buildCalendarRoomReport, buildCalendarRoomReportWorkbook, countConsecutiveAttendance, groupReportWindows, getCalendarRoomReportSchedules, getCalendarRoomReportLiveTimes,
} from '../src/modules/livestream/calendar-room-report.service';

const getCalendarRoomReport = (...args: Parameters<typeof buildCalendarRoomReport>) => buildCalendarRoomReport(
  args[0], args[1], args[2], args[3], args[4] ?? (async () => new Map()),
);

const at = (time: string) => new Date(`2026-10-14T${time}:00Z`);
const calendar = { id: 4836, code: 'feed-tsa-1-2027', learn_number: 1, lesson_name: 'Chia sẻ cách ôn luyện', teacher: 'Giáo viên A', system_type: 'topuni', start_time: at('21:00'), end_time: at('22:00'), evg_stream: '123', channel_name: 'feed-channel' };
const now = new Date('2026-10-19T10:00:00Z');

const mockReportClient = (counts: Array<{ room_id: number | null; added_students: number; attended_students: number }>, queries: any[] = [], staff: Array<{ username: string; student_hmid: string | null }> = []) => {
  const enrollments: any[] = [];
  const activities: any[] = [];
  for (const count of counts) {
    for (let index = 0; index < count.added_students; index++) {
      const id = enrollments.length + 1;
      const student = { window_id: '4836:unrecorded', user_id: id, belongs_to_calendar: true, username: `student-${id}`, student_hmid: String(id), room_id: count.room_id };
      enrollments.push(student);
      if (index < count.attended_students) {
        for (const time of ['21:05', '21:10']) activities.push({ ...student, activity_id: activities.length + 1, created_at: at(time), status: 2, name: `${id} - Student`, code: calendar.code, learn_number: calendar.learn_number });
      }
    }
  }
  let calls = 0;
  return { $queryRaw: async (sql: any) => {
    queries.push(sql);
    return [[], enrollments, staff, activities][calls++];
  } } as any;
};

test('loại nhân sự bằng username và HMID đã chuẩn hóa khi không còn JOIN teacher_profiles', async () => {
  const client = mockReportClient([{ room_id: 1, added_students: 5, attended_students: 4 }], [], [
    { username: ' STUDENT-1 ', student_hmid: null },
    { username: 'staff-alias', student_hmid: ' 2 ' },
  ]);
  const report = await getCalendarRoomReport({}, async () => ({ total: 1, data: [calendar] }), false, client);
  assert.equal(report.data[0].added_students, 3);
  assert.equal(report.data[0].attended_students, 2);
  assert.equal(report.data[0].lesson_added_students, 3);
  assert.equal(report.data[0].lesson_attended_students, 2);
});

test('chuỗi chuyên cần liên tiếp, join lại ngắt chuỗi và log khớp kép không bị đếm đôi', () => {
  const roster = [{ window_id: 'a', user_id: 1, username: 'alice', student_hmid: '101', room_id: 1 }];
  for (const [statuses, expected] of [
    [[1, 2, 2], 1], [[1, 2, 1, 2], 0], [[1, 2, 1, 2, 2], 1], [[2], 0], [[2, 0, 2], 0], [[], 0],
  ] as Array<[number[], number]>) {
    const activities = statuses.map((status, index) => ({ window_id: 'a', activity_id: index + 1,
      username: index === 2 ? 'old-alice' : 'alice', name: '101 - Alice', status,
      created_at: new Date(at('21:00').getTime() + index * 300_000) }));
    const result = countConsecutiveAttendance(roster, activities.reverse());
    assert.equal(result[0].attended_students, expected, statuses.join(' -> '));
    assert.equal(result[0].added_students, 1);
  }
});

test('gộp webhook mở/đóng session, không đánh đồng giờ dự kiến và giờ thực tế', () => {
  const windows = buildReportWindows([calendar], [
    { calendar_id: 4836, live_session_id: 'session-a', start_on: at('20:58'), end_on: null },
    { calendar_id: 4836, live_session_id: 'session-a', start_on: null, end_on: at('22:05') },
    { calendar_id: 4836, live_session_id: 'session-a', start_on: at('20:58'), end_on: at('22:05') },
  ], now);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].actual_start_time?.toISOString(), at('20:58').toISOString());
  assert.equal(windows[0].actual_end_time?.toISOString(), at('22:05').toISOString());
  assert.equal(windows[0].from.toISOString(), at('20:58').toISOString());
  assert.equal(windows[0].to.toISOString(), at('22:05').toISOString());
});

test('gộp cửa sổ trùng giờ để đọc chung, giữ riêng khoảng thời gian không giao nhau', () => {
  const windows = buildReportWindows([
    calendar,
    { ...calendar, id: 2, start_time: at('21:30'), end_time: at('22:30') },
    { ...calendar, id: 3, start_time: at('23:00'), end_time: at('23:30') },
    { ...calendar, id: 4, start_time: at('23:30'), end_time: at('23:00') },
  ], [], now);
  const groups = groupReportWindows([...windows].reverse());
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].windows.map((window) => window.calendar.id), [4836, 2]);
  assert.equal(groups[0].from.toISOString(), at('21:00').toISOString());
  assert.equal(groups[0].to.toISOString(), at('22:30').toISOString());
  assert.equal(groups[1].windows[0].calendar.id, 3);
});

test('không có webhook vẫn báo cáo được HS/room nhưng không bịa giờ vào/tan lớp', () => {
  const windows = buildReportWindows([calendar], [], now);
  assert.equal(windows[0].actual_start_time, null);
  assert.equal(windows[0].actual_end_time, null);
  const rows = assembleRoomReport(windows, [{ window_id: windows[0].key, room_id: 2, added_students: 100n, attended_students: 63n }]);
  assert.equal(rows[0].attended_students, 63);
  assert.equal(rows[0].added_students, 100);
  assert.equal(rows[0].calendar_source, 'feed');
  assert.equal(rows[0].actual_start_time, null);
  assert.ok(rows[0].class_id?.startsWith(calendar.code));
  assert.ok(rows[0].class_id?.endsWith('2'));
});

test('webhook thiếu Session ID không ghép nhầm hai phiên hoặc đoán giờ đóng', () => {
  const windows = buildReportWindows([calendar], [
    { calendar_id: 4836, live_session_id: null, start_on: at('21:00'), end_on: at('21:20') },
    { calendar_id: 4836, live_session_id: null, start_on: at('21:30'), end_on: at('21:50') },
    { calendar_id: 4836, live_session_id: null, start_on: at('21:55'), end_on: null },
  ], now);
  assert.equal(windows.length, 2);
  assert.notEqual(windows[0].key, windows[1].key);
});

test('giữ riêng các session và room, có dòng chưa chia khi chưa có học sinh/phòng', () => {
  const windows = buildReportWindows([calendar], [
    { calendar_id: 4836, live_session_id: 'a', start_on: at('21:00'), end_on: at('21:30') },
    { calendar_id: 4836, live_session_id: 'b', start_on: at('21:35'), end_on: at('22:00') },
  ], now);
  const rows = assembleRoomReport(windows, [
    { window_id: windows[0].key, room_id: 1, added_students: 20, attended_students: 10 },
    { window_id: windows[0].key, room_id: 2, added_students: 15, attended_students: 5 },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].session_id, 'b');
  assert.equal(rows[2].room_id, null);
  assert.equal(rows[2].added_students, 0);
  assert.equal(new Set(rows.map((row) => row.key)).size, 3);
});

test('room tăng dần theo số trong từng buổi, chưa chia ở cuối; Excel giữ cùng thứ tự', () => {
  const windows = buildReportWindows([calendar, { ...calendar, id: 5000, code: 'nguvan-9-2027' }], [], now);
  const counts = [
    { window_id: windows[1].key, room_id: 3, added_students: 20, attended_students: 5 },
    ...[12, null, 2, 9, 1].map((room_id) => ({ window_id: windows[0].key, room_id, added_students: 20, attended_students: 5 })),
    { window_id: windows[1].key, room_id: 1, added_students: 20, attended_students: 5 },
  ];
  const rows = assembleRoomReport(windows, counts);
  assert.deepEqual(rows.map((row) => [row.calendar_id, row.room_id]), [
    [4836, 1], [4836, 2], [4836, 9], [4836, 12], [4836, null], [5000, 1], [5000, 3],
  ]);
  const workbookRows = rows.map((row) => ({
    ...row,
    lesson_attended_students: rows.filter((other) => other.calendar_id === row.calendar_id).reduce((sum, other) => sum + other.attended_students, 0),
    lesson_added_students: rows.filter((other) => other.calendar_id === row.calendar_id).reduce((sum, other) => sum + other.added_students, 0),
  }));
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(workbookRows, 'room'), { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc']);
  assert.deepEqual(output.map((row) => row['Room']), [1, 2, 9, 12, 'Chưa chia', 1, 3]);
});

test('gộp tất cả room và chưa chia room theo chương trình/buổi, không cộng chéo session hoặc chương trình', () => {
  const other = { ...calendar, id: 5000, code: 'nguvan-9-2027' };
  const windows = buildReportWindows([calendar, other], [
    { calendar_id: calendar.id, live_session_id: 'a', start_on: at('21:00'), end_on: at('21:30') },
    { calendar_id: calendar.id, live_session_id: 'b', start_on: at('21:35'), end_on: at('22:00') },
  ], now);
  const rows = assembleProgramReport(windows, [
    { window_id: windows[0].key, room_id: 1, added_students: 20n, attended_students: 10n },
    { window_id: windows[0].key, room_id: 2, added_students: 15, attended_students: 5 },
    { window_id: windows[0].key, room_id: null, added_students: 3, attended_students: 1 },
    { window_id: windows[1].key, room_id: 1, added_students: 20, attended_students: 2 },
    { window_id: windows[1].key, room_id: 2, added_students: 15, attended_students: 3 },
    { window_id: windows[1].key, room_id: null, added_students: 3, attended_students: 0 },
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => [row.attended_students, row.added_students]), [[16, 38], [5, 38], [0, 0]]);
  assert.equal(rows[2].code, 'nguvan-9-2027');
  assert.ok(rows.every((row) => row.room_id === null && row.class_id === null));
  assert.equal(new Set(rows.map((row) => row.key)).size, 3);
});

test('API mặc định trả tổng chương trình; Excel dùng cùng số liệu tổng', async () => {
  const client = mockReportClient([
    { room_id: 1, added_students: 20, attended_students: 10 },
    { room_id: 2, added_students: 15, attended_students: 5 },
    { room_id: null, added_students: 3, attended_students: 1 },
  ]);
  const report = await getCalendarRoomReport({}, async () => ({ total: 1, data: [calendar] }), false, client);
  assert.equal(report.data.length, 1);
  assert.equal(report.data[0].added_students, 38);
  assert.equal(report.data[0].attended_students, 16);
  assert.equal(report.group_by, 'program');
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(report.data), { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc']);
  assert.equal(output.length, 1);
  assert.equal(output[0]['HS học'], 16);
  assert.equal(output[0]['Tổng HS được thêm'], 38);
  assert.equal(output[0]['Tỷ lệ học (%)'], 42.1);
  const percentage = workbook.Sheets['Bao cao lop hoc']['J2'];
  assert.equal(percentage.t, 'n');
  assert.equal(percentage.w, '42.1');
  assert.equal(output[0]['Session EVG'], undefined);
});

test('chế độ từng room và lọc room xuất Excel đúng phạm vi, bỏ cột Session EVG', async () => {
  const list = async () => ({ total: 1, data: [calendar] });
  const clientForReport = () => mockReportClient([
    { room_id: 1, added_students: 20, attended_students: 10 },
    { room_id: 2, added_students: 15, attended_students: 5 },
    { room_id: null, added_students: 3, attended_students: 1 },
  ]);
  const detail = await getCalendarRoomReport({ group_by: 'room' }, list, false, clientForReport());
  assert.equal(detail.group_by, 'room');
  assert.deepEqual(detail.data.map((row) => row.room_id), [1, 2, null]);
  assert.deepEqual(detail.rooms, [null, 1, 2]);
  const filtered = await getCalendarRoomReport({ group_by: 'room', room_id: 2 }, list, true, clientForReport());
  assert.equal(filtered.data.length, 1);
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(filtered.data, filtered.group_by), { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc']);
  assert.equal(output.length, 1);
  assert.equal(output[0]['Room'], 2);
  assert.equal(output[0]['HS học'], 5);
  assert.equal(output[0]['Tổng HS được thêm'], 15);
  assert.equal(output[0]['Tổng HS học / Tổng HS được thêm'], '16 / 38');
  assert.equal(filtered.data[0].lesson_attended_students, 16);
  assert.equal(filtered.data[0].lesson_added_students, 38);
  assert.equal(output[0]['Session EVG'], undefined);
  const unassigned = await getCalendarRoomReport({ group_by: 'room', room_id: 'unassigned' }, list, true, clientForReport());
  const unassignedWorkbook = XLSX.read(buildCalendarRoomReportWorkbook(unassigned.data, unassigned.group_by), { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json<any>(unassignedWorkbook.Sheets['Bao cao lop hoc'])[0]['Room'], 'Chưa chia');
});

test('báo cáo chuyển nguyên bộ lọc, chỉ truy vấn lịch đã lọc và lọc đúng room chưa chia', async () => {
  const queries: any[] = [];
  const sqlQueries: any[] = [];
  const client = mockReportClient([
    { room_id: null, added_students: 10, attended_students: 1 },
    { room_id: 2, added_students: 20, attended_students: 12 },
  ], sqlQueries);
  const filters = { calendar_source: 'feed', code: calendar.code, teacher: calendar.teacher, weekdays: '3', from_learn_number: 1, start_time: '2026-10-14', page: '2', room_id: 'unassigned' };
  const report = await getCalendarRoomReport(filters, async (query) => { queries.push(query); return { total: 30, data: [calendar] }; }, false, client);
  assert.deepEqual(queries[0], { ...filters, page: 2, limit: 20 });
  assert.equal(report.total_schedules, 30);
  assert.equal(report.data.length, 1);
  assert.equal(report.data[0].room_id, null);
  const rosterSql = sqlQueries[1].strings.join(' ');
  assert.doesNotMatch(rosterSql, /JOIN teacher_profiles/);
  assert.match(rosterSql, /LOWER\(TRIM\(student.username\)\) <> w.teacher_username/);
  assert.match(rosterSql, /FIND_IN_SET\(LOWER\(TRIM\(student.username\)\), w.assistant_usernames\) = 0/);
  assert.match(rosterSql, /ROW_NUMBER\(\) OVER \(PARTITION BY history.calendar_id, history.user_id/);
  assert.match(sqlQueries[2].strings.join(' '), /SELECT username, student_hmid FROM teacher_profiles/);
  const activitySql = sqlQueries[3].strings.join(' ');
  assert.match(activitySql, /created_at >=/);
  assert.match(activitySql, /created_at </);
  assert.doesNotMatch(activitySql, /JOIN|LAG|GROUP BY|ORDER BY|status = 2/i);
  assert.ok(sqlQueries[1].values.includes(calendar.code));
});

test('Excel xuất tất cả trang theo cùng bộ lọc và room, không chỉ trang đang xem', async () => {
  const visited: number[] = [];
  const report = await getCalendarRoomReport({ calendar_source: 'feed', teacher: 'GV', page: 9 }, async (query) => {
    visited.push(query.page);
    assert.equal(query.teacher, 'GV');
    return { total: 201, data: [] };
  }, true, { $queryRaw: async () => { assert.fail('Không truy vấn log khi không có lịch'); } } as any);
  assert.deepEqual(visited, [1, 2, 3]);
  assert.equal(report.total_schedules, 201);
});

test('từ chối page/room sai và export quá lớn thay vì xuất thiếu dữ liệu', async () => {
  const list = async () => ({ total: 2001, data: [] });
  await assert.rejects(getCalendarRoomReport({ page: 0 }, list), /Trang/);
  await assert.rejects(getCalendarRoomReport({ room_id: 'bad' }, list), /Room/);
  await assert.rejects(getCalendarRoomReport({ group_by: 'bad' }, list), /hiển thị/);
  await assert.rejects(getCalendarRoomReport({}, list, true), /2.000/);
});

test('workbook có ngày live, khung giờ theo lịch và tỷ lệ HS toàn chương trình', () => {
  const windows = buildReportWindows([calendar], [], now);
  const rows = assembleProgramReport(windows, [{ window_id: windows[0].key, room_id: 3, added_students: 20, attended_students: 10 }]);
  const workbookRows = rows.map((row) => ({
    ...row, lesson_attended_students: row.attended_students, lesson_added_students: row.added_students,
  }));
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(workbookRows), { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc']);
  assert.equal(output[0]['Room'], undefined);
  assert.equal(output[0]['Class ID'], undefined);
  assert.equal(output[0]['HS học'], 10);
  assert.equal(output[0]['Tổng HS được thêm'], 20);
  assert.equal(output[0]['Tỷ lệ học (%)'], 50);
  assert.equal(workbook.Sheets['Bao cao lop hoc']['J2'].w, '50');
  const headers = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Bao cao lop hoc'], { header: 1 })[0];
  assert.equal(headers[0], 'Hệ thống');
  assert.ok(!headers.includes('ID lịch'));
  assert.ok(!headers.includes('Nguồn lịch'));
  assert.equal(output[0]['Vào lớp thực tế (EVG)'], undefined);
  assert.equal(output[0]['Tan lớp thực tế (EVG)'], undefined);
  assert.equal(output[0]['Bắt đầu dự kiến'], undefined);
  assert.equal(output[0]['Kết thúc dự kiến'], undefined);
  assert.equal(output[0]['Ngày live'], '14/10/2026');
  assert.equal(output[0]['Khung giờ'], '21:00 - 22:00');
  assert.ok(workbook.Sheets['Huong dan']);
});


test('tổng toàn buổi phân biệt lịch 1/lịch 2, không cộng chéo chương trình, không đổi khi lọc room', async () => {
  const calendars = [calendar, { ...calendar, id: 5000, learn_number: 2 }, { ...calendar, id: 5001, code: 'other-program' }, { ...calendar, id: 5002, learn_number: 3 }];
  const roster = calendars.slice(0, 3).flatMap((entry, index) => Array.from({ length: index + 2 }, (_, offset) => ({
    window_id: `${entry.id}:unrecorded`, user_id: entry.id * 10 + offset, belongs_to_calendar: true, username: `student-${offset}`, student_hmid: String(offset), room_id: offset + 1,
  })));
  const logs = calendars.slice(0, 3).flatMap((entry, index) => Array.from({ length: index + 1 }, (_, offset) => ['21:05', '21:10'].map((time, tick) => ({
    activity_id: entry.id * 100 + offset * 2 + tick, username: `student-${offset}`, student_hmid: String(offset), code: entry.code, learn_number: entry.learn_number, created_at: at(time), status: 2,
  })))).flat();
  const client = () => ({ $queryRaw: async (query: any) => {
    if (query.sql.includes('FROM users_logs')) return logs;
    if (query.sql.includes('SELECT window_id, user_id')) return roster;
    return [];
  } }) as any;
  const list = async () => ({ total: calendars.length, data: calendars });
  const report = await getCalendarRoomReport({ group_by: 'room' }, list, false, client());
  for (const [id, expected] of [[4836, [1, 2]], [5000, [2, 3]], [5001, [3, 4]], [5002, [0, 0]]] as const) {
    const rows = report.data.filter((row) => row.calendar_id === id);
    assert.ok(rows.length);
    for (const row of rows) assert.deepEqual([row.lesson_attended_students, row.lesson_added_students], expected);
  }
  const filtered = await getCalendarRoomReport({ group_by: 'room', room_id: 1 }, list, true, client());
  assert.deepEqual(filtered.data.map((row) => [row.lesson_attended_students, row.lesson_added_students]), [[1, 2], [2, 3], [3, 4]]);
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(filtered.data, 'room'), { type: 'buffer', cellStyles: true });
  const sheet = workbook.Sheets['Bao cao lop hoc'];
  assert.deepEqual(XLSX.utils.sheet_to_json<any>(sheet).map((row) => row['Tổng HS học / Tổng HS được thêm']), ['1 / 2', '2 / 3', '3 / 4']);
  assert.equal(sheet['M1'].s?.fgColor?.rgb, '0C343D');
});

test('một HS học nhiều phiên của cùng lịch chỉ tính một lần trong tổng buổi, không ghép heartbeat qua phiên', async () => {
  const callbacks = [
    { calendar_id: calendar.id, live_session_id: 'a', start_on: at('21:00'), end_on: at('21:30') },
    { calendar_id: calendar.id, live_session_id: 'b', start_on: at('21:30'), end_on: at('22:00') },
  ];
  const roster = ['a', 'b'].flatMap((session) => ['alice', 'bob'].map((username, index) => ({
    window_id: `${calendar.id}:${session}`, user_id: index + 1, belongs_to_calendar: true, username, student_hmid: null, room_id: 1,
  })));
  const logs = [
    ['alice', '21:05'], ['alice', '21:10'], ['alice', '21:35'], ['alice', '21:40'],
    ['bob', '21:10'], ['bob', '21:35'],
  ].map(([username, time], index) => ({ activity_id: index, created_at: at(time), status: 2, username, student_hmid: null, code: calendar.code, learn_number: 1 }));
  const client = { $queryRaw: async (query: any) => {
    if (query.sql.includes('FROM users_logs')) return logs;
    if (query.sql.includes('SELECT window_id, user_id')) return roster;
    if (query.sql.includes('FROM evg_callbacks')) return callbacks;
    return [];
  } } as any;
  const report = await getCalendarRoomReport({}, async () => ({ total: 1, data: [calendar] }), false, client);
  assert.equal(report.data.length, 1);
  assert.deepEqual(report.data.map((row) => [row.attended_students, row.added_students, row.lesson_attended_students, row.lesson_added_students]), [[1, 2, 1, 2]]);
});


test('lịch 1/lịch 2 cùng chương trình và số bài: cột lịch lọc class_id, cột tổng giữ toàn bộ roster', async () => {
  const second = { ...calendar, id: 5003, start_time: new Date('2026-10-15T21:00:00Z'), end_time: new Date('2026-10-15T22:00:00Z') };
  const roster = [calendar, second].flatMap((entry) => ['alice', 'bob', 'carol'].map((username, index) => ({
    window_id: `${entry.id}:unrecorded`, user_id: index + 1, username, student_hmid: null, room_id: entry.id === calendar.id ? 1 : 12,
    belongs_to_calendar: entry.id === calendar.id ? username === 'alice' : username === 'bob',
  })));
  const logs = [[calendar, ['alice', 'carol']], [second, ['bob']]].flatMap(([entry, names]: any) => names.flatMap((username: string) => [5, 10].map((minute) => ({
    activity_id: minute, username, student_hmid: null, code: calendar.code, learn_number: 1, status: 2,
    created_at: new Date(entry.start_time.getTime() + minute * 60_000),
  }))));
  const queries: any[] = [];
  const client = { $queryRaw: async (query: any) => {
    queries.push(query);
    if (query.sql.includes('FROM users_logs')) return logs;
    if (query.sql.includes('SELECT window_id, user_id')) return roster;
    return [];
  } } as any;
  const result = await getCalendarRoomReport({}, async () => ({ total: 2, data: [calendar, second] }), false, client);
  assert.deepEqual(result.data.map((row) => [row.attended_students, row.added_students, row.lesson_attended_students, row.lesson_added_students]), [
    [1, 1, 3, 3], [1, 1, 3, 3],
  ]);
  const selectedOnly = await getCalendarRoomReport({ calendar_ids: String(second.id), start_time: '2026-10-15', page: 1 }, async (query) => {
    if (query.keyword === calendar.code) {
      assert.equal(query.calendar_ids, undefined);
      assert.equal(query.start_time, undefined);
      assert.equal(query.learn_numbers, '1');
      return { total: 2, data: [calendar, second] };
    }
    return { total: 1, data: [second] };
  }, false, client);
  assert.equal(selectedOnly.data.length, 1);
  assert.equal(selectedOnly.data[0].calendar_id, second.id);
  assert.equal(selectedOnly.data[0].lesson_attended_students, 3);
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(selectedOnly.data), { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc'])[0]['Tỷ lệ tổng HS học (%)'], 100);
  assert.match(queries[1].sql, /student.class_id = CONCAT\(w.class_prefix/);
  assert.match(queries[1].sql, /AS belongs_to_calendar/);
  assert.equal(queries.filter((query) => query.sql.includes('FROM users_logs')).length, 4, 'Mỗi lần báo cáo chỉ quét một lần mỗi lịch, dùng chung cho cả hai cột');
});


test('5 phiên EVG của một lịch chỉ ra một dòng, HS của phiên đầu/cuối không bị cộng trùng; room và Excel cùng quy tắc', async () => {
  const times = [['21:00', '21:30'], ['21:30', '21:31'], ['21:31', '21:32'], ['21:32', '21:33'], ['21:33', '22:00']];
  const callbacks = times.map(([from, to], index) => ({ calendar_id: calendar.id, live_session_id: `session-${index}`, start_on: at(from), end_on: at(to) }));
  const students = Array.from({ length: 270 }, (_, index) => ({ user_id: index + 1, username: `student-${index}`, student_hmid: null, room_id: index < 135 ? 1 : 12, belongs_to_calendar: true }));
  const roster = callbacks.flatMap((session) => students.map((student) => ({ ...student, window_id: `${calendar.id}:${session.live_session_id}` })));
  const logs = students.flatMap((student, index) => {
    const times = index === 269 ? ['21:05', '21:40'] : index < 159 ? ['21:05', '21:10'] : ['21:05', '21:10', '21:40', '21:45'];
    return times.map((time) => ({ ...student, activity_id: index * 10 + Number(time.slice(-2)), created_at: at(time), status: 2, code: calendar.code, learn_number: 1 }));
  });
  const client = () => ({ $queryRaw: async (query: any) => {
    if (query.sql.includes('FROM evg_callbacks')) return callbacks;
    if (query.sql.includes('SELECT window_id, user_id')) return roster;
    if (query.sql.includes('FROM users_logs')) return logs;
    return [];
  } }) as any;
  const list = async () => ({ total: 1, data: [calendar] });
  const summary = await getCalendarRoomReport({}, list, false, client());
  assert.equal(summary.data.length, 1);
  assert.deepEqual([summary.data[0].attended_students, summary.data[0].added_students], [269, 270]);
  const detail = await getCalendarRoomReport({ group_by: 'room' }, list, false, client());
  assert.deepEqual(detail.data.map((row) => [row.room_id, row.attended_students, row.added_students]), [[1, 135, 135], [12, 134, 135]]);
  assert.equal(new Set(detail.data.map((row) => row.key)).size, 2);
  for (const [report, mode] of [[summary, 'program'], [detail, 'room']] as const) {
    const workbook = XLSX.read(buildCalendarRoomReportWorkbook(report.data, mode), { type: 'buffer' });
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Bao cao lop hoc']).length, report.data.length);
  }
});


test('khung giờ live thật trên Excel gộp một khoảng HH:mm và hiển thị ngày khi qua nửa đêm', async () => {
  const ranges = [
    { start_time: '2026-10-14T20:39:41.000Z', end_time: '2026-10-14T20:40:51.000Z' },
    { start_time: '2026-10-14T20:41:16.000Z', end_time: '2026-10-15T00:09:48.000Z' },
  ];
  const report = await getCalendarRoomReport({}, async () => ({ total: 1, data: [calendar] }), false,
    mockReportClient([{ room_id: 1, added_students: 2, attended_students: 1 }]),
    async (calendars) => {
      assert.deepEqual(calendars.map((row) => row.id), [calendar.id]);
      return new Map([[calendar.id, { ranges, status: 'ready' as const }]]);
    });
  assert.deepEqual(report.data[0].live_recording?.ranges, ranges);
  assert.equal(report.data[0].attended_students, 1);
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(report.data), { type: 'buffer' });
  const output = XLSX.utils.sheet_to_json<any>(workbook.Sheets['Bao cao lop hoc']);
  assert.equal(output[0]['Khung giờ live thật'], '20:39 - 00:09 (15/10/2026)');
});


test('bảng chuyên cần trả trước, không chờ hay gọi EVG khi include_recordings=false', async () => {
  const report = await getCalendarRoomReport({ include_recordings: 'false' }, async () => ({ total: 1, data: [calendar] }), false,
    mockReportClient([{ room_id: 1, added_students: 2, attended_students: 1 }]),
    async () => { assert.fail('Không được gọi EVG khi tải bảng chuyên cần'); });
  assert.equal(report.data[0].attended_students, 1);
  assert.equal(report.data[0].live_recording, undefined);
});

test('API giờ live chỉ lấy lịch đã phân quyền đang hiển thị, không chạy lại báo cáo chuyên cần', async () => {
  let listCalls = 0;
  const result = await getCalendarRoomReportLiveTimes({ calendar_ids: '4836,9999', page: 2, calendar_source: 'feed' }, async (query) => {
    listCalls++;
    assert.equal(query.page, 1);
    assert.equal(query.limit, 300);
    assert.equal(query.calendar_source, 'feed');
    return { total: 1, data: [calendar] }; // Lịch 9999 nằm ngoài quyền người dùng.
  }, async (calendars) => {
    assert.deepEqual(calendars.map((item) => item.id), [4836]);
    return new Map([[4836, { status: 'ready' as const, ranges: [{ start_time: '2026-10-14T19:18:47.000Z', end_time: '2026-10-14T20:06:28.000Z' }] }]]);
  });
  assert.equal(listCalls, 1);
  assert.deepEqual(result.map((item) => item.calendar_id), [4836]);
  await assert.rejects(getCalendarRoomReportLiveTimes({}, async () => { assert.fail('Không truy vấn nếu thiếu ID'); }), /lịch hợp lệ/);
});

test('đọc hai phần log song song nhưng tiêu thụ theo thời gian, giữ đúng chuỗi khi qua ranh giới giờ', async () => {
  const entry = { ...calendar, start_time: at('20:00'), end_time: at('22:00') };
  for (const resets of [false, true]) {
    let active = 0, peak = 0;
    const finished: number[] = [];
    const client = { $queryRaw: async (query: any) => {
      if (query.sql.includes('SELECT window_id, user_id')) return [{ window_id: '4836:unrecorded', user_id: 1, username: 'alice', student_hmid: null, room_id: 1, belongs_to_calendar: true }];
      if (!query.sql.includes('FROM users_logs')) return [];
      const hour = query.values.find((value: unknown) => value instanceof Date).getUTCHours();
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, hour === 20 ? 20 : 1));
      active--; finished.push(hour);
      const events = hour === 20 ? [[2, '20:55']] : resets ? [[1, '21:00'], [2, '21:05']] : [[2, '21:00']];
      return events.map(([status, time], index) => ({ activity_id: hour * 10 + index, status, created_at: at(String(time)), username: 'alice', code: calendar.code, learn_number: 1 }));
    } } as any;
    const report = await getCalendarRoomReport({}, async () => ({ total: 1, data: [entry] }), false, client);
    assert.deepEqual(finished, [21, 20]);
    assert.equal(peak, 2);
    assert.equal(report.data[0].attended_students, resets ? 0 : 1);
  }
});

test('mỗi phần log chỉ xét chương trình còn live trong khoảng đó và chặn đúng giờ kết thúc', async () => {
  const calendars = [
    { ...calendar, code: 'short-program', start_time: at('20:00'), end_time: at('20:30') },
    { ...calendar, id: 5002, code: 'long-program', start_time: at('20:00'), end_time: at('22:00') },
  ];
  const queries: any[] = [];
  const client = { $queryRaw: async (query: any) => {
    if (query.sql.includes('SELECT window_id, user_id')) return calendars.map((entry) => ({ window_id: `${entry.id}:unrecorded`, user_id: entry.id, username: 'alice', student_hmid: null, room_id: 1, belongs_to_calendar: true }));
    if (query.sql.includes('FROM users_logs')) queries.push(query);
    return [];
  } } as any;
  await getCalendarRoomReport({}, async () => ({ total: 2, data: calendars }), false, client);
  assert.equal(queries.length, 2);
  assert.ok(queries[0].values.includes('short-program'));
  assert.ok(queries[0].values.some((value: unknown) => value instanceof Date && value.getTime() === at('20:30').getTime()));
  assert.ok(!queries[1].values.includes('short-program'), 'Không đọc log sau khi chương trình đã hết giờ live');
});


test('fast calendar metadata reads only the authorized list, with unknown counts rather than zeros', async () => {
  const calls: any[] = [];
  const query = { page: 2, calendar_source: 'feed', code_exact: 'permission-program', start_time: '2026-10-14', include_attendance: 'false', group_by: 'room' };
  const report = await getCalendarRoomReportSchedules(query, async q => {
    calls.push(q); return { total: 21, data: [calendar] };
  });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], { ...query, limit: 20 });
  assert.equal(report.total_schedules, 21); assert.equal(report.page, 2);
  const row = report.data[0];
  assert.equal(row.calendar_id, calendar.id); assert.equal(row.lesson_name, calendar.lesson_name);
  assert.equal(row.attendance_status, 'pending');
  for (const field of ['attended_students', 'added_students', 'lesson_attended_students', 'lesson_added_students']) assert.equal((row as any)[field], null);
  assert.equal('evg_stream' in row, false); assert.equal('live_recording' in row, false);
  assert.deepEqual(report.rooms, []);
  for (const query of [{ page: 0 }, { group_by: 'invalid' }]) await assert.rejects(getCalendarRoomReportSchedules(query, async () => { assert.fail('Must validate before reading calendar'); }));
});

test('sibling lookup runs at most two programs concurrently, preserving display order and totals', async () => {
  const selected = Array.from({ length: 5 }, (_, i) => ({ ...calendar, id: i + 1, code: `program-${i + 1}` }));
  let active = 0, maxActive = 0, relatedCalls = 0;
  const report = await getCalendarRoomReport({}, async q => {
    if (!q.keyword) return { total: selected.length, data: selected };
    active++; maxActive = Math.max(maxActive, active); relatedCalls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { total: 1, data: selected.filter(c => c.code === q.keyword) };
  }, false, { $queryRaw: async () => [] } as any);
  assert.equal(maxActive, 2); assert.equal(relatedCalls, 5);
  assert.deepEqual(report.data.map(r => r.calendar_id), selected.map(c => c.id));
});
