import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import auth from '../src/modules/auth/auth.middleware';
import { createJevAdminRoutes } from '../src/modules/jev/jev.routes';
import { callJevChat, reloadAfterCommit } from '../src/modules/jev/jev.bridge';
import { prepareJevDraft } from '../src/modules/jev/jev.draft';
import { compileJevCompactBundle } from '../src/modules/jev/vendor/chat-jev/compact-contract';
import { createJevPolicyDraft, replaceJevPolicyDraft, publishJevPolicy } from '../src/modules/jev/vendor/chat-jev/compact-policy-store';
import { bindJevPolicy } from '../src/modules/jev/vendor/chat-jev/policy-database';
import { defaultJevSettings, compileJevSettings } from '../src/modules/jev/vendor/chat-jev/config';
import { updateJevRuntimeSettings } from '../src/modules/jev/vendor/chat-jev/runtime-settings';
const seed = JSON.parse(readFileSync(new URL('./fixtures/jev-c2-r2.json', import.meta.url), 'utf8'));
const clone = (v: any) => JSON.parse(JSON.stringify(v));
const who = (permissions: string[], mode = 'ALL') => ({ userId: 7, roles: [], permissions, programScope: { mode, programs: [] } });

function database() {
  let policy: any = { id: 3, policy_key: 'classroom-en-c2', revision: 2, edit_revision: 1, status: 'DRAFT', config_json: clone(seed) };
  let global: any = { id: 1, scope_type: 'GLOBAL', scope_key: '*', revision: 1, mode: 'off', policy_version_id: null,
    runtime_json: (() => { const { revision, ...v } = defaultJevSettings(); return clone(v); })() };
  let writes = 0;
  const tx: any = {
    chat_jev_policy_versions: {
      findUniqueOrThrow: async () => clone(policy), findMany: async () => [],
      create: async ({ data }: any) => { writes++; return { id: 4, ...data }; },
      updateMany: async ({ where, data }: any) => {
        if (policy.status !== where.status || policy.edit_revision !== where.edit_revision) return { count: 0 };
        writes++; policy = { ...policy, ...data }; return { count: 1 };
      },
    },
    chat_jev_bindings: { findUnique: async () => clone(global), findUniqueOrThrow: async () => clone(global) },
    $queryRaw: async () => [],
    $executeRaw: async (strings: TemplateStringsArray, ...args: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('chat_jev_policy_versions')) {
        assert.match(sql, /WHERE id=\? AND status='DRAFT' AND edit_revision=\?/);
        if (policy.status !== 'DRAFT' || policy.edit_revision !== args[2]) return 0;
        writes++; policy.config_json = JSON.parse(args[0]); policy.edit_revision++; return 1;
      }
      assert.match(sql, /revision=\?/);
      if (sql.includes('runtime_json=')) {
        if (global.revision !== args[2]) return 0;
        global.runtime_json = JSON.parse(args[0]);
      } else {
        if (global.revision !== args[5]) return 0;
        global.mode = args[0]; global.policy_version_id = args[1];
      }
      writes++; global.revision++; return 1;
    },
  };
  const db: any = { ...tx, $transaction: async (fn: any) => typeof fn === 'function' ? fn(tx) : Promise.all(fn) };
  return { db, get policy() { return policy; }, get global() { return global; }, get writes() { return writes; } };
}

test('C2 r2 bundle compiles identically after MySQL JSON key reordering; guide edit recalculates rubric hash', () => {
  const compiled = compileJevCompactBundle(seed);
  const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
  assert.equal(compileJevCompactBundle(reorder(seed)).bundleHash, compiled.bundleHash);
  const edited = clone(seed); edited.rubric.questions.category.instructions += ' Clarify the current message.';
  const next = prepareJevDraft(reorder(edited), 'classroom-en-c2', 3);
  const result = compileJevCompactBundle(next);
  assert.notEqual(result.rubricHash, compiled.rubricHash);
  assert.equal(result.policy.version, 'classroom-en-c2:r3');
  assert.notEqual(result.bundleHash, compiled.bundleHash);
  const broken = clone(seed); broken.policy.framework.categories[0].definition += ' Changed meaning.';
  assert.throws(() => compileJevCompactBundle(prepareJevDraft(broken, 'classroom-en-c2', 3)));
});

