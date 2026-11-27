"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvals = void 0;
exports.approvalTransaction = approvalTransaction;
exports.viewWhere = viewWhere;
exports.applyCommand = applyCommand;
const calendar_approval_reason_1 = require("./calendar-approval.reason");
const calendar_import_service_1 = require("../livestream/calendar-import.service");
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const calendar_transaction_1 = require("../../lib/calendar-transaction");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const calendars = __importStar(require("../livestream/livestream.service"));
const calendar_approval_access_1 = require("./calendar-approval.access");
const calendar_approval_plan_1 = require("./calendar-approval.plan");
const calendar_approval_types_1 = require("./calendar-approval.types");
async function approvalTransaction(work) {
    return prisma_1.default.$transaction(async (tx) => {
        const lock = await tx.$queryRaw `SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
        if (lock.length !== 1)
            throw new ApiError_1.default("Thiếu khóa giao dịch lịch. Kiểm tra migration workflow.", 503);
        return (0, calendar_transaction_1.inCalendarTransaction)(tx, () => work(tx));
    }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable, maxWait: 15_000, timeout: 180_000 });
}
async function lockRequest(tx, id) {
    const rows = await tx.$queryRaw `SELECT id FROM calendar_approval_requests WHERE id=${id} FOR UPDATE`;
    if (!rows.length)
        throw new ApiError_1.default('Không tìm thấy yêu cầu', 404);
    return tx.calendar_approval_requests.findUniqueOrThrow({ where: { id } });
}
function viewWhere(user, mine = false) {
    (0, calendar_approval_access_1.requirePermission)(user, 'calendar.view');
    const scope = user.programScope;
    const scopeSql = (0, calendar_approval_access_1.hasPermission)(user, '*') || user.roles?.includes('admin') || scope?.mode === 'ALL' ? client_1.Prisma.sql `1=1` : scope?.mode === 'RESTRICTED' ? client_1.Prisma.sql `JSON_CONTAINS(${JSON.stringify(scope.programs)}, program_codes)` : client_1.Prisma.sql `1=0`;
    return client_1.Prisma.sql `${scopeSql} AND ${mine || !(0, calendar_approval_access_1.hasPermission)(user, calendar_approval_types_1.PERMISSIONS.review) ? client_1.Prisma.sql `created_by=${user.userId}` : client_1.Prisma.sql `(status <> 'DRAFT' OR created_by=${user.userId})`}`;
}
async function canView(user, record) {
    (0, calendar_approval_access_1.assertScope)(user, 'calendar.view', record.program_codes);
    if (record.created_by !== user.userId) {
        (0, calendar_approval_access_1.requirePermission)(user, calendar_approval_types_1.PERMISSIONS.review);
        if (record.status === 'DRAFT')
            throw new ApiError_1.default(record.revision > 1 ? 'Yêu cầu đang được thu hồi để chỉnh sửa. Phiên bản cũ không còn chờ duyệt.' : 'Bản nháp chỉ dành cho người tạo', record.revision > 1 ? 409 : 403);
    }
}
async function decisionActorName(r) {
    if (!r.decided_by)
        return null;
    const db = (0, calendar_transaction_1.currentCalendarTransaction)() || prisma_1.default;
    const decision = await db.calendar_approval_audit.findFirst({ where: { request_id: r.id, revision: r.revision, actor_id: r.decided_by, action: r.status === 'APPROVED' ? 'request.approved' : 'request.rejected' }, orderBy: { id: 'desc' }, select: { actor_name: true } });
    if (decision)
        return decision.actor_name;
    const actor = await db.users.findUnique({ where: { id: r.decided_by }, select: { username: true } });
    return actor?.username || `Tài khoản #${r.decided_by}`;
}
async function present(user, r, policy) {
    const before = r.before_data, after = r.proposed_data;
    const project = async (rows) => {
        const filtered = await field_permission_service_1.default.filterVisibleRecords(user.roleIds, 'calendar', rows.map(row => row || {}));
        // Lesson identity is technical metadata, like the calendar ID, needed to resolve the outline.
        return rows.map((row, i) => row ? { ...filtered[i], id: row.id ?? null, session_id: row.session_id ?? null } : null);
    };
    const b = await project(before), a = await project(after);
    policy = policy || await (0, calendar_approval_access_1.accountPolicy)(user.userId);
    const canReview = r.status === 'PENDING' && r.created_by !== user.userId && policy.can_approve;
    const cancellation = r.status === 'CANCELLED' ? await ((0, calendar_transaction_1.currentCalendarTransaction)() || prisma_1.default).calendar_approval_audit.findFirst({ where: { request_id: r.id, revision: r.revision, action: 'request.cancelled' }, orderBy: { id: 'desc' }, select: { created_at: true } }) : null;
    const result = { ...(0, calendar_approval_types_1.jsonValue)(r), cancelled_at: cancellation?.created_at?.toISOString() || null, decider_name: await decisionActorName(r), command: undefined, base_hash: undefined, idempotency_key: undefined, input_hash: undefined, before_data: b, proposed_data: a, editable_action: r.created_by === user.userId ? r.command.action : undefined,
        // Applied results can contain full legacy records; expose only safe IDs.
        result_data: r.result_data ? { calendar_ids: r.result_data.calendar_ids || [] } : null,
        changes: [...b.map(old => { const next = a.find(row => row?.id != null && String(row.id) === String(old?.id)) || null; return { before: old, after: next, fields: (0, calendar_approval_plan_1.changedFields)(old, next) }; }), ...a.filter(row => row && (!row.id || !b.some(old => old?.id != null && String(old.id) === String(row.id)))).map(row => ({ before: null, after: row, fields: (0, calendar_approval_plan_1.changedFields)(null, row) }))],
        capabilities: { withdraw: r.created_by === user.userId && r.status === 'PENDING' && (0, calendar_approval_access_1.hasPermission)(user, calendar_approval_types_1.PERMISSIONS.submit), approve: canReview && (0, calendar_approval_access_1.hasPermission)(user, calendar_approval_types_1.PERMISSIONS.approve), reject: canReview && (0, calendar_approval_access_1.hasPermission)(user, calendar_approval_types_1.PERMISSIONS.reject), edit: r.created_by === user.userId && ['DRAFT', 'REJECTED', 'CONFLICTED'].includes(r.status), submit: r.created_by === user.userId && r.status === 'DRAFT' && (0, calendar_approval_access_1.hasPermission)(user, calendar_approval_types_1.PERMISSIONS.submit), cancel: r.created_by === user.userId && ['DRAFT', 'PENDING'].includes(r.status) } };
    return result;
}
async function audit(tx, user, r, action, before, after, reason) {
    await tx.calendar_approval_audit.create({ data: { created_at: new Date(), request_id: r.id, revision: r.revision, actor_id: user.userId, actor_name: user.username, action, before_data: (0, calendar_approval_types_1.jsonValue)(before), after_data: (0, calendar_approval_types_1.jsonValue)(after), reason } });
}
async function notify(tx, r, eventType, recipients) {
    const event = (0, node_crypto_1.randomUUID)();
    if (recipients.length)
        await tx.calendar_approval_notifications.createMany({ data: [...new Set(recipients)].map(recipient_id => ({ event_id: event, request_id: r.id, recipient_id, event_type: eventType, created_at: new Date() })), skipDuplicates: true });
}
async function submit(tx, user, r, submissionReason, submissionTitle) {
    (0, calendar_approval_access_1.requirePermission)(user, calendar_approval_types_1.PERMISSIONS.submit);
    if (r.created_by !== user.userId || r.status !== 'DRAFT')
        throw new ApiError_1.default('Chỉ người tạo được gửi bản nháp', 409);
    const reason = String(submissionReason ?? r.reason).trim();
    if (!reason || reason.length > 1000)
        throw new ApiError_1.default('Vui lòng nhập lý do gửi duyệt từ 1 đến 1000 ký tự.', 422);
    const title = (0, calendar_approval_reason_1.approvalTitle)(submissionTitle === undefined ? r.title : submissionTitle);
    const plan = await (0, calendar_approval_plan_1.buildPlan)(tx, user, r.command);
    const recipients = await (0, calendar_approval_access_1.approvers)(plan.codes, user.userId, tx);
    if (!recipients.length)
        throw new ApiError_1.default('Chưa có tài khoản được phép duyệt toàn bộ chương trình trong yêu cầu. Nhờ quản trị viên cấu hình người duyệt.', 422);
    const effective = await (0, calendar_approval_access_1.accountPolicy)(user.userId, tx);
    const policySnapshot = (0, calendar_approval_types_1.jsonValue)({ module_effective_policy: effective.module_effective_policy, module_overrides: effective.module_overrides, effective_policy: effective.effective_policy, overrides: effective.overrides, roles: effective.roles, version: effective.version });
    const updated = await tx.calendar_approval_requests.update({ where: { id: r.id }, data: { title, reason, approval_policy_snapshot: policySnapshot, status: 'PENDING', command: (0, calendar_approval_types_1.jsonValue)(plan.command), before_data: plan.before, proposed_data: plan.proposed, base_hash: plan.hash, program_codes: plan.codes, submitted_at: new Date(), lock_version: { increment: 1 } } });
    await tx.calendar_approval_revisions.create({ data: { request_id: r.id, revision: r.revision, command: (0, calendar_approval_types_1.jsonValue)(plan.command), before_data: plan.before, proposed_data: plan.proposed, base_hash: plan.hash, program_codes: plan.codes, title, reason, submitted_by: user.userId, approval_policy_snapshot: policySnapshot, submitted_at: new Date() } });
    await audit(tx, user, r, r.revision > 1 ? 'request.resubmitted' : 'request.submitted', { status: r.status }, { status: 'PENDING' }, reason);
    await notify(tx, r, r.revision > 1 ? 'request.resubmitted' : 'request.submitted', recipients);
    return updated;
}
exports.approvals = {
    async capabilities(user) {
        const fresh = await (0, calendar_approval_access_1.freshUser)(user.userId);
        const account = await (0, calendar_approval_access_1.accountPolicy)(user.userId);
        return { ...account, can_request: ['calendar.create', 'calendar.update', 'calendar.delete'].some(p => (0, calendar_approval_access_1.hasPermission)(fresh, p)), can_submit: (0, calendar_approval_access_1.hasPermission)(fresh, calendar_approval_types_1.PERMISSIONS.submit), can_manage: (0, calendar_approval_access_1.hasPermission)(fresh, calendar_approval_types_1.PERMISSIONS.manage), can_review: (0, calendar_approval_access_1.hasPermission)(fresh, calendar_approval_types_1.PERMISSIONS.review) };
    },
    async create(user, input, key, trustedImport = false) {
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        if (!input || typeof input !== 'object' || !input.command || typeof input.command !== 'object')
            throw new ApiError_1.default('Thiếu nội dung yêu cầu', 422);
        if (input.command?.action === 'import' && !trustedImport)
            throw new ApiError_1.default('Yêu cầu import phải được tạo từ file đã kiểm tra trên server', 422);
        const reason = String(input.reason || input.command?.payload?.reason || '').trim();
        if (reason.length > 1000 || (!reason && input.command?.action !== 'create' && input.command?.action !== 'createBulk' && input.command?.action !== 'auto'))
            throw new ApiError_1.default('Vui lòng nhập lý do thay đổi (tối đa 1000 ký tự)', 422);
        if (key && (!/^[\w-]{8,100}$/.test(key)))
            throw new ApiError_1.default('Idempotency-Key không hợp lệ', 400);
        const title = (0, calendar_approval_reason_1.approvalTitle)(input.title);
        const inputHash = (0, calendar_approval_types_1.fingerprint)({ command: input.command, reason, ...(title ? { title } : {}), submit: input.submit === true });
        return approvalTransaction(async (tx) => {
            user = await (0, calendar_approval_access_1.freshUser)(user.userId);
            if (key) {
                const existing = await tx.calendar_approval_requests.findUnique({ where: { created_by_idempotency_key: { created_by: user.userId, idempotency_key: key } } });
                if (existing) {
                    if (existing.input_hash !== inputHash)
                        throw new ApiError_1.default('Idempotency-Key đã được dùng cho nội dung khác', 409);
                    return present(user, existing);
                }
            }
            const command = (0, calendar_approval_types_1.jsonValue)(input.command);
            const plan = await (0, calendar_approval_plan_1.buildPlan)(tx, user, command);
            const policy = await (0, calendar_approval_access_1.accountPolicy)(user.userId, tx);
            let r = await tx.calendar_approval_requests.create({ data: { approval_policy_snapshot: (0, calendar_approval_types_1.jsonValue)({ module_effective_policy: policy.module_effective_policy, module_overrides: policy.module_overrides, effective_policy: policy.effective_policy, overrides: policy.overrides, roles: policy.roles, version: policy.version }), created_at: new Date(), public_id: (0, node_crypto_1.randomUUID)(), created_by: user.userId, creator_name: user.username, operation: plan.operation, command: (0, calendar_approval_types_1.jsonValue)(plan.command), program_codes: plan.codes, before_data: plan.before, proposed_data: plan.proposed, base_hash: plan.hash, title, reason, idempotency_key: key || null, input_hash: inputHash } });
            await audit(tx, user, r, 'request.created', {}, { status: 'DRAFT' }, reason);
            if (input.submit === true)
                r = await submit(tx, user, r);
            return present(user, r);
        });
    },
    async list(user, query) {
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        const page = Math.max(1, Number(query.page || 1)), limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
        if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit))
            throw new ApiError_1.default('Phân trang không hợp lệ', 400);
        let where = viewWhere(user, query.mine === 'true');
        if (query.status) {
            if (!['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONFLICTED', 'DIRECT_APPLIED'].includes(query.status))
                throw new ApiError_1.default('Trạng thái không hợp lệ', 400);
            where = client_1.Prisma.sql `${where} AND status=${query.status}`;
        }
        if (query.program)
            where = client_1.Prisma.sql `${where} AND JSON_CONTAINS(program_codes,${JSON.stringify(String(query.program))})`;
        const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `SELECT id FROM calendar_approval_requests WHERE ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
        const totals = await prisma_1.default.$queryRaw(client_1.Prisma.sql `SELECT COUNT(*) AS total FROM calendar_approval_requests WHERE ${where}`);
        const records = rows.length ? await prisma_1.default.calendar_approval_requests.findMany({ where: { id: { in: rows.map(r => r.id) } }, orderBy: { id: 'desc' } }) : [];
        const policy = await (0, calendar_approval_access_1.accountPolicy)(user.userId);
        return { rows: await Promise.all(records.map(r => present(user, r, policy))), total: Number(totals[0].total), page, limit };
    },
    async detail(user, id) {
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        const r = await prisma_1.default.calendar_approval_requests.findUnique({ where: { id } });
        if (!r)
            throw new ApiError_1.default('Không tìm thấy yêu cầu', 404);
        await canView(user, r);
        const result = await present(user, r);
        if (r.status === 'PENDING') {
            const current = await (0, calendar_approval_plan_1.dependencies)(prisma_1.default, r.program_codes);
            return { ...result, base_changed: (0, calendar_approval_types_1.fingerprint)(current) !== r.base_hash };
        }
        return result;
    },
    async edit(user, id, input) {
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        return approvalTransaction(async (tx) => {
            user = await (0, calendar_approval_access_1.freshUser)(user.userId);
            const r = await lockRequest(tx, id);
            await canView(user, r);
            if (r.created_by !== user.userId || !['DRAFT', 'REJECTED', 'CONFLICTED'].includes(r.status) || input.lock_version !== r.lock_version)
                throw new ApiError_1.default('Yêu cầu đã thay đổi hoặc không thể chỉnh sửa', 409);
            if (input.command?.action === 'import')
                throw new ApiError_1.default('Không sửa payload import. Hãy nhập lại file để kiểm tra.', 422);
            let command = input.command || r.command;
            if (input.edit_patch) {
                command = (0, calendar_approval_types_1.jsonValue)(r.command);
                if (!['create', 'update', 'cancel', 'reschedule'].includes(command.action))
                    throw new ApiError_1.default('Yêu cầu hàng loạt/import cần chỉnh sửa bằng công cụ tương ứng rồi gửi lại.', 422);
                if (command.action === 'reschedule')
                    command.payload.new_session = { ...command.payload.new_session, ...input.edit_patch };
                else
                    command.payload = { ...command.payload, ...input.edit_patch };
            }
            const reason = String(input.reason ?? r.reason).trim();
            if (!reason || reason.length > 1000)
                throw new ApiError_1.default('Vui lòng nhập lý do hợp lệ', 422);
            command = (0, calendar_approval_types_1.jsonValue)(command);
            const plan = await (0, calendar_approval_plan_1.buildPlan)(tx, user, command);
            const next = await tx.calendar_approval_requests.update({ where: { id }, data: { status: 'DRAFT', revision: r.status === 'DRAFT' ? r.revision : r.revision + 1, lock_version: { increment: 1 }, command: (0, calendar_approval_types_1.jsonValue)(plan.command), before_data: plan.before, proposed_data: plan.proposed, base_hash: plan.hash, program_codes: plan.codes, reason, decision_reason: null, decided_by: null, decided_at: null } });
            await audit(tx, user, next, 'request.edited', { status: r.status }, { status: 'DRAFT' }, reason);
            return present(user, next);
        });
    },
    async transition(user, id, action, input) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new ApiError_1.default('Thiếu phiên bản yêu cầu', 422);
        const sessionId = user.sessionId;
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        const result = await approvalTransaction(async (tx) => {
            if (sessionId) {
                const session = await tx.auth_sessions.findUnique({ where: { id: sessionId } });
                if (!session || session.revoked_at || session.expires_at <= new Date() || session.user_id !== user.userId)
                    throw new ApiError_1.default('Phiên đăng nhập không còn hợp lệ', 401);
            }
            user = await (0, calendar_approval_access_1.freshUser)(user.userId);
            const r = await lockRequest(tx, id);
            await canView(user, r);
            if (action === 'approve' && r.status === 'APPROVED' && r.revision === input.revision)
                return { record: await present(user, r) };
            if (['approve', 'reject'].includes(action) && r.status !== 'PENDING') {
                const who = await decisionActorName(r);
                const message = r.status === 'APPROVED' ? `Yêu cầu đã được duyệt bởi ${who}.` : r.status === 'REJECTED' ? `Yêu cầu đã bị từ chối bởi ${who}.` : 'Yêu cầu không còn chờ duyệt.';
                throw new ApiError_1.default(message, 409);
            }
            if (action === 'withdraw') {
                if (r.created_by !== user.userId)
                    throw new ApiError_1.default('Chỉ người gửi được thu hồi yêu cầu để chỉnh sửa.', 403);
                (0, calendar_approval_access_1.requirePermission)(user, calendar_approval_types_1.PERMISSIONS.submit);
                if (r.status !== 'PENDING')
                    throw new ApiError_1.default('Chỉ có thể thu hồi yêu cầu đang chờ duyệt. Yêu cầu có thể đã được xử lý; vui lòng tải lại.', 409);
            }
            if (input.lock_version !== r.lock_version || input.revision !== r.revision)
                throw new ApiError_1.default('Yêu cầu vừa thay đổi. Vui lòng mở lại chi tiết.', 409);
            if (action === 'withdraw') {
                // Notify everyone who previously received this request, including reviewers
                // whose assignment changed while their old detail/confirmation stayed open.
                const previous = await tx.calendar_approval_notifications.findMany({ where: { request_id: id, recipient_id: { not: r.created_by } }, select: { recipient_id: true } });
                const recipients = [...previous.map(n => n.recipient_id), ...await (0, calendar_approval_access_1.approvers)(r.program_codes, r.created_by, tx)];
                const next = await tx.calendar_approval_requests.update({ where: { id }, data: { status: 'DRAFT', revision: { increment: 1 }, lock_version: { increment: 1 }, submitted_at: null, decision_reason: null, decided_by: null, decided_at: null } });
                await audit(tx, user, r, 'request.withdrawn', { status: 'PENDING', revision: r.revision }, { status: 'DRAFT', revision: next.revision }, 'Thu hồi để chỉnh sửa');
                await notify(tx, r, 'request.withdrawn', recipients);
                return { record: await present(user, next) };
            }
            if (action === 'submit')
                return { record: await present(user, await submit(tx, user, r, input.reason, input.title)) };
            if (action === 'cancel') {
                if (r.created_by !== user.userId || !['DRAFT', 'PENDING'].includes(r.status))
                    throw new ApiError_1.default('Không thể hủy yêu cầu này', 409);
                const next = await tx.calendar_approval_requests.update({ where: { id }, data: { status: 'CANCELLED', lock_version: { increment: 1 } } });
                await audit(tx, user, r, 'request.cancelled', { status: r.status }, { status: 'CANCELLED' }, r.reason);
                await notify(tx, r, 'request.cancelled', await (0, calendar_approval_access_1.approvers)(r.program_codes, r.created_by, tx));
                return { record: await present(user, next) };
            }
            if (!['approve', 'reject'].includes(action) || r.status !== 'PENDING')
                throw new ApiError_1.default('Yêu cầu không còn chờ duyệt', 409);
            (0, calendar_approval_access_1.requirePermission)(user, calendar_approval_types_1.PERMISSIONS.review);
            const policy = await (0, calendar_approval_access_1.accountPolicy)(user.userId, tx);
            (0, calendar_approval_access_1.requirePermission)(user, action === 'approve' ? calendar_approval_types_1.PERMISSIONS.approve : calendar_approval_types_1.PERMISSIONS.reject);
            (0, calendar_approval_access_1.assertScope)(user, action === 'approve' ? calendar_approval_types_1.PERMISSIONS.approve : calendar_approval_types_1.PERMISSIONS.reject, r.program_codes);
            if (!policy.can_approve || r.created_by === user.userId)
                throw new ApiError_1.default('Không được duyệt yêu cầu của chính mình hoặc tài khoản chưa được cấu hình duyệt', 403);
            const decisionReason = String(input.reason || '').trim();
            if (decisionReason.length > 1000 || (action === 'reject' && !decisionReason))
                throw new ApiError_1.default('Bắt buộc nhập lý do từ chối (tối đa 1000 ký tự)', 422);
            let status = 'REJECTED', resultData = null;
            if (action === 'approve') {
                const creator = await (0, calendar_approval_access_1.freshUser)(r.created_by);
                (0, calendar_approval_access_1.requirePermission)(creator, calendar_approval_types_1.PERMISSIONS.submit);
                const current = (0, calendar_approval_types_1.fingerprint)(await (0, calendar_approval_plan_1.dependencies)(tx, r.program_codes));
                if (current !== r.base_hash) {
                    const conflicted = await tx.calendar_approval_requests.update({ where: { id }, data: { status: 'CONFLICTED', lock_version: { increment: 1 } } });
                    await audit(tx, user, r, 'request.conflicted', { status: 'PENDING' }, { status: 'CONFLICTED' }, 'Dữ liệu lịch hoặc đề cương đã thay đổi');
                    await notify(tx, r, 'request.conflicted', [r.created_by]);
                    return { record: await present(user, conflicted), conflict: true };
                }
                const plan = await (0, calendar_approval_plan_1.buildPlan)(tx, creator, r.command);
                // Load visibility once for the whole batch rather than one DB lookup
                // for every field of every calendar.
                const fields = [...new Set(plan.proposed.flatMap((row, i) => (0, calendar_approval_plan_1.changedFields)(plan.before[i], row)))].filter(f => !['key', 'deleted_at', 'calendar_source', 'id'].includes(f));
                const visible = await field_permission_service_1.default.filterVisibleRecord(user.roleIds, 'calendar', Object.fromEntries(fields.map(f => [f, true])));
                if (fields.some(f => !visible[f]))
                    throw new ApiError_1.default('Bạn chưa có quyền xem đầy đủ các trường thay đổi để duyệt', 403);
                const applied = await applyCommand(plan.command, creator);
                // Audit stores the official post-commit candidate. API only exposes IDs.
                const ids = collectCalendarIds(applied);
                resultData = { calendar_ids: ids, operation_id: (0, node_crypto_1.randomUUID)() };
                status = 'APPROVED';
                await audit(tx, user, r, 'calendar.applied', r.before_data, { result: (0, calendar_approval_types_1.jsonValue)(applied), requested_by: r.created_by }, r.reason);
            }
            const next = await tx.calendar_approval_requests.update({ where: { id }, data: { status, decided_by: user.userId, decided_at: new Date(), decision_reason: decisionReason || null, result_data: resultData || client_1.Prisma.JsonNull, lock_version: { increment: 1 } } });
            await audit(tx, user, r, action === 'approve' ? 'request.approved' : 'request.rejected', { status: 'PENDING' }, { status }, decisionReason || r.reason);
            await notify(tx, r, action === 'approve' ? 'request.approved' : 'request.rejected', [r.created_by, ...(await (0, calendar_approval_access_1.approvers)(r.program_codes, r.created_by, tx)).filter(id => id !== user.userId)]);
            return { record: await present(user, next) };
        });
        if (result.conflict)
            throw new ApiError_1.default('Lịch hoặc đề cương đã thay đổi. Yêu cầu cần đối chiếu và gửi lại.', 409);
        return result.record;
    },
    async history(user, id) {
        user = await (0, calendar_approval_access_1.freshUser)(user.userId);
        (0, calendar_approval_access_1.requirePermission)(user, calendar_approval_types_1.PERMISSIONS.history);
        await this.detail(user, id);
        // Transition log intentionally excludes unrestricted snapshot payloads.
        const logs = await prisma_1.default.calendar_approval_audit.findMany({ where: { request_id: id }, orderBy: { id: 'asc' }, select: { id: true, revision: true, actor_name: true, action: true, reason: true, created_at: true } });
        return (0, calendar_approval_types_1.jsonValue)(logs);
    },
};
function collectCalendarIds(value) {
    const ids = new Set();
    const visit = (v) => { if (!v || typeof v !== 'object')
        return; if (v.id && v.start_time && v.code)
        ids.add(Number(v.id)); if (Array.isArray(v))
        v.forEach(visit);
    else
        Object.values(v).forEach(visit); };
    visit(value);
    return [...ids];
}
async function applyCommand(c, actor) {
    const p = (0, calendar_approval_types_1.jsonValue)(c.payload);
    switch (c.action) {
        case 'import': return (0, calendar_import_service_1.applyApprovedCalendarImport)((0, calendar_transaction_1.currentCalendarTransaction)(), p, actor);
        case 'create': return calendars.createSingle(p, actor);
        case 'createBulk': return calendars.createBulk(p, actor);
        case 'update': return calendars.updateSchedule(c.id, p, 'current', actor);
        case 'updateBulk': return ['cancel', 'makeup'].includes(p.operation) ? calendars.bulkRescheduleSessions(p, actor) : calendars.updateBulk(p, actor);
        case 'delete': return calendars.deleteSession(c.id, actor);
        case 'cancel': return calendars.cancelSession(c.id, p, actor);
        case 'reschedule': return calendars.rescheduleSession(c.id, p, actor);
        case 'swap': return calendars.swapSessionTimes(p, actor);
        case 'restore': return calendars.restoreSession(c.id, actor);
        case 'mapping': return calendars.updateCalendarMappings(p, actor);
        default: throw new ApiError_1.default('Thao tác không được hỗ trợ', 422);
    }
}
// Direct edits are still official immediately for accounts whose policy does
// not require review. Persist their activity in the same transaction so they
// also invalidate notification/list clients without pretending to be approved.
(0, calendar_transaction_1.setCalendarWriteObserver)(async (tx, action, actor, before, after, payload) => {
    const fields = ['id', 'session_id', 'code', 'learn_number', 'subject', 'start_time', 'end_time', 'teacher', 'assistant_teacher', 'lesson_name', 'lesson_document', 'lesson_baitap', 'channel_name', 'lesson_status', 'cancel_reason', 'key', 'system_type', 'lesson_count', 'deleted_at', 'evg_stream', 'evg_banner', 'lesson_link'];
    const stable = (rows) => rows.map(row => Object.fromEntries(fields.map(f => [f, row[f] ?? null]))).sort((a, b) => Number(a.id) - Number(b.id));
    before = stable(before);
    after = stable(after);
    if ((0, calendar_approval_types_1.fingerprint)(before) === (0, calendar_approval_types_1.fingerprint)(after))
        return;
    const codes = [...new Set([...before, ...after].map(row => String(row.code)).filter(Boolean))].sort();
    if (!codes.length)
        return;
    const operation = action.includes('create') ? 'create' : action === 'deleteSession' ? 'delete' : action === 'restoreSession' ? 'restore' : action === 'cancelSession' ? 'cancel' : action.includes('reschedule') || action.includes('Reschedule') ? 'reschedule' : action === 'swapSessionTimes' ? 'swap' : action === 'updateCalendarMappings' ? 'mapping' : 'update';
    const reason = String(payload?.reason || payload?.change_reason || 'Thay đổi lịch trực tiếp').trim().slice(0, 1000);
    const r = await tx.calendar_approval_requests.create({ data: { created_at: new Date(), public_id: (0, node_crypto_1.randomUUID)(), created_by: actor.userId, creator_name: actor.username, operation, status: 'DIRECT_APPLIED', command: { action: 'direct', operation }, program_codes: codes, before_data: (0, calendar_approval_types_1.jsonValue)(before), proposed_data: operation === 'delete' ? [null] : (0, calendar_approval_types_1.jsonValue)(after), base_hash: (0, calendar_approval_types_1.fingerprint)(before), reason, submitted_at: new Date(), decided_at: new Date(), result_data: { calendar_ids: after.map(row => Number(row.id)) } } });
    await audit(tx, actor, r, 'calendar.changed', before, after, reason);
    await notify(tx, r, 'calendar.changed', [actor.userId, ...await (0, calendar_approval_access_1.approvers)(codes, actor.userId, tx)]);
});
