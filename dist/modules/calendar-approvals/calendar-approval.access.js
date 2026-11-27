"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertScope = void 0;
exports.freshUser = freshUser;
exports.hasPermission = hasPermission;
exports.requirePermission = requirePermission;
exports.accountPolicy = accountPolicy;
exports.getAccountConfiguration = getAccountConfiguration;
exports.saveAccountPolicyInTransaction = saveAccountPolicyInTransaction;
exports.saveAccountPolicy = saveAccountPolicy;
exports.approvers = approvers;
const approval_policy_registry_1 = require("../approval-policy/approval-policy.registry");
const approval_policy_service_1 = require("../approval-policy/approval-policy.service");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const calendar_approval_policy_1 = require("./calendar-approval.policy");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const authorization_service_1 = require("../../services/authorization.service");
const calendar_approval_types_1 = require("./calendar-approval.types");
async function freshUser(userId) {
    (0, authorization_service_1.invalidateUserAccessCache)(userId);
    const { user, roles, permissionCodes, programScope } = await (0, authorization_service_1.loadUserAccess)(userId);
    return { userId, username: user.username, roles: roles.map(r => r.code), roleIds: roles.map(r => String(r.id)), permissions: permissionCodes, programScope };
}
function hasPermission(user, permission) { return user?.permissions?.includes('*') || user?.permissions?.includes(permission) || user?.roles?.includes('admin'); }
function requirePermission(user, permission) { if (!hasPermission(user, permission))
    throw new ApiError_1.default(permission === calendar_approval_types_1.PERMISSIONS.submit ? 'Tài khoản chưa có quyền gửi yêu cầu duyệt lịch. Vui lòng nhờ quản trị viên cấp quyền qua vai trò.' : 'Không có quyền thực hiện thao tác này', 403); }
