import { Router, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import prisma from '../../lib/prisma';
import auth from '../auth/auth.middleware';
import ApiError from '../../utils/ApiError';
import { prepareJevDraft } from './jev.draft';
import { createJevPolicyDraft, replaceJevPolicyDraft, cloneJevPolicyDraft, publishJevPolicy,
  compileCompactJevVersion } from './vendor/chat-jev/compact-policy-store';
import { bindJevPolicy } from './vendor/chat-jev/policy-database';
import { updateJevRuntimeSettings } from './vendor/chat-jev/runtime-settings';
import { compileJevSettings } from './vendor/chat-jev/config';
import { JevPolicyValidationError } from './vendor/chat-jev/dynamic-policy';
import { callJevChat, reloadAfterCommit } from './jev.bridge';
import { createL1AdminRoutes } from './l1.routes';
import { compileJevDeploymentSeed } from './vendor/chat-jev/deployment-seed';
import { createJevCompactBundle } from './vendor/chat-jev/compact-contract';

const uint = z.number().int().positive().max(4294967295);
const revision = uint.max(4294967294);
const identity = { policyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), revision: uint };
const saveSchema = z.object({ expectedEditRevision: revision, config: z.unknown().refine(v => v !== undefined, 'Thiếu bundle cấu hình') }).strict();
const bindSchema = z.object({ scopeType: z.enum(['GLOBAL', 'CODE', 'CALENDAR']), scopeKey: z.string().min(1).max(100),
  mode: z.enum(['off', 'shadow', 'enforce', 'inherit']), policyVersionId: uint.nullable(),
  expectedRevision: z.number().int().min(0).max(4294967294) }).strict();
export const jevPermissions = ['jev.view', 'jev.edit', 'jev.publish', 'jev.bind', 'jev.runtime'] as const;

// Policies and GLOBAL settings affect all programs: a restricted account cannot manage these.
export const requireJevGlobalAccess: RequestHandler = (req, res, next) => {
  if (req.user?.roles?.includes('admin') || req.user?.programScope?.mode === 'ALL') return next();
  res.status(403).json({ success: false, message: 'Cấu hình JEV yêu cầu quyền trên toàn bộ Chương trình' });
};

