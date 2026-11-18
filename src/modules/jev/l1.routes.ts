import { Router, type RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import auth from '../auth/auth.middleware';
import ApiError from '../../utils/ApiError';
import { lexiconInput, l1Mode, l1Revision, mutateL1, normalizeLexicon, previewL1 } from './l1.service';
import { callL1Chat, synchronizeL1 } from './l1.bridge';

// Mounted beneath the JEV authentication + GLOBAL scope gate.
export function createL1AdminRoutes(db: PrismaClient, bridge = callL1Chat) {
  const router = Router();
  const actor = (req: Express.Request) => `admin:${req.user.userId}`;
  const guard = (permission: string) => auth.authorize([permission]);
  const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); } catch (error: any) {
      if (error instanceof ZodError) { res.status(400).json({ success: false, message: 'Dữ liệu L1 không hợp lệ.', issues: error.issues }); return; }
      if (error instanceof ApiError) { next(error); return; }
      if (error?.code === 'P2002') { next(new ApiError('Mục từ điển đã tồn tại. Hãy tìm và sửa mục hiện có.', 409)); return; }
      if (error?.code === 'P2025') { next(new ApiError('Không tìm thấy mục từ điển.', 404)); return; }
      if (error?.code === 'P2034') { next(new ApiError('Cấu hình đang được chỉnh sửa. Tải lại rồi thử lại.', 409)); return; }
      if (error?.message === 'INVALID_CHAT_L1_DATABASE_POLICY') { next(new ApiError('Toàn bộ cấu hình L1 chưa hợp lệ hoặc vượt giới hạn. Thay đổi chưa được lưu.', 422)); return; }
      next(new ApiError('Không thể xử lý cấu hình L1; kiểm tra DB và các bảng Live.', 503));
    }
  };
  const settings = () => db.chat_l1_settings.findUnique({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } });
  router.get('/settings', guard('l1.view'), run(async (_req, res) => {
    const [data, counts] = await db.$transaction([
      db.chat_l1_settings.findUnique({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } }),
      db.chat_l1_lexicon.groupBy({ by: ['list_type', 'is_active'], _count: { _all: true } }),
    ]);
    if (!data) throw new ApiError('Chưa khởi tạo cấu hình L1 GLOBAL.', 422);
    res.json({ success: true, data: { ...data, counts } });
  }));
  router.get('/lexicon', guard('l1.view'), run(async (req, res) => {
    const query = z.object({ listType: z.enum(['BLACKLIST', 'WHITELIST']), q: z.string().trim().max(150).default(''),
      active: z.enum(['all', '1', '0']).default('all'), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
    const where = { list_type: query.listType, ...(query.q ? { pattern: { contains: query.q } } : {}),
      ...(query.active === 'all' ? {} : { is_active: Number(query.active) }) };
    const [rows, total] = await db.$transaction([
      db.chat_l1_lexicon.findMany({ where, orderBy: { id: 'desc' }, skip: (query.page - 1) * 20, take: 20 }),
      db.chat_l1_lexicon.count({ where }),
    ]);
    res.json({ success: true, data: { rows, total, page: query.page, limit: 20 } });
  }));
  router.put('/settings', guard('l1.runtime'), run(async (req, res) => {
    const input = z.object({ expectedRevision: l1Revision, mode: l1Mode }).strict().parse(req.body);
    const result = await mutateL1(db, input.expectedRevision, actor(req), tx => tx.chat_l1_settings.update({
      where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } }, data: { mode: input.mode } }));
    res.json({ success: true, ...result, sync: await synchronizeL1(result.revision, () => bridge('reload')) });
  }));
  const saveSchema = z.object({ expectedRevision: l1Revision, entry: lexiconInput }).strict();
  router.post('/lexicon', guard('l1.edit'), run(async (req, res) => {
    const input = saveSchema.parse(req.body), data = normalizeLexicon(input.entry);
    const result = await mutateL1(db, input.expectedRevision, actor(req), tx => tx.chat_l1_lexicon.create({ data: { ...data, created_by: actor(req) } }));
    res.status(201).json({ success: true, ...result, sync: await synchronizeL1(result.revision, () => bridge('reload')) });
  }));
  router.put('/lexicon/:id', guard('l1.edit'), run(async (req, res) => {
    const input = saveSchema.parse(req.body), data = normalizeLexicon(input.entry);
    const id = z.coerce.number().int().positive().max(4294967295).parse(req.params.id);
    const result = await mutateL1(db, input.expectedRevision, actor(req), tx => tx.chat_l1_lexicon.update({ where: { id }, data }));
    res.json({ success: true, ...result, sync: await synchronizeL1(result.revision, () => bridge('reload')) });
  }));
  router.post('/preview', guard('l1.view'), run(async (req, res) => {
    const input = z.object({ text: z.string().min(1).max(500), mode: l1Mode.default('enforce') }).strict().parse(req.body);
    res.json({ success: true, data: await previewL1(db, input.text, input.mode) });
  }));
  router.get('/status', guard('l1.view'), run(async (_req, res) => { res.json({ success: true, data: await bridge('status') }); }));
  router.post('/reload', guard('l1.runtime'), run(async (req, res) => {
    z.object({}).strict().parse(req.body ?? {});
    const current = await settings();
    if (!current) throw new ApiError('Chưa khởi tạo cấu hình L1 GLOBAL.', 422);
    res.json({ success: true, data: await synchronizeL1(current.revision, () => bridge('reload')) });
  }));
  return router;
}
