import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarTeachingUserSyncWindow,
  createCalendarTeachingUserSyncCheck,
} from '../src/modules/livestream/calendar-teaching-user-sync.worker';

test('cửa sổ quét gồm hôm nay và 6 ngày kế tiếp theo giờ Việt Nam', () => {
  // 03:00 Thứ Ba 22/09/2026 tại Việt Nam.
  const window = calendarTeachingUserSyncWindow(new Date('2026-09-21T20:00:00.000Z'));
  assert.equal(window.start.toISOString(), '2026-09-22T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-29T00:00:00.000Z');
});

test('ngày kế tiếp cửa sổ tự trượt thêm một ngày', () => {
  // 03:00 Thứ Tư 23/09/2026 tại Việt Nam.
  const window = calendarTeachingUserSyncWindow(new Date('2026-09-22T20:00:00.000Z'));
  assert.equal(window.start.toISOString(), '2026-09-23T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-30T00:00:00.000Z');
});

test('cron chỉ chạy một lần trong phút 03:00 mỗi ngày', async () => {
  let current = new Date('2026-09-21T20:00:05.000Z');
  let runs = 0;
  const check = createCalendarTeachingUserSyncCheck(
    async () => { runs += 1; },
    () => current
  );

  await check();
  current = new Date('2026-09-21T20:00:45.000Z');
  await check();
  assert.equal(runs, 1);

  current = new Date('2026-09-22T20:00:05.000Z');
  await check();
  assert.equal(runs, 2);
});

test('cron không chạy trước hoặc sau phút 03:00', async () => {
  let current = new Date('2026-09-21T19:59:59.000Z');
  let runs = 0;
  const check = createCalendarTeachingUserSyncCheck(
    async () => { runs += 1; },
    () => current
  );

  await check();
  current = new Date('2026-09-21T20:01:00.000Z');
  await check();
  assert.equal(runs, 0);
});
