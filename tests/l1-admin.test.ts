import assert from 'node:assert/strict';
import test from 'node:test';
import { lexiconInput, normalizeLexicon, mutateL1, previewL1 } from '../src/modules/jev/l1.service';
import { getActiveShortSafePhrases } from '../src/modules/jev/vendor/chat-l1/short-safe';
import { synchronizeL1 } from '../src/modules/jev/l1.bridge';

test('L1 normalizes the original Live inputs and assigns categories from list type', () => {
  const blacklist = normalizeLexicon(lexiconInput.parse({ listType: 'BLACKLIST', matchMode: 'BOUNDED', pattern: ' DMM ', isActive: true, category: 'WRONG' }));
  assert.equal(blacklist.pattern, 'dmm'); assert.equal(blacklist.category, 'PROFANITY');
  const whitelist = normalizeLexicon(lexiconInput.parse({ listType: 'WHITELIST', matchMode: 'EXACT_PHRASE', pattern: ' Dạ   vâng ạ ', isActive: false }));
  assert.equal(whitelist.pattern, 'dạ vâng ạ'); assert.equal(whitelist.category, 'SHORT_SAFE'); assert.equal(whitelist.is_active, 0);
  for (const pattern of ['a', 'abcdef', 'd_m_m', '.*']) assert.throws(() => normalizeLexicon(lexiconInput.parse({ listType: 'BLACKLIST', matchMode: 'BOUNDED', pattern, isActive: true })));
  assert.throws(() => normalizeLexicon(lexiconInput.parse({ listType: 'WHITELIST', matchMode: 'LITERAL', pattern: 'valid', isActive: true })));
});

test('stale L1 revisions fail after locking GLOBAL and before any write', async () => {
  let changed = false, locked = false;
  const db: any = { $transaction: async (fn: any) => fn({ $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join('?'), /FOR UPDATE/); locked = true; return [{ id: 1, revision: 3 }];
  } }) };
  await assert.rejects(mutateL1(db, 2, 'admin:1', async () => { changed = true; }), (error: any) => error.statusCode === 409);
  assert.equal(locked, true); assert.equal(changed, false);
});

test('L1 preview reads saved lists without writes and restores the isolated matcher', async () => {
  const before = getActiveShortSafePhrases();
  const db: any = { $transaction: async (fn: any) => fn({
    chat_l1_settings: { findFirst: async () => ({ revision: 3, mode: 'off' }) },
    chat_l1_lexicon: { findMany: async () => [{ list_type: 'WHITELIST', match_mode: 'EXACT_PHRASE', pattern: 'câu thử riêng' }] },
  }) };
  const result = await previewL1(db, 'câu thử riêng', 'enforce');
  assert.equal(result.decision.reviewRoute, 'SHORT_SAFE'); assert.equal(result.decision.appliedAction, 'NONE');
  assert.equal(result.configuredMode, 'off'); assert.equal(result.externalCalls, 0);
  assert.deepEqual(getActiveShortSafePhrases(), before);
});

test('L1 reload confirmation checks source/revision and preserves saved-but-unconfirmed state', async () => {
  assert.equal((await synchronizeL1(3, async () => ({ policy: { source: 'database', revision: 3 } }))).confirmed, true);
  assert.equal((await synchronizeL1(3, async () => ({ policy: { source: 'database', revision: 2 } }))).confirmed, false);
  assert.equal((await synchronizeL1(3, async () => ({ policy: { source: 'fallback', revision: 3 } }))).confirmed, false);
  const failed = await synchronizeL1(3, async () => { throw Error('private upstream details'); });
  assert.equal(failed.confirmed, false); assert.match(failed.message, /Đã lưu/); assert.doesNotMatch(JSON.stringify(failed), /private upstream details/);
});
