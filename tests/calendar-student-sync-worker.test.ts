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
  assert.deepEqual(where.code, { not: { startsWith: 'feed-' } });
  assert.deepEqual(where.OR, [{ lesson_status: null }, { lesson_status: { not: 1 } }]);
  assert.ok(new Date('2026-09-28T18:30:00.000Z') >= where.start_time.gte);
  assert.ok(new Date('2026-09-28T18:30:00.000Z') < where.start_time.lt);
  assert.equal(window.end.toISOString(), '2026-09-29T00:00:00.000Z');
  assert.equal(calendarStudentSyncRegisteredAt(now), '28/09/2026');
});

test('cron runs every 5 minutes from 17:00 to 23:55 Vietnam time, without a duplicate run inside one slot', async () => {
  let current = new Date('2026-09-28T09:00:05.000Z'); // 16:00 Việt Nam
  let runs = 0;
  const check = createCalendarStudentSyncCheck(async () => { runs += 1; }, () => current);
  await check();
  current = new Date('2026-09-28T10:00:05.000Z'); // 17:00
  await check();
  current = new Date('2026-09-28T10:00:45.000Z');
  await check();
  current = new Date('2026-09-28T10:04:59.000Z'); // still 17:00 slot
  await check();
  current = new Date('2026-09-28T10:05:05.000Z'); // 17:05
  await check();
  current = new Date('2026-09-28T10:10:05.000Z'); // 17:10
  await check();
  current = new Date('2026-09-28T16:30:05.000Z'); // 23:30
  await check();
  current = new Date('2026-09-28T16:59:59.000Z'); // 23:59
  await check();
  current = new Date('2026-09-28T16:59:59.500Z'); // same 23:55 slot
  await check();
  current = new Date('2026-09-28T17:00:05.000Z'); // 00:00 hôm sau
  await check();
  assert.equal(runs, 5);
});

test('cron catches a delayed tick and a restart within a five-minute window', async () => {
  let current = new Date('2026-10-14T10:07:00Z');
  let runs = 0;
  const check = createCalendarStudentSyncCheck(async () => { runs += 1; }, () => current);
  await check();
  current = new Date('2026-10-14T10:09:59Z');
  await check();
  assert.equal(runs, 1);
  current = new Date('2026-10-14T10:12:00Z');
  await check();
  assert.equal(runs, 2);
});

test('all 84 daily five-minute slots run once and a long run cannot overlap the next slot', async () => {
  let current = new Date('2026-10-14T10:00:00Z');
  let calls = 0;
  const check = createCalendarStudentSyncCheck(async () => {calls += 1;}, () => current);
  for (let offset = 0; offset < 7 * 60; offset += 5) {
    current = new Date(Date.parse('2026-10-14T10:00:00Z') + offset * 60_000);
    await check(); await check();
  }
  assert.equal(calls, 84);
  let release!: () => void;
  current = new Date('2026-10-14T16:50:00Z');
  const blocked = createCalendarStudentSyncCheck(async () => {
    calls += 1;
    await new Promise<void>(resolve => {release = resolve;});
  }, () => current);
  const first = blocked();
  current = new Date('2026-10-14T16:59:00Z');
  await blocked();
  assert.equal(calls, 85);
  release(); await first;
});

test('cron retries the same slot after a lock conflict or an exception', async () => {
  let calls = 0;
  const check = createCalendarStudentSyncCheck(async () => {
    calls += 1;
    if (calls === 1) return { started: false };
    if (calls === 2) throw new Error('Temporary failure');
    return { started: true };
  }, () => new Date('2026-10-14T10:05:00Z'));
  await check();
  await check();
  await check();
  await check();
  assert.equal(calls, 3);
});