test('draft CAS rejects stale edits and published content cannot be overwritten', async () => {
  const d = database();
  await replaceJevPolicyDraft(d.db, { id: 3, expectedEditRevision: 1, actor: 'admin:7', config: seed });
  await assert.rejects(replaceJevPolicyDraft(d.db, { id: 3, expectedEditRevision: 1, actor: 'admin:8', config: seed }), /CONFLICT/);
  assert.equal(d.writes, 1);
  await publishJevPolicy(d.db, { id: 3, expectedEditRevision: 2, actor: 'admin:7' });
  assert.equal(d.policy.status, 'PUBLISHED'); assert.match(d.policy.bundle_hash, /^[a-f0-9]{64}$/);
  await assert.rejects(replaceJevPolicyDraft(d.db, { id: 3, expectedEditRevision: 2, actor: 'admin:7', config: seed }), /CONFLICT/);
  await assert.rejects(publishJevPolicy(d.db, { id: 3, expectedEditRevision: 2, actor: 'admin:7' }), /IMMUTABLE/);
});

test('incomplete drafts save but cannot publish, and bind requires a published policy', async () => {
  const d = database(); const incomplete = clone(seed); incomplete.policy.rules = [];
  await createJevPolicyDraft(d.db, { policyKey: 'test', revision: 1, actor: 'admin:7', config: incomplete });
  await assert.rejects(bindJevPolicy(d.db, { scopeType: 'GLOBAL', scopeKey: '*', expectedRevision: 1, mode: 'shadow', policyVersionId: 3, actor: 'admin:7' }), /INVALID_JEV/);
  await replaceJevPolicyDraft(d.db, { id: 3, expectedEditRevision: 1, actor: 'admin:7', config: incomplete });
  await assert.rejects(publishJevPolicy(d.db, { id: 3, expectedEditRevision: 2, actor: 'admin:7' }));
  assert.equal(d.policy.status, 'DRAFT');
});

test('GLOBAL runtime and default binding share CAS; neither overwrites the other form', async () => {
  const d = database();
  await bindJevPolicy(d.db, { scopeType: 'GLOBAL', scopeKey: '*', mode: 'off', policyVersionId: null, expectedRevision: 1, actor: 'admin:7' });
  await assert.rejects(updateJevRuntimeSettings(d.db, { expectedRevision: 1, actor: 'admin:7', settings: { ...defaultJevSettings(), revision: 2, mode: 'shadow' } }), /CONFLICT/);
  await updateJevRuntimeSettings(d.db, { expectedRevision: 2, actor: 'admin:7', settings: { ...defaultJevSettings(), revision: 3, mode: 'shadow' } });
  assert.equal(d.global.mode, 'off'); assert.equal(d.global.runtime_json.mode, 'shadow'); assert.equal(d.global.revision, 3);
  await assert.rejects(bindJevPolicy(d.db, { scopeType: 'GLOBAL', scopeKey: '*', mode: 'off', policyVersionId: null, expectedRevision: 2, actor: 'admin:7' }), /CONFLICT/);
  assert.throws(() => compileJevSettings({ ...defaultJevSettings(), limits: { ...defaultJevSettings().limits, httpTimeoutMs: 3001 } }));
  assert.throws(() => compileJevSettings({ ...defaultJevSettings(), limits: { ...defaultJevSettings().limits, httpTimeoutMs: 1500, deadlineMs: 1000 } }));
});

test('bridge only calls fixed internal paths, carries secret on server and rejects redirects', async () => {
  let seen: any;
  const send = (async (url: any, options: any) => { seen = { url: String(url), options }; return new Response(JSON.stringify({ success: true, runtimeStatus: { mode: 'off' } })); }) as typeof fetch;
  const result = await callJevChat('status', undefined, { JEV_CHAT_API_URL: 'http://chat:3001', JEV_INTERNAL_API_SECRET: 'private-value' }, send);
  assert.equal(seen.url, 'http://chat:3001/api/internal/jev-policy/status');
  assert.equal(seen.options.headers['x-internal-secret'], 'private-value'); assert.equal(seen.options.redirect, 'error');
  assert.ok(!JSON.stringify(result).includes('private-value'));
  await assert.rejects(callJevChat('status', undefined, { JEV_CHAT_API_URL: 'http://user:password@chat', JEV_INTERNAL_API_SECRET: 'x' }, send));
  await assert.rejects(callJevChat('status', undefined, { JEV_CHAT_API_URL: 'http://chat' }, send));
  const failed = await reloadAfterCommit(async () => { throw Error('secret or network detail'); });
  assert.equal(failed.confirmed, false); assert.match(failed.message, /Đã lưu/); assert.ok(!JSON.stringify(failed).includes('secret'));
  assert.equal((await reloadAfterCommit(async () => ({ success: true, notified: false }))).confirmed, false);
});

