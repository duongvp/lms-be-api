import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProgramScopeFilter,
  isProgramAllowed,
  type AuthorizationUser,
} from '../src/services/authorization.service';

const user = (overrides: Partial<AuthorizationUser> = {}): AuthorizationUser => ({
  userId: 10,
  roles: ['manager'],
  permissions: ['calendar.view', 'calendar.update'],
  ...overrides,
});

test('legacy permission without policy remains unrestricted', () => {
  assert.equal(isProgramAllowed(user(), 'calendar.view', 'toan-7-2027'), true);
  assert.equal(getProgramScopeFilter(user(), 'calendar.view'), null);
});

test('global restricted scope applies to every functional permission', () => {
  const actor = user({
    programScope: { mode: 'RESTRICTED', programs: ['nguvan-6-2027'] },
  });
  assert.equal(isProgramAllowed(actor, 'calendar.update', 'nguvan-6-2027'), true);
  assert.equal(isProgramAllowed(actor, 'calendar.update', 'toan-7-2027'), false);
  assert.deepEqual(getProgramScopeFilter(actor, 'calendar.update'), ['nguvan-6-2027']);
});

test('function denial wins over a program configuration', () => {
  const actor = user({
    permissions: ['calendar.view'],
    programScope: { mode: 'RESTRICTED', programs: ['nguvan-6-2027'] },
  });
  assert.equal(isProgramAllowed(actor, 'calendar.delete', 'nguvan-6-2027'), false);
  assert.deepEqual(getProgramScopeFilter(actor, 'calendar.delete'), []);
});

test('DENY is empty and admin wildcard bypasses scope', () => {
  const denied = user({
    programScope: { mode: 'DENY', programs: [] },
  });
  assert.equal(isProgramAllowed(denied, 'calendar.view', 'nguvan-6-2027'), false);
  assert.deepEqual(getProgramScopeFilter(denied, 'calendar.view'), []);

  const admin = user({ permissions: ['*'], roles: ['admin'] });
  assert.equal(isProgramAllowed(admin, 'calendar.delete', 'any-program'), true);
  assert.equal(getProgramScopeFilter(admin, 'calendar.delete'), null);
});