export function createJevAdminRoutes(db = prisma, bridge = callJevChat) {
  const router = Router();
  router.use(auth.authenticate, requireJevGlobalAccess);
  router.use('/l1', createL1AdminRoutes(db));
  const guard = (permission: string) => auth.authorize([permission]);
  const actor = (req: Express.Request) => `admin:${String(req.user.userId)}`;
  const id = (value: unknown) => uint.parse(Number(value));
  const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); } catch (error: any) {
      if (error instanceof ZodError) { res.status(400).json({ success: false, message: 'Dữ liệu JEV không hợp lệ', issues: error.issues.map(i => ({ path: i.path, message: i.message })) }); return; }
      if (error instanceof JevPolicyValidationError) { res.status(422).json({ success: false, message: 'Bộ cấu hình chưa hợp lệ', issues: error.issues }); return; }
      const code = String(error?.message || '');
      if (/CONFLICT|IMMUTABLE/.test(code) || error?.code === 'P2002' || error?.code === 'P2034') {
        res.status(409).json({ success: false, message: 'Cấu hình đã thay đổi hoặc bản phát hành chỉ được đọc. Tải lại để so sánh trước khi lưu.', code: /^(JEV_)[A-Z_]+$/.test(code) ? code : 'JEV_CONFLICT' }); return;
      }
      if (error?.code === 'P2025') { res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình JEV' }); return; }
      if (/^(INVALID_JEV_|JEV_)/.test(code)) { res.status(422).json({ success: false, message: 'Cấu hình JEV không vượt qua kiểm tra', code }); return; }
      next(error instanceof ApiError ? error : new ApiError('Không thể xử lý cấu hình JEV; kiểm tra DB và migration Chat', 503));
    }
  };
  const sync = () => reloadAfterCommit(() => bridge('reload', {}));
  const calendarSelect = { id: true, code: true, learn_number: true, lesson_name: true, start_time: true, end_time: true } as const;
  router.get('/scope/programs', guard('jev.view'), run(async (req, res) => {
    const q = z.string().trim().max(30).default('').parse(req.query.q);
    const rows = await db.calendar.groupBy({ by: ['code'], where: { deleted_at: null, ...(q ? { code: { startsWith: q } } : {}) }, orderBy: { code: 'asc' }, take: 30 });
    res.json({ success: true, data: rows });
  }));
  router.get('/scope/calendars', guard('jev.view'), run(async (req, res) => {
    const code = z.string().trim().min(1).max(30).parse(req.query.code);
    const q = z.string().trim().max(100).default('').parse(req.query.q);
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const lessonNumber = /^\d{1,9}$/.test(q) ? Number(q) : null;
    const rows = await db.calendar.findMany({
      where: { code, deleted_at: null, ...(q ? { OR: [{ lesson_name: { contains: q } }, ...(lessonNumber === null ? [] : [{ learn_number: lessonNumber }])] } : {}) },
      select: calendarSelect, orderBy: [{ start_time: 'desc' }, { id: 'desc' }], skip: (page - 1) * 30, take: 31,
    });
    res.json({ success: true, data: { rows: rows.slice(0, 30), page, hasMore: rows.length > 30 } });
  }));
  router.get('/scope/calendars/:calendarId', guard('jev.view'), run(async (req, res) => {
    const row = await db.calendar.findFirst({ where: { id: id(req.params.calendarId), deleted_at: null }, select: calendarSelect });
    if (!row) throw new ApiError('Không tìm thấy lịch học hoặc lịch đã bị xóa', 404);
    res.json({ success: true, data: row });
  }));
  router.get('/policies', guard('jev.view'), run(async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
    const [rows, total] = await db.$transaction([
      db.chat_jev_policy_versions.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { id: 'desc' },
        select: { id: true, policy_key: true, revision: true, edit_revision: true, status: true, bundle_hash: true, published_at: true, updated_at: true } }),
      db.chat_jev_policy_versions.count(),
    ]);
    res.json({ success: true, data: { rows, total, page, limit } });
  }));
  router.get('/policies/:id', guard('jev.view'), run(async (req, res) => {
    const row = await db.chat_jev_policy_versions.findUniqueOrThrow({ where: { id: id(req.params.id) } });
    res.json({ success: true, data: row });
  }));
  router.post('/policies', guard('jev.edit'), run(async (req, res) => {
    const input = z.object({ ...identity, config: z.unknown().refine(v => v !== undefined, 'Thiếu bundle cấu hình') }).strict().parse(req.body);
    const data = await createJevPolicyDraft(db, { ...input, config: prepareJevDraft(input.config, input.policyKey, input.revision), actor: actor(req) });
    res.status(201).json({ success: true, data });
  }));
  router.post('/policies/from-template', guard('jev.edit'), run(async (req, res) => {
    const input = z.object({ ...identity, sourcePolicyId: uint.optional() }).strict().parse(req.body);
    let data;
    if (input.sourcePolicyId !== undefined) {
      data = await cloneJevPolicyDraft(db, { id: input.sourcePolicyId, policyKey: input.policyKey, revision: input.revision, actor: actor(req) });
    } else {
      // Genuine Live deployment seed, compiled without running seed or changing GLOBAL/runtime.
      const { policy, rubric } = compileJevDeploymentSeed();
      const config = prepareJevDraft(createJevCompactBundle(policy, rubric.runtime).config, input.policyKey, input.revision);
      data = await createJevPolicyDraft(db, { policyKey: input.policyKey, revision: input.revision, actor: actor(req), config });
    }
    res.status(201).json({ success: true, data });
  }));
  router.put('/policies/:id', guard('jev.edit'), run(async (req, res) => {
    const input = saveSchema.parse(req.body);
    const stored = await db.chat_jev_policy_versions.findUniqueOrThrow({ where: { id: id(req.params.id) } });
    const data = await replaceJevPolicyDraft(db, { ...input, config: prepareJevDraft(input.config, stored.policy_key, stored.revision), id: id(req.params.id), actor: actor(req) });
    res.json({ success: true, data });
  }));
  router.post('/policies/:id/clone', guard('jev.edit'), run(async (req, res) => {
    const input = z.object(identity).strict().parse(req.body);
    res.status(201).json({ success: true, data: await cloneJevPolicyDraft(db, { ...input, id: id(req.params.id), actor: actor(req) }) });
  }));
  router.post('/policies/:id/validate', guard('jev.view'), run(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const row = await db.chat_jev_policy_versions.findUniqueOrThrow({ where: { id: id(req.params.id) } });
    const compiled = compileCompactJevVersion(row);
    res.json({ success: true, data: { valid: true, bundleHash: compiled.bundleHash, policyHash: compiled.hash, rubricHash: compiled.rubricHash, externalCalls: 0 } });
  }));
  router.post('/policies/:id/publish', guard('jev.publish'), run(async (req, res) => {
    const input = z.object({ expectedEditRevision: revision }).strict().parse(req.body);
    const data = await publishJevPolicy(db, { ...input, id: id(req.params.id), actor: actor(req) });
    res.json({ success: true, data });
  }));
  router.get('/bindings', guard('jev.view'), run(async (_req, res) => {
    // Includes inactive/tombstone rows for CAS; bounded pages avoid unbounded config reads.
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(_req.query.page);
    const [rows, total] = await db.$transaction([
      db.chat_jev_bindings.findMany({ orderBy: [{ scope_type: 'asc' }, { scope_key: 'asc' }], skip: (page - 1) * 100, take: 100 }),
      db.chat_jev_bindings.count(),
    ]);
    const calendarIds = rows.filter(row => row.scope_type === 'CALENDAR' && /^[1-9]\d{0,9}$/.test(row.scope_key)).map(row => Number(row.scope_key));
    const calendars = calendarIds.length ? await db.calendar.findMany({ where: { id: { in: calendarIds }, deleted_at: null }, select: calendarSelect }) : [];
    const byId = new Map(calendars.map(row => [String(row.id), row]));
    res.json({ success: true, data: { rows: rows.map(row => ({ ...row, ...(row.scope_type === 'CALENDAR' ? { calendar: byId.get(row.scope_key) ?? null } : {}) })), total, page, limit: 100 } });
  }));
  router.put('/bindings', guard('jev.bind'), run(async (req, res) => {
    const input = bindSchema.parse(req.body);
    const data = await bindJevPolicy(db, { ...input, actor: actor(req) });
    res.json({ success: true, data, sync: await sync() });
  }));
  router.get('/runtime', guard('jev.view'), run(async (_req, res) => {
    const row = await db.chat_jev_bindings.findUnique({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } });
    if (!row) throw new ApiError('Chưa có GLOBAL; chạy seed ở repo Chat trước', 422);
    res.json({ success: true, data: { revision: row.revision, settings: row.runtime_json } });
  }));
  router.put('/runtime', guard('jev.runtime'), run(async (req, res) => {
    const input = z.object({ expectedRevision: revision, settings: z.record(z.unknown()) }).strict().parse(req.body);
    // Revision comes from the GLOBAL row, never an independently editable JSON field.
    if (Object.hasOwn(input.settings, 'revision')) throw new ApiError('Không đặt revision trong settings', 400);
    const settings = compileJevSettings({ ...input.settings, revision: input.expectedRevision + 1 });
    const data = await updateJevRuntimeSettings(db, { expectedRevision: input.expectedRevision, settings, actor: actor(req) });
    res.json({ success: true, data, sync: await sync() });
  }));
  router.get('/status', guard('jev.view'), run(async (_req, res) => { res.json({ success: true, data: await bridge('status') }); }));
  router.post('/reload', guard('jev.runtime'), run(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    res.json({ success: true, data: await sync() });
  }));
  router.post('/preview', guard('jev.view'), run(async (req, res) => {
    // Upstream validates the complete synthetic payload; a draft ID is mandatory here.
    const body = z.object({ policyVersionId: uint }).passthrough().parse(req.body);
    if ('calendarId' in body || 'code' in body) throw new ApiError('Preview Admin sử dụng ID bộ cấu hình', 400);
    res.json({ success: true, data: await bridge('preview', body) });
  }));
  return router;
}
export default createJevAdminRoutes();