test('HTTP checks authentication, separate permissions and global program access before DB/Chat operations', async () => {
  const original = auth.authenticate;
  auth.authenticate = async (req, res, next) => { if (!req.user) { res.status(401).json({ success: false }); return; } next(); };
  let chatCalls = 0;
  const d = database();
  try {
    const router = createJevAdminRoutes(d.db, async () => { chatCalls++; return { success: true, notified: true }; });
    const request = (method: string, path: string, user?: any, body: any = {}) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req: any = { method, url: path, originalUrl: path, baseUrl: '', params: {}, query: {}, user, body };
      const res: any = { statusCode: 200, status(v: number) { this.statusCode = v; return this; }, json(v: any) { resolve({ status: this.statusCode, body: v }); } };
      (router as any).handle(req, res, (e: any) => e ? resolve({ status: e.statusCode || 500, body: {} }) : reject(Error('Unmatched route')));
    });
    assert.equal((await request('GET', '/status')).status, 401);
    assert.equal((await request('GET', '/status', who([]))).status, 403);
    assert.equal((await request('GET', '/status', who(['*'], 'RESTRICTED'))).status, 403);
    assert.equal((await request('GET', '/status', who(['jev.view']))).status, 200);
    assert.equal(chatCalls, 1);
    assert.equal((await request('POST', '/reload', who(['jev.view']))).status, 403);
    assert.equal((await request('POST', '/policies/3/publish', who(['jev.edit']), { expectedEditRevision: 1 })).status, 403);
    assert.equal((await request('PUT', '/runtime', who(['jev.bind']), { expectedRevision: 1, settings: {} })).status, 403);
    assert.equal((await request('POST', '/preview', who(['jev.view']), { policyVersionId: 3, calendarId: 1 })).status, 400);
    assert.equal((await request('PUT', '/policies/3', who(['jev.edit']), { expectedEditRevision: 0, config: seed })).status, 400);
    assert.equal(d.writes, 0);
    const stale = await request('PUT', '/policies/3', who(['jev.edit']), { expectedEditRevision: 2, config: seed });
    assert.equal(stale.status, 409); assert.equal(d.writes, 0);
    const valid = await request('PUT', '/policies/3', who(['jev.edit']), { expectedEditRevision: 1, config: seed });
    assert.equal(valid.status, 200); assert.equal(valid.body.data.edit_revision, 2);
    assert.equal(chatCalls, 1); // Draft edits do not reload or call the provider.
  } finally { auth.authenticate = original; }
});

test('scope lookups require JEV access, exclude deleted calendars and retain distinct schedules for the same lesson', async () => {
  const original = auth.authenticate;
  auth.authenticate = async (req, res, next) => { if (!req.user) { res.status(401).json({ success: false }); return; } next(); };
  const d = database();
  const calls: any[] = [];
  const schedules = [101, 102].map((id, index) => ({ id, code: 'qa-program', learn_number: 2, lesson_name: 'Same lesson', start_time: `2026-11-${17 + index}T18:00:00Z`, end_time: `2026-11-${17 + index}T19:00:00Z` }));
  d.db.calendar = {
    groupBy: async (args: any) => { calls.push({ type: 'programs', args }); return [{ code: 'qa-program' }]; },
    findMany: async (args: any) => { calls.push({ type: 'calendars', args }); return args.where.id ? schedules : [...schedules, ...Array.from({ length: 29 }, (_, i) => ({ ...schedules[0], id: 200 + i }))]; },
    findFirst: async (args: any) => { calls.push({ type: 'detail', args }); return schedules.find(row => row.id === args.where.id) ?? null; },
  };
  try {
    const router = createJevAdminRoutes(d.db, async () => { throw Error('Lookups must not call Chat'); });
    const get = (path: string, query: any = {}, user: any = who(['jev.view'])) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req: any = { method: 'GET', url: path, originalUrl: path, baseUrl: '', params: {}, query, user };
      const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); } };
      (router as any).handle(req, res, (error: any) => error ? resolve({ status: error.statusCode || 500, body: {} }) : reject(Error('Unmatched route')));
    });
    assert.equal((await get('/scope/programs', {}, null)).status, 401);
    assert.equal((await get('/scope/programs', {}, who([]))).status, 403);
    assert.equal((await get('/scope/programs', {}, who(['jev.view'], 'RESTRICTED'))).status, 403);
    assert.equal(calls.length, 0);
    const programs = await get('/scope/programs', { q: ' qa- ' });
    assert.equal(programs.status, 200); assert.deepEqual(programs.body.data, [{ code: 'qa-program' }]);
    assert.deepEqual(calls[0].args.where, { deleted_at: null, code: { startsWith: 'qa-' } });
    assert.equal(calls[0].args.take, 30);
    assert.equal((await get('/scope/calendars')).status, 400);
    assert.equal((await get('/scope/calendars', { code: 'qa-program', page: '-1' })).status, 400);
    const list = await get('/scope/calendars', { code: 'qa-program', q: '2', page: '2' });
    assert.equal(list.status, 200); assert.equal(list.body.data.rows.length, 30); assert.equal(list.body.data.hasMore, true);
    assert.notEqual(list.body.data.rows[0].id, list.body.data.rows[1].id);
    assert.equal(list.body.data.rows[0].learn_number, list.body.data.rows[1].learn_number);
    const args = calls.at(-1).args;
    assert.equal(args.where.deleted_at, null); assert.equal(args.where.code, 'qa-program'); assert.equal(args.skip, 30); assert.equal(args.take, 31);
    assert.deepEqual(args.where.OR, [{ lesson_name: { contains: '2' } }, { learn_number: 2 }]);
    assert.deepEqual(Object.keys(args.select).sort(), ['code', 'end_time', 'id', 'learn_number', 'lesson_name', 'start_time']);
    assert.equal((await get('/scope/calendars/101')).body.data.id, 101);
    assert.equal((await get('/scope/calendars/999')).status, 404);
    assert.equal((await get('/scope/calendars/invalid')).status, 400);
    d.db.chat_jev_bindings.findMany = async () => [{ id: 1, scope_type: 'CALENDAR', scope_key: '101', revision: 1, mode: 'off' }];
    d.db.chat_jev_bindings.count = async () => 1;
    const beforeList = calls.length;
    const bound = await get('/bindings');
    assert.equal(bound.status, 200); assert.equal(bound.body.data.rows[0].calendar.id, 101);
    assert.equal(calls.length, beforeList + 1);
    assert.deepEqual(calls.at(-1).args.where, { id: { in: [101] }, deleted_at: null });
    assert.equal(d.writes, 0);
  } finally { auth.authenticate = original; }
});

