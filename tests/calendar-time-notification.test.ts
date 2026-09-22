import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarTimeNotification } from '../src/modules/livestream/calendar-time-notification';
const current = { start_time: new Date('2026-09-20T19:00:00Z'), end_time: new Date('2026-09-20T20:00:00Z'), lesson_status: 0 };
const changes = { start_time: new Date('2026-09-20T20:00:00Z'), end_time: new Date('2026-09-20T21:00:00Z') };

test('uses entered notification when time changes without cancelling the session', () => {
  assert.equal(calendarTimeNotification(current, changes, true, '  Chuyển giờ học sang 20h  '), 'Chuyển giờ học sang 20h');
  assert.equal(current.lesson_status, 0);
  assert.equal('lesson_status' in changes, false);
});
test('quick edit generates a notice with old and new calendar wall times', () => {
  const notice = calendarTimeNotification(current, changes, undefined, undefined)!;
  assert.match(notice, /19:00 ngày 20\/09\/2026/);
  assert.match(notice, /21:00 ngày 20\/09\/2026/);
  assert.match(calendarTimeNotification(current, { end_time: changes.end_time }, true, '')!, /21:00/);
});
test('same timestamps and unrelated edits preserve the existing notification', () => {
  assert.equal(calendarTimeNotification(current, { start_time: current.start_time.toISOString() }, true, 'new'), undefined);
  assert.equal(calendarTimeNotification(current, { teacher: 'GV mới' }, undefined, undefined), undefined);
});
test('explicit opt out preserves notification, and content respects the DB limit', () => {
  assert.equal(calendarTimeNotification(current, changes, false, 'new'), undefined);
  assert.equal(calendarTimeNotification(current, changes, true, 'a'.repeat(500))?.length, 500);
  assert.throws(() => calendarTimeNotification(current, changes, true, 'a'.repeat(501)), /500/);
});
