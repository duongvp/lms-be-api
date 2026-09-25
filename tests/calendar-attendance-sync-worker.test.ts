import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarAttendanceSyncWindow,
  createCalendarAttendanceSyncCheck,
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
