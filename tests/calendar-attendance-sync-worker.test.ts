import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarAttendanceSyncWindow,
  createCalendarAttendanceSyncCheck,
  getCalendarAttendanceSyncStatus,
  runCalendarAttendanceSync,
} from '../src/modules/livestream/calendar-attendance-sync.worker';

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
