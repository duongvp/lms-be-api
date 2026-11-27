"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOfficialOperation = exports.scheduleApprovalGate = exports.approvalGate = exports.calendarApprovalRoutes = void 0;
const calendar_approval_reason_1 = require("./calendar-approval.reason");
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const calendar_approval_service_1 = require("./calendar-approval.service");
const calendar_approval_access_1 = require("./calendar-approval.access");
const calendar_approval_types_1 = require("./calendar-approval.types");
const calendar_approval_plan_1 = require("./calendar-approval.plan");
const handle = (fn) => (req, res, next) => { void Promise.resolve(fn(req, res)).catch(next); };
exports.calendarApprovalRoutes = (0, express_1.Router)();
exports.calendarApprovalRoutes.use(auth_middleware_1.default.authenticate);
exports.calendarApprovalRoutes.get('/capabilities', handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.capabilities(req.user) })));
exports.calendarApprovalRoutes.get('/accounts', handle(async (req, res) => {
    (0, calendar_approval_access_1.requirePermission)(req.user, calendar_approval_types_1.PERMISSIONS.manage);
    const q = String(req.query.q || '').slice(0, 100);
    const users = await prisma_1.default.users.findMany({ where: { userRoles: { some: { role: { isActive: true } } }, ...(q ? { OR: [{ username: { contains: q } }, { name: { contains: q } }] } : {}) }, take: 100, orderBy: { id: 'desc' }, select: { id: true, username: true, name: true } });
    return res.json({ success: true, data: await Promise.all(users.map(async (u) => ({ ...u, ...await (0, calendar_approval_access_1.accountPolicy)(u.id) }))) });
}));
exports.calendarApprovalRoutes.get('/accounts/:userId', handle(async (req, res) => { (0, calendar_approval_access_1.requirePermission)(req.user, calendar_approval_types_1.PERMISSIONS.manage); return res.json({ success: true, data: await (0, calendar_approval_access_1.getAccountConfiguration)((0, calendar_approval_types_1.positiveId)(req.params.userId)) }); }));
exports.calendarApprovalRoutes.put('/accounts/:userId', handle(async (req, res) => res.json({ success: true, data: await (0, calendar_approval_access_1.saveAccountPolicy)(await (0, calendar_approval_access_1.freshUser)(req.user.userId), (0, calendar_approval_types_1.positiveId)(req.params.userId), req.body) })));
exports.calendarApprovalRoutes.get('/notifications', handle(async (req, res) => {
    const user = await (0, calendar_approval_access_1.freshUser)(req.user.userId);
    const access = (0, calendar_approval_service_1.viewWhere)(user);
    const unread = req.query.unread === 'true';
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    if (!Number.isInteger(limit))
        throw new ApiError_1.default('Phân trang không hợp lệ', 400);
    // Request scope is checked at read time, not just when recipients were created.
    const ids = client_1.Prisma.sql `SELECT id FROM calendar_approval_requests WHERE ${access}`;
    // Keep durable delivery/audit history, but show one current business alert per
    // request. Withdrawal is an invalidation signal, not a second review alert.
    // Select latest BEFORE filtering unread so an older unread receipt cannot
    // reappear after the user reads the latest notification.
    const current = client_1.Prisma.sql `SELECT MAX(latest.id) FROM calendar_approval_notifications latest WHERE latest.recipient_id=${user.userId} AND latest.event_type <> 'request.withdrawn' GROUP BY latest.request_id`;
    const records = await prisma_1.default.$queryRaw(client_1.Prisma.sql `SELECT n.id,n.request_id,n.event_type,n.read_at,n.created_at,r.operation,r.title,r.creator_name,r.status FROM calendar_approval_notifications n JOIN calendar_approval_requests r ON r.id=n.request_id WHERE n.recipient_id=${user.userId} AND n.id IN (${current}) AND n.request_id IN (${ids}) ${unread ? client_1.Prisma.sql `AND n.read_at IS NULL` : client_1.Prisma.empty} ORDER BY n.id DESC LIMIT ${limit}`);
    const counts = await prisma_1.default.$queryRaw(client_1.Prisma.sql `SELECT COUNT(*) AS unread,MAX(n.id) AS through_id FROM calendar_approval_notifications n WHERE n.recipient_id=${user.userId} AND n.id IN (${current}) AND n.request_id IN (${ids}) AND n.read_at IS NULL`);
    return res.json({ success: true, data: (0, calendar_approval_types_1.jsonValue)({ rows: records, unread: Number(counts[0].unread), through_id: String(counts[0].through_id || 0) }) });
}));
exports.calendarApprovalRoutes.post('/notifications/read-all', handle(async (req, res) => {
    const user = await (0, calendar_approval_access_1.freshUser)(req.user.userId), through = (0, calendar_approval_types_1.positiveBigId)(req.body.through_id), where = (0, calendar_approval_service_1.viewWhere)(user);
    await prisma_1.default.$executeRaw(client_1.Prisma.sql `UPDATE calendar_approval_notifications SET read_at=UTC_TIMESTAMP(3) WHERE recipient_id=${user.userId} AND id<=${through} AND read_at IS NULL AND request_id IN (SELECT id FROM calendar_approval_requests WHERE ${where})`);
    return res.json({ success: true });
}));
exports.calendarApprovalRoutes.patch('/notifications/:id/read', handle(async (req, res) => {
    const id = (0, calendar_approval_types_1.positiveBigId)(req.params.id);
    const row = await prisma_1.default.calendar_approval_notifications.findFirst({ where: { id, recipient_id: req.user.userId } });
    if (!row)
        throw new ApiError_1.default('Không tìm thấy thông báo', 404);
    await calendar_approval_service_1.approvals.detail(req.user, row.request_id);
    await prisma_1.default.calendar_approval_notifications.updateMany({ where: { id, recipient_id: req.user.userId, read_at: null }, data: { read_at: new Date() } });
    return res.json({ success: true });
}));
exports.calendarApprovalRoutes.get('/', handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.list(req.user, req.query) })));
exports.calendarApprovalRoutes.post('/', handle(async (req, res) => res.status(201).json({ success: true, data: await calendar_approval_service_1.approvals.create(req.user, req.body, req.header('Idempotency-Key')) })));
exports.calendarApprovalRoutes.patch('/:id/read', handle(async (req, res) => {
    const id = (0, calendar_approval_types_1.positiveBigId)(req.params.id);
    await calendar_approval_service_1.approvals.detail(req.user, id);
    await prisma_1.default.calendar_approval_notifications.updateMany({ where: { request_id: id, recipient_id: req.user.userId, read_at: null }, data: { read_at: new Date() } });
    return res.json({ success: true });
}));
exports.calendarApprovalRoutes.get('/:id/history', handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.history(req.user, (0, calendar_approval_types_1.positiveBigId)(req.params.id)) })));
exports.calendarApprovalRoutes.get('/:id', handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.detail(req.user, (0, calendar_approval_types_1.positiveBigId)(req.params.id)) })));
exports.calendarApprovalRoutes.patch('/:id', handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.edit(req.user, (0, calendar_approval_types_1.positiveBigId)(req.params.id), req.body) })));
for (const action of ['submit', 'approve', 'reject', 'cancel', 'withdraw'])
    exports.calendarApprovalRoutes.post(`/:id/${action}`, handle(async (req, res) => res.json({ success: true, data: await calendar_approval_service_1.approvals.transition(req.user, (0, calendar_approval_types_1.positiveBigId)(req.params.id), action, req.body) })));
