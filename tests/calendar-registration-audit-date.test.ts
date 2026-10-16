import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationAuditDates, registrationsBeforeCutoff } from '../src/modules/livestream/calendar-registration-audit-date';
import { startRegistrationAudit } from '../src/modules/livestream/calendar-registration-audit.service';

test('audit date follows Vietnam midnight, month and year boundaries', () => {
  assert.deepEqual(registrationAuditDates(Date.parse('2026-10-14T16:59:59Z')), {yesterday: '13/10/2026', today: '14/10/2026'});
  assert.deepEqual(registrationAuditDates(Date.parse('2026-10-14T17:00:00Z')), {yesterday: '14/10/2026', today: '15/10/2026'});
  assert.deepEqual(registrationAuditDates(Date.parse('2026-12-31T17:00:00Z')), {yesterday: '31/12/2026', today: '01/01/2027'});
  assert.deepEqual(registrationAuditDates(Date.parse('2028-02-29T17:00:00Z')), {yesterday: '29/02/2028', today: '01/03/2028'});
});

test('exclude today by user AND package, retaining yesterday membership in another package', () => {
  const yesterday = {userid: '1', username: '00123', product_id: '9318'};
  const today = {...yesterday, product_id: '9166'};
  const todayOtherUser = {userid: '2', username: '00456', product_id: '9318'};
  assert.deepEqual(registrationsBeforeCutoff([yesterday, today, todayOtherUser], [today, todayOtherUser]), [yesterday]);
  assert.deepEqual(registrationsBeforeCutoff([yesterday], []), [yesterday]);
});

test('subtract duplicate occurrences rather than dropping every matching registration', () => {
  const row = {userid: '1', username: '00123', product_id: '9318'};
  assert.deepEqual(registrationsBeforeCutoff([row, row, row], [row, row]), [row]);
});

test('1104 cumulative registrations with 54 today yield exactly 1050 yesterday', () => {
  const rows = Array.from({length: 1104}, (_, index) => ({userid: String(index), username: String(index).padStart(10, '0'), product_id: '9318'}));
  const yesterday = registrationsBeforeCutoff(rows, rows.slice(1050));
  assert.equal(yesterday.length, 1050);
  assert.deepEqual(yesterday, rows.slice(0, 1050));
});

test('a new registration between the two API snapshots fails instead of producing a false count', () => {
  const row = {userid: '1', username: '00123', product_id: '9318'};
  assert.throws(() => registrationsBeforeCutoff([], [row]), /thay đổi giữa hai lần/);
  assert.throws(() => registrationsBeforeCutoff([row], [row, row]), /thay đổi giữa hai lần/);
});

test('backend rejects today and older dates before querying schedules or the API', async () => {
  await assert.rejects(startRegistrationAudit([1], registrationAuditDates().today, 1, null), /ngày hôm qua/);
  await assert.rejects(startRegistrationAudit([1], '01/01/2020', 1, null), /ngày hôm qua/);
});
