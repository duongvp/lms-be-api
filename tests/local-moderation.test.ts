import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assertLocalModerationUrl, localModerationPlan, moderationTables } from '../prisma/local-moderation/plan';
const root = new URL('../prisma/local-moderation/', import.meta.url);
const l1 = readFileSync(new URL('l1.sql', root), 'utf8'), jev = readFileSync(new URL('jev.sql', root), 'utf8');

test('local initializer rejects remote targets and every other local database', () => {
  assert.equal(assertLocalModerationUrl('mysql://dev:123456@localhost:3306/livestream_local'), 'mysql://dev:123456@localhost:3306/livestream_local');
  for (const url of ['mysql://dev:123456@42.115.41.6:3306/livestream', 'mysql://dev:123456@localhost:3306/other', 'mysql://dev:123456@localhost:3307/livestream_local', 'mysql://dev:123456@127.0.0.1:3306/livestream_local']) assert.throws(() => assertLocalModerationUrl(url));
});

test('DDL plan creates only missing Live moderation tables and never alters existing tables', () => {
  const all = localModerationPlan(l1, jev, new Set()); assert.equal(all.length, 6);
  for (const item of all) {
    assert.match(item.sql, /^CREATE TABLE/);
    assert.doesNotMatch(item.sql, /(?:^|;)\s*(?:ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/i);
  }
  assert.match(all.find(item => item.name === 'chat_jev_bindings')!.sql, /CONSTRAINT fk_jev_compact_binding_policy/);
  assert.match(all.find(item => item.name === 'chat_jev_audit_events')!.sql, /CONSTRAINT fk_jev_compact_audit_policy/);
  assert.equal(localModerationPlan(l1, jev, new Set(moderationTables)).length, 0);
  assert.deepEqual(localModerationPlan(l1, jev, new Set(moderationTables.filter(name => !name.startsWith('chat_l1_')))).map(item => item.name), ['chat_l1_settings', 'chat_l1_lexicon']);
  assert.throws(() => localModerationPlan('', jev, new Set()));
});
