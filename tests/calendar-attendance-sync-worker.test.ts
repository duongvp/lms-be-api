import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarAttendanceSyncWindow,
  createCalendarAttendanceSyncCheck,
  getCalendarAttendanceSyncStatus,
  runCalendarAttendanceSync,
} from '../src/modules/livestream/calendar-attendance-sync.worker';
import { buildHocmaiAttendancePayload } from '../src/modules/livestream/livestream.service';

test('cửa sổ đồng bộ chuyên cần là trọn ngày hôm trước theo giờ Việt Nam', () => {
  // 04:00 ngày 25/09/2026 tại Việt Nam.
  const window = calendarAttendanceSyncWindow(new Date('2026-09-24T21:00:00.000Z'));
  assert.equal(window.start.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-25T00:00:00.000Z');
});

test('cron chỉ chạy một lần trong phút 04:00 mỗi ngày', async () => {
  let current = new Date('2026-09-24T21:00:05.000Z');
  let runs = 0;
  const check = createCalendarAttendanceSyncCheck(
    async () => { runs += 1; },
    () => current
  );

  await check();
  current = new Date('2026-09-24T21:00:45.000Z');
  await check();
  assert.equal(runs, 1);

  current = new Date('2026-09-25T21:00:05.000Z');
  await check();
  assert.equal(runs, 2);
});

test('cron không chạy ngoài phút 04:00', async () => {
  let current = new Date('2026-09-24T20:59:59.000Z');
  let runs = 0;
  const check = createCalendarAttendanceSyncCheck(
    async () => { runs += 1; },
    () => current
  );

  await check();
  current = new Date('2026-09-24T21:01:00.000Z');
  await check();
  assert.equal(runs, 0);
});

test('lưu một lượt thành công kể cả khi hôm trước không có lịch', async () => {
  const statements: string[] = [];
  const client = {
    $executeRaw: async (parts: TemplateStringsArray) => {
      statements.push(parts.join('?'));
      return 1;
    },
    $queryRaw: async () => [{ id: 1n }],
    calendar: { findMany: async () => [] },
  } as any;
  const result = await runCalendarAttendanceSync(
    new Date('2026-09-24T21:00:00.000Z'),
    client,
    async () => { throw new Error('Không được đồng bộ khi không có lịch'); }
  );
  assert.equal(result.status, 'completed');
  assert.equal(result.calendars, 0);
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO calendar_attendance_sync_runs')));
  assert.ok(statements.some((sql) => sql.includes('SET status=') && sql.includes('active_key=NULL')));
});

test('ghi lỗi theo lịch và tiếp tục xử lý lịch kế tiếp', async () => {
  const statements: string[] = [];
  const client = {
    $executeRaw: async (parts: TemplateStringsArray) => {
      statements.push(parts.join('?'));
      return 1;
    },
    $queryRaw: async () => [{ id: 2n }],
    calendar: { findMany: async () => [{ id: 10 }, { id: 11 }] },
  } as any;
  const synced: number[] = [];
  const result = await runCalendarAttendanceSync(
    new Date('2026-09-24T21:00:00.000Z'),
    client,
    async (ids: unknown) => {
      const id = (ids as number[])[0];
      synced.push(id);
      if (id === 10) throw new Error('HOCMAI không phản hồi');
      return { processed: 1, skipped: 0, updated: 3, details: [{ calendar_id: id, updated: 3, hocmai_updated: 2 }] };
    }
  );
  assert.deepEqual(synced, [10, 11]);
  assert.equal(result.status, 'completed_with_errors');
  assert.equal(result.processed, 1);
  assert.equal(result.updated, 3);
  assert.equal(result.hocmaiUpdated, 2);
  assert.deepEqual(result.errors, [{ calendar_id: 10, message: 'HOCMAI không phản hồi' }]);
  assert.ok(statements.some((sql) => sql.includes('calendars_failed=')));
});

test('Tổng quan nhận biết khi bảng lịch sử chưa được triển khai', async () => {
  const client = {
    $queryRaw: async () => { throw { meta: { code: '1146' } }; },
  } as any;
  const status = await getCalendarAttendanceSyncStatus(client);
  assert.equal(status.available, false);
  assert.equal(status.latest, null);
  assert.deepEqual(status.history, []);
});

test('payload Topclass gửi toàn bộ B và giữ calendar_join là buổi thực tế B1', () => {
  const keys = [
    'tc_2627_tienganh-7-2027_12',
    'tc_2627_tienganh-7-2027_12_B2',
    'tc_2627_tienganh-7-2027_12_B3',
    'tc_2627_tienganh-7-2027_12_B4',
  ];
  const payload = buildHocmaiAttendancePayload(keys, keys[0], ['8745328']);
  assert.deepEqual(payload.map((item) => item.c_key), keys);
  assert.ok(payload.every((item) => item.calendar_join === keys[0] && item.user_id === '8745328'));
});

test('payload Topclass gửi toàn bộ B và giữ calendar_join là buổi thực tế B2, B3 hoặc B4', () => {
  const keys = [
    'tc_2627_tienganh-7-2027_12',
    'tc_2627_tienganh-7-2027_12_B2',
    'tc_2627_tienganh-7-2027_12_B3',
    'tc_2627_tienganh-7-2027_12_B4',
  ];
  for (const joinedKey of keys.slice(1)) {
    const payload = buildHocmaiAttendancePayload(keys, joinedKey, ['8745328']);
    assert.equal(payload.length, 4);
    assert.ok(payload.every((item) => item.calendar_join === joinedKey));
  }
});

test('payload Topclass hỗ trợ B1 đến B8 không hard-code số buổi', () => {
  const root = 'tc_2627_tienganh-7-2027_12';
  const keys = [root, ...Array.from({ length: 7 }, (_, index) => root + '_B' + (index + 2))];
  const payload = buildHocmaiAttendancePayload(keys, keys[5], ['8745328']);
  assert.equal(payload.length, 8);
  assert.deepEqual(payload.map((item) => item.c_key), keys);
  assert.ok(payload.every((item) => item.calendar_join === keys[5]));
});

test('payload chuyên cần loại user ID không hợp lệ và không gửi khi không có học viên đủ điều kiện', () => {
  assert.deepEqual(buildHocmaiAttendancePayload(['B1', 'B2'], 'B1', []), []);
  const payload = buildHocmaiAttendancePayload(['B1', 'B1', 'B2'], 'B1', ['8745328', '', 'abc', '8745328']);
  assert.deepEqual(payload, [
    { c_key: 'B1', user_id: '8745328', calendar_join: 'B1' },
    { c_key: 'B2', user_id: '8745328', calendar_join: 'B1' },
  ]);
});

test('payload hoàn tác giữ behavior cũ: calendar_join rỗng và action delete', () => {
  assert.deepEqual(buildHocmaiAttendancePayload(['B2'], '', ['8745328'], 'delete'), [
    { c_key: 'B2', user_id: '8745328', calendar_join: '', action: 'delete' },
  ]);
});

test("payload Topclass gom đủ B1/B2 theo từng học viên thay vì gom theo c_key", () => {
  const payload = buildHocmaiAttendancePayload(
    ["tc_2627_toan-10-2027_18", "tc_2627_toan-10-2027_18_B2"],
    "tc_2627_toan-10-2027_18_B2",
    ["7180180", "8745328"]
  );
  assert.deepEqual(payload, [
    { c_key: "tc_2627_toan-10-2027_18", user_id: "7180180", calendar_join: "tc_2627_toan-10-2027_18_B2" },
    { c_key: "tc_2627_toan-10-2027_18_B2", user_id: "7180180", calendar_join: "tc_2627_toan-10-2027_18_B2" },
    { c_key: "tc_2627_toan-10-2027_18", user_id: "8745328", calendar_join: "tc_2627_toan-10-2027_18_B2" },
    { c_key: "tc_2627_toan-10-2027_18_B2", user_id: "8745328", calendar_join: "tc_2627_toan-10-2027_18_B2" },
  ]);
});