// Mounted AFTER existing route RBAC/field/scope middleware, before official writes.
const approvalGate = (action) => handle(async (req, res) => {
    const account = await (0, calendar_approval_access_1.accountPolicy)(req.user.userId);
    let command = { action, payload: req.body || {}, ...(['update', 'delete', 'cancel', 'reschedule', 'restore'].includes(action) ? { id: (0, calendar_approval_types_1.positiveId)(req.params.id) } : {}) };
    if (!(0, calendar_approval_types_1.affectedOperations)(command).some(op => account.required_operations.includes(op)))
        return res.locals.approvalNext();
    command = (0, calendar_approval_plan_1.normalizeCommand)(command);
    if (req.header('X-Calendar-Submit-Approval') !== 'true')
        return res.status(409).json({ success: false, code: 'APPROVAL_REQUIRED', message: 'Thao tác này cần phê duyệt. Hãy gửi yêu cầu duyệt lịch trên LMS.' });
    const reason = (0, calendar_approval_reason_1.approvalSubmissionReason)(req, res, (0, calendar_approval_types_1.affectedOperations)(command)[0]);
    if (!reason)
        return;
    const result = await calendar_approval_service_1.approvals.create(req.user, { command, reason, title: (0, calendar_approval_reason_1.approvalSubmissionTitle)(req), submit: true }, req.header('Idempotency-Key'));
    return res.status(202).json({ success: true, data: { approval_required: true, request: result }, message: 'Đã gửi yêu cầu duyệt. Lịch chính thức chưa thay đổi.' });
});
exports.approvalGate = approvalGate;
const scheduleApprovalGate = (action) => (req, res, next) => { res.locals.approvalNext = next; return (0, exports.approvalGate)(action)(req, res, next); };
exports.scheduleApprovalGate = scheduleApprovalGate;
// Import and operational APIs which are not proposal commands must never bypass
// an account's approval policy. Read-only previews remain available.
const requireOfficialOperation = (operations) => (req, res, next) => {
    void (0, calendar_approval_access_1.accountPolicy)(req.user.userId).then(account => {
        if (account.required_operations.some(o => operations.includes(o)))
            return res.status(409).json({ success: false, code: 'APPROVAL_REQUIRED', message: 'Tài khoản cần phê duyệt thao tác này. Vui lòng tạo yêu cầu từ màn quản lý lịch; thao tác trực tiếp chưa được áp dụng.' });
        next();
    }).catch(next);
};
exports.requireOfficialOperation = requireOfficialOperation;
