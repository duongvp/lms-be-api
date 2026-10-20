import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  buildReportWindows, assembleRoomReport, assembleProgramReport, getCalendarRoomReport, buildCalendarRoomReportWorkbook, countConsecutiveAttendance, groupReportWindows,
} from '../src/modules/livestream/calendar-room-report.service';

const at = (time: string) => new Date(`2026-10-14T${time}:00Z`);
const calendar = { id: 4836, code: 'feed-tsa-1-2027', learn_number: 1, lesson_name: 'Chia sẻ cách ôn luyện', teacher: 'Giáo viên A', system_type: 'topuni', start_time: at('21:00'), end_time: at('22:00'), evg_stream: '123', channel_name: 'feed-channel' };
const now = new Date('2026-10-19T10:00:00Z');

const mockReportClient = (counts: Array<{ room_id: number | null; added_students: number; attended_students: number }>, queries: any[] = [], staff: Array<{ username: string; student_hmid: string | null }> = []) => {
  const enrollments: any[] = [];
  const activities: any[] = [];
  for (const count of counts) {
    for (let index = 0; index < count.added_students; index++) {
      const id = enrollments.length + 1;
      const student = { window_id: '4836:unrecorded', user_id: id, username: `student-${id}`, student_hmid: String(id), room_id: count.room_id };
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
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(rows, 'room'), { type: 'buffer' });
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
  const workbook = XLSX.read(buildCalendarRoomReportWorkbook(rows), { type: 'buffer' });
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