const assertScope = (user, permission, codes) => {
    if (!codes.length)
        throw new ApiError_1.default('Không xác định được chương trình', 422);
    codes.forEach(code => (0, authorization_service_1.assertProgramAccess)(user, permission, code));
};
exports.assertScope = assertScope;
async function accountPolicy(userId, tx = prisma_1.default) {
    const [p, bindings] = await Promise.all([
        tx.calendar_approval_accounts.findUnique({ where: { user_id: userId } }),
        tx.userRoles.findMany({ where: { userId, role: { isActive: true } }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } }),
    ]);
    const roles = bindings.map((binding) => binding.role);
    // Legacy rows remain interpretable during rolling migration; omitted operations were SKIP.
    const moduleOverrides = (0, approval_policy_service_1.normalizeModulePolicies)(p?.operation_overrides ?? (p ? Object.fromEntries(calendar_approval_types_1.OPERATIONS.map(op => [op, p.required_operations.includes(op) ? 'REQUIRE' : 'SKIP'])) : {}));
    const overrides = (moduleOverrides.calendar || {});
    const moduleResolved = (0, approval_policy_service_1.resolveModuleApprovalPolicy)(roles, moduleOverrides);
    const resolved = (0, calendar_approval_policy_1.resolveApprovalPolicy)(roles, overrides);
    const permissions = roles.flatMap((r) => r.rolePermissions?.map((rp) => rp.permission.code) || []);
    const canApprove = roles.some((r) => r.code === 'admin') || permissions.includes('*') || permissions.includes(calendar_approval_types_1.PERMISSIONS.approve);
    const rolePolicy = roles.map((r) => ({ id: String(r.id), name: r.name, approval_policy: (0, approval_policy_service_1.normalizeModulePolicies)(r.approval_policy) })).sort((a, b) => a.id.localeCompare(b.id));
    return { user_id: userId, can_approve: Boolean(canApprove), approval_roles: roles.filter((r) => r.code === 'admin' || r.rolePermissions?.some((rp) => ['*', calendar_approval_types_1.PERMISSIONS.approve].includes(rp.permission.code))).map((r) => ({ id: String(r.id), name: r.name })),
        policy_modules: approval_policy_registry_1.APPROVAL_MODULES, module_overrides: moduleOverrides, ...moduleResolved, overrides, roles: rolePolicy, role_policy_hash: (0, calendar_approval_types_1.fingerprint)(rolePolicy), ...resolved, version: p?.version || 0 };
}
async function getAccountConfiguration(userId) {
    const policy = await accountPolicy(userId);
    (0, authorization_service_1.invalidateUserAccessCache)(userId);
    const { programScope } = await (0, authorization_service_1.loadUserAccess)(userId);
    const programs = programScope.mode === 'RESTRICTED' ? await prisma_1.default.scopeResources.findMany({ where: { scopeType: 'PROGRAM', scopeKey: { in: programScope.programs } }, select: { scopeKey: true, displayName: true } }) : [];
    return { ...policy, program_scope: programScope, program_names: programs.map(p => ({ code: p.scopeKey, name: p.displayName || p.scopeKey })) };
}
async function saveAccountPolicyInTransaction(actor, userId, input, tx) {
    (0, calendar_approval_types_1.positiveId)(userId);
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new ApiError_1.default('Cấu hình không hợp lệ', 400);
    if ('can_approve' in input || 'approval_enabled' in input)
        throw new ApiError_1.default('Quyền phê duyệt được quản lý qua vai trò. Vui lòng thay đổi vai trò của tài khoản.', 400);
    if (!Number.isInteger(input.version))
        throw new ApiError_1.default('Cấu hình tài khoản không hợp lệ', 400);
    const incomingModules = input.module_overrides !== undefined
        ? (0, approval_policy_service_1.validateModulePolicies)(input.module_overrides, true)
        : { calendar: input.overrides !== undefined ? (0, calendar_approval_policy_1.validateApprovalPolicy)(input.overrides, true)
                : Object.fromEntries(calendar_approval_types_1.OPERATIONS.map(op => [op, (0, calendar_approval_types_1.assertOperations)(input.required_operations).includes(op) ? 'REQUIRE' : 'SKIP'])) };
    for (const key of Object.keys(incomingModules))
        requirePermission(actor, approval_policy_registry_1.APPROVAL_MODULES.find(module => module.key === key).managePermission);
    if (!Object.keys(incomingModules).length && !approval_policy_registry_1.APPROVAL_MODULES.some(module => hasPermission(actor, module.managePermission)))
        throw new ApiError_1.default('Không có quyền cấu hình phê duyệt', 403);
    await tx.$queryRaw `SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
    const users = await tx.$queryRaw `SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    if (!users.length || !await tx.userRoles.findFirst({ where: { userId, role: { isActive: true } } }))
        throw new ApiError_1.default('Không tìm thấy tài khoản quản trị có vai trò hoạt động', 404);
    const before = await accountPolicy(userId, tx);
    if (input.role_policy_hash && input.role_policy_hash !== before.role_policy_hash)
        throw new ApiError_1.default('Quy định phê duyệt của vai trò vừa thay đổi. Vui lòng tải lại.', 409);
    if (before.version !== input.version)
        throw new ApiError_1.default('Cấu hình vừa thay đổi. Vui lòng tải lại.', 409);
    const moduleOverrides = { ...before.module_overrides, ...incomingModules };
    const resolved = (0, calendar_approval_policy_1.resolveApprovalPolicy)(before.roles, moduleOverrides.calendar || {});
    const operations = resolved.required_operations;
    const result = await tx.calendar_approval_accounts.upsert({ where: { user_id: userId }, create: { user_id: userId, required_operations: operations, operation_overrides: moduleOverrides, updated_by: actor.userId }, update: { required_operations: operations, operation_overrides: moduleOverrides, version: { increment: 1 }, updated_by: actor.userId } });
    await tx.calendar_approval_audit.create({ data: { created_at: new Date(), actor_id: actor.userId, actor_name: actor.username, action: 'account.configured', before_data: (0, calendar_approval_types_1.jsonValue)(before), after_data: (0, calendar_approval_types_1.jsonValue)(result), reason: 'Cấu hình duyệt lịch theo tài khoản' } });
    return (0, calendar_approval_types_1.jsonValue)(await accountPolicy(userId, tx));
}
async function saveAccountPolicy(actor, userId, input) {
    await prisma_1.default.$transaction(tx => saveAccountPolicyInTransaction(actor, userId, input, tx));
    (0, authorization_service_1.invalidateUserAccessCache)(userId);
    return getAccountConfiguration(userId);
}
async function approvers(codes, creatorId, tx = prisma_1.default) {
    const bindings = await tx.userRoles.findMany({
        where: { role: { isActive: true, OR: [{ code: 'admin' }, { rolePermissions: { some: { permission: { code: calendar_approval_types_1.PERMISSIONS.approve } } } }] } },
        select: { userId: true },
    });
    const accounts = [...new Set(bindings.map((binding) => binding.userId))].map(id => ({ id }));
    const recipients = [];
    for (const p of accounts) {
        if (p.id === creatorId)
            continue;
        try {
            const user = await freshUser(p.id);
            (0, exports.assertScope)(user, calendar_approval_types_1.PERMISSIONS.review, codes);
            (0, exports.assertScope)(user, calendar_approval_types_1.PERMISSIONS.approve, codes);
            recipients.push(p.id);
        }
        catch { /* Missing/inactive roles and denied scope are not reviewers. */ }
    }
    return recipients;
}