test('creating from an existing policy or genuine Live template creates only a draft and keeps source/runtime unchanged', async () => {
  const originalAuth = auth.authenticate;
  auth.authenticate = async (req, res, next) => { if (!req.user) { res.status(401).json({ success: false }); return; } next(); };
  const d = database(), created: any[] = [];
  d.db.chat_jev_policy_versions.create = async ({ data }: any) => { created.push(clone(data)); return { id: 4 + created.length, status: 'DRAFT', edit_revision: 1, ...data }; };
  const originalPolicy = clone(d.policy), originalGlobal = clone(d.global);
  try {
    const router = createJevAdminRoutes(d.db, async () => { throw Error('Creation must not reload or call Live'); });
    const request = (user: any, body: any) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req: any = { method: 'POST', url: '/policies/from-template', originalUrl: '/policies/from-template', baseUrl: '', params: {}, query: {}, user, body };
      const res: any = { statusCode: 200, status(v: number) { this.statusCode = v; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); } };
      (router as any).handle(req, res, (error: any) => error ? resolve({ status: error.statusCode || 500, body: {} }) : reject(Error('Unmatched route')));
    });
    const identity = { policyKey: 'new-policy', revision: 1 };
    assert.equal((await request(null, identity)).status, 401);
    assert.equal((await request(who(['jev.view']), identity)).status, 403);
    assert.equal((await request(who(['jev.edit'], 'RESTRICTED'), identity)).status, 403);
    assert.equal((await request(who(['jev.edit']), { ...identity, actor: 'someone-else' })).status, 400);
    assert.equal(created.length, 0);
    const existing = await request(who(['jev.edit']), { ...identity, sourcePolicyId: 3 });
    assert.equal(existing.status, 201);
    assert.equal(existing.body.data.status, 'DRAFT');
    assert.equal(existing.body.data.created_by, 'admin:7');
    assert.equal(existing.body.data.config_json.policy.version, 'new-policy:r1');
    assert.deepEqual(existing.body.data.config_json.policy.rules, originalPolicy.config_json.policy.rules);
    assert.deepEqual(existing.body.data.config_json.rubric, originalPolicy.config_json.rubric);
    const live = await request(who(['jev.edit']), { policyKey: 'live-template-copy', revision: 2 });
    assert.equal(live.status, 201); assert.equal(live.body.data.status, 'DRAFT');
    const compiled = compileJevCompactBundle(live.body.data.config_json);
    assert.equal(compiled.policy.version, 'live-template-copy:r2');
    assert.equal(compiled.policy.framework?.categories.length, 7);
    assert.equal(created.length, 2);
    assert.deepEqual(d.policy, originalPolicy); assert.deepEqual(d.global, originalGlobal);
    assert.ok(created.every(data => !Object.hasOwn(data, 'status') && !Object.hasOwn(data, 'published_by')));
  } finally { auth.authenticate = originalAuth; }
});
