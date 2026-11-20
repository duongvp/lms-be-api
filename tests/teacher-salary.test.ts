import test from 'node:test';
import assert from 'node:assert/strict';
import { day, clock, id, numberId, money, hash, sourceShape, resolveRate, calculateAmount, stateAction, paginate, normalizeDimensions, retryableTransactionError } from '../src/modules/teacher-salary/salary-domain';
import { resolveProfile } from '../src/modules/teacher-salary/teaching-report.service';
import { check } from '../src/modules/teacher-salary/salary-common';
const rate = (extra: any = {}) => ({ id: 1, dimensions: { role: 'teacher' }, pay_basis: 'hour', duration_basis: 'actual', amount: '200000', priority: 0, valid_from: '2020-01-01', valid_to: '2030-01-01', ...extra });
for (const value of ['2020-02-30', '2020-13-01', '2020-1-01', '', null])
    test(`reject invalid day ${value}`, () => assert.throws(() => day(value)));
for (const value of [0, -1, '1 OR 1', '1.5', '', null])
    test(`reject invalid ID ${value}`, () => assert.throws(() => id(value)));
test('clock uses stored wall time and does not apply UTC+7 again', () => assert.equal(clock('2020-11-01T19:00:00Z').toISOString(), '2020-11-01T19:00:00.000Z'));
test('invalid clock normalized by JavaScript is rejected', () => assert.throws(() => clock('2020-02-30T19:00:00Z')));
test('rate by hour uses exact decimals and confirmed duration', () => assert.equal(calculateAmount(rate(), 5400, 3600).toString(), '300000'));
test('scheduled basis is explicit', () => assert.equal(calculateAmount(rate({ duration_basis: 'scheduled' }), 5400, 3600).toString(), '200000'));
test('session base independent of stream duration', () => assert.equal(calculateAmount(rate({ pay_basis: 'session' }), 5400, 3600).toString(), '200000'));
test('round per item half-up VND', () => assert.equal(calculateAmount(rate({ amount: '1' }), 1800, 3600).toString(), '1'));
test('missing hour duration does not become zero pay', () => assert.throws(() => calculateAmount(rate(), 0, 3600)));
test('missing and ambiguous rates are blocking', () => { assert.throws(() => resolveRate([], {}, day('2020-11-01'))); assert.throws(() => resolveRate([rate(), rate({ id: 2 })], { role: 'teacher' }, day('2020-11-01'))); });
test('rate resolution honors dimensions priority and effective date', () => {
    const chosen = resolveRate([rate(), rate({ id: 2, priority: 10, dimensions: { role: 'teacher', teacher_profile_id: 1 } }), rate({ id: 3, priority: 100, valid_from: '2021-01-01' })], { role: 'teacher', teacher_profile_id: 1 }, day('2020-11-01'));
    assert.equal(chosen.id, 2);
});
test('effective end is exclusive', () => assert.throws(() => resolveRate([rate({ valid_to: '2020-11-01' })], { role: 'teacher' }, day('2020-11-01'))));
test('dimensions validate boolean and unknown fields', () => { assert.throws(() => normalizeDimensions({ is_substitute: 'false' })); assert.throws(() => normalizeDimensions({ subject_id: 2 })); assert.equal(normalizeDimensions({ is_substitute: false }).is_substitute, false); });
test('money rejects overflow, NaN and unrequested negatives', () => { for (const v of ['NaN', 'Infinity', '1e6', '-1', '1000000000000'])
    assert.throws(() => money(v)); assert.equal(money('-1', true).toString(), '-1'); });
test('frozen source hash includes teacher, lifecycle and key, independent of object key order', () => {
    const c = { id: 1, key: 'original', teacher: 'A', lesson_status: 0, start_time: day('2020-01-01') };
    assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
    for (const patch of [{ teacher: 'B' }, { key: 'new' }, { deleted_at: day('2020-01-02') }, { lesson_status: 1 }])
        assert.notEqual(hash(sourceShape(c)), hash(sourceShape({ ...c, ...patch })));
});
test('historical inactive profile resolves, ambiguous names require manual resolution', () => {
    const p = [{ id: 1, username: 'a', display_name: 'Same', status: 0 }, { id: 2, username: 'b', display_name: 'Same', status: 1 }];
    assert.equal(resolveProfile(p, 'Same'), null);
    assert.equal(resolveProfile(p, 'a').id, 1);
});
for (const [state, action, paid] of [['paid', 'reopen', true], ['draft', 'approve', false], ['approved', 'reopen', true], ['pending_review', 'submit', false]])
    test(`invalid transition ${state}/${action}`, () => assert.throws(() => stateAction(state as string, action as string, paid as boolean)));
test('approve review and return workflow', () => { assert.equal(stateAction('draft', 'submit', false), 'pending_review'); assert.equal(stateAction('pending_review', 'approve', false), 'approved'); assert.equal(stateAction('approved', 'reopen', false), 'draft'); });
test('all source scopes required, not one matching code', () => { const u = { userId: 1, username: 'x', permissions: ['salary.view'], programScope: { mode: 'RESTRICTED', programs: ['A'] } }; assert.throws(() => check(u, 'salary.view', ['A', 'B'])); check(u, 'salary.view', ['A']); });
test('pagination does not compute aggregates from one page and disallows arbitrary sort', () => { assert.equal(paginate([{ id: 1, name: 'B' }, { id: 2, name: 'A' }], { limit: 1 }, ['name'], 'name').pagination.total, 2); assert.throws(() => paginate([], { sort: 'DROP' }, ['name'], 'name')); });

test('retry MySQL raw deadlocks and lock timeouts, but not other SQL failures', () => {
    for (const e of [{code:'P2034'}, {code:'P2010',meta:{code:'1213'}}, {code:'P2010',meta:{code:1205}}]) assert.equal(retryableTransactionError(e), true);
    for (const e of [null, {code:'P2002'}, {code:'P2010',meta:{code:'1146'}}, {code:'P2010'}]) assert.equal(retryableTransactionError(e), false);
});
