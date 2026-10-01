import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarStudentSyncCalendarWhere, calendarStudentSyncRegisteredAt, calendarStudentSyncWindow, createCalendarStudentSyncCheck } from '../src/modules/livestream/calendar-student-sync.worker';

test('cron đồng bộ học viên quét toàn bộ lịch trong ngày Việt Nam, kể cả buổi đã bắt đầu', () => {
  const now = new Date('2026-09-28T12:00:00.000Z'); // 19:00 Việt Nam
  const window = calendarStudentSyncWindow(now);
  assert.equal(window.start.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(window.current.toISOString(), '2026-09-28T19:00:00.000Z');
  const where = calendarStudentSyncCalendarWhere(window.start, window.end);
  assert.deepEqual(where.start_time, { gte: window.start, lt: window.end });
  assert.deepEqual(where.OR, [{ lesson_status: null }, { lesson_status: { not: 1 } }]);
  assert.ok(new Date('2026-09-28T18:30:00.000Z') >= where.start_time.gte);
  assert.ok(new Date('2026-09-28T18:30:00.000Z') < where.start_time.lt);
  assert.equal(window.end.toISOString(), '2026-09-29T00:00:00.000Z');
  assert.equal(calendarStudentSyncRegisteredAt(now), '28/09/2026');
});

test('cron chỉ chạy từ 17:00 đến 23:30, mỗi 30 phút theo giờ Việt Nam', async () => {
  let current = new Date('2026-09-28T09:00:05.000Z'); // 16:00 Việt Nam
  let runs = 0;
  const check = createCalendarStudentSyncCheck(async () => { runs += 1; }, () => current);
  await check();
  current = new Date('2026-09-28T10:00:05.000Z'); // 17:00
  await check();
  current = new Date('2026-09-28T10:00:45.000Z');
  await check();
  current = new Date('2026-09-28T10:30:05.000Z'); // 17:30
  await check();
  current = new Date('2026-09-28T16:30:05.000Z'); // 23:30
  await check();
  current = new Date('2026-09-28T16:59:59.000Z'); // 23:59
  await check();
  current = new Date('2026-09-28T17:00:05.000Z'); // 00:00 hôm sau
  await check();
  assert.equal(runs, 3);
});
