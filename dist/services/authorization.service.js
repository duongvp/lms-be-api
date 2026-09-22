"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirstProgramScopeFilter = exports.getProgramScopeFilter = exports.assertProgramAccess = exports.isProgramAllowed = exports.invalidateUserAccessCache = exports.loadUserAccess = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const ApiError_1 = __importDefault(require("../utils/ApiError"));
const isMissingScopeSchema = (error) => (error instanceof client_1.Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2021' || (error.code === 'P2010'
        && String(error.meta?.message || '').toLowerCase().includes('doesn\'t exist'))));
const positiveConfigNumber = (value, fallback, minimum) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
};
const ACCESS_CACHE_TTL_MS = positiveConfigNumber(process.env.AUTHORIZATION_CACHE_TTL_MS, 30_000, 1_000);
const ACCESS_CACHE_MAX_ENTRIES = positiveConfigNumber(process.env.AUTHORIZATION_CACHE_MAX_ENTRIES, 1_000, 100);
const accessCache = new Map();
const trimAccessCache = () => {
    const now = Date.now();
    for (const [userId, entry] of accessCache) {
        if (entry.expiresAt <= now)
            accessCache.delete(userId);
    }
    while (accessCache.size >= ACCESS_CACHE_MAX_ENTRIES) {
        const oldestUserId = accessCache.keys().next().value;
        if (oldestUserId === undefined)
            break;
        accessCache.delete(oldestUserId);
    }
};
const legacyAccessQuery = async (userId, preloadedUser) => {
    const user = preloadedUser ?? await prisma_1.default.users.findUnique({ where: { id: userId } });
    if (!user)
        throw new ApiError_1.default('User not found', 404);
    const userRoles = await prisma_1.default.userRoles.findMany({
        where: { userId, role: { isActive: true } },
        include: {
            role: {
                include: {
                    rolePermissions: { include: { permission: true } },
                },
            },
        },
    });
    return { user, userRoles };
};
const loadUserAccessUncached = async (userId, preloadedUser) => {
    const access = await legacyAccessQuery(userId, preloadedUser);
    let userScopeRows = [];
    try {
        userScopeRows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT policy.mode, resource.scopeKey AS subject_code
      FROM user_program_scope_policies AS policy
      LEFT JOIN user_program_scopes AS binding ON binding.userId = policy.userId
      LEFT JOIN scope_resources AS resource
        ON resource.id = binding.scopeResourceId
        AND resource.scopeType = 'PROGRAM'
        AND resource.status = 'ACTIVE'
      WHERE policy.userId = ${userId}
    `);
    }
    catch (error) {
        // Rolling deploy compatibility. Without the new tables, non-admin users
        // receive DENY below instead of accidentally gaining every program.
        if (!isMissingScopeSchema(error))
            throw error;
    }
    const roles = access.userRoles.map((item) => item.role);
    const isAdmin = roles.some((role) => role.code === 'admin');
    const permissionCodes = isAdmin
        ? ['*']
        : Array.from(new Set(roles.flatMap((role) => (role.rolePermissions.map((item) => String(item.permission.code))))));
    let programScope = isAdmin
        ? { mode: 'ALL', programs: [] }
        : { mode: 'DENY', programs: [] };
    if (!isAdmin) {
        if (userScopeRows.length) {
            const rawMode = userScopeRows[0].mode;
            const mode = rawMode === 'DENY'
                ? 'DENY'
                : rawMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';
            programScope = {
                mode,
                programs: mode === 'RESTRICTED'
                    ? Array.from(new Set(userScopeRows
                        .map((row) => String(row.subject_code || '').trim())
                        .filter(Boolean))).sort()
                    : [],
            };
        }
    }
    return { user: access.user, roles, permissionCodes, programScope };
};
const loadUserAccess = async (userId, preloadedUser) => {
    const cached = accessCache.get(userId);
    if (cached && cached.expiresAt > Date.now())
        return cached.promise;
    if (cached)
        accessCache.delete(userId);
    trimAccessCache();
    const promise = loadUserAccessUncached(userId, preloadedUser);
    accessCache.set(userId, {
        expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
        promise,
    });
    try {
        return await promise;
    }
    catch (error) {
        if (accessCache.get(userId)?.promise === promise)
            accessCache.delete(userId);
        throw error;
    }
};
exports.loadUserAccess = loadUserAccess;
const invalidateUserAccessCache = (userId) => {
    if (userId === undefined)
        accessCache.clear();
    else
        accessCache.delete(userId);
};
exports.invalidateUserAccessCache = invalidateUserAccessCache;
const isProgramAllowed = (user, permissionCode, programCode) => {
    if (!user)
        return false;
    if (user.permissions?.includes('*') || user.roles?.includes('admin'))
        return true;
    if (!user.permissions?.includes(permissionCode))
        return false;
    const scope = user.programScope;
    if (!scope)
        return false;
    if (scope.mode === 'ALL')
        return true;
    if (scope.mode === 'DENY')
        return false;
    return scope.programs.includes(String(programCode).trim());
};
exports.isProgramAllowed = isProgramAllowed;
const assertProgramAccess = (user, permissionCode, programCode) => {
    const code = String(programCode || '').trim();
    if (!code || !(0, exports.isProgramAllowed)(user, permissionCode, code)) {
        throw new ApiError_1.default('Không có quyền thao tác trên Chương trình này', 403);
    }
};
exports.assertProgramAccess = assertProgramAccess;
const getProgramScopeFilter = (user, permissionCode) => {
    if (!user)
        return [];
    if (user.permissions?.includes('*') || user.roles?.includes('admin'))
        return null;
    if (!user.permissions?.includes(permissionCode))
        return [];
    const scope = user.programScope;
    if (!scope)
        return [];
    if (scope.mode === 'ALL')
        return null;
    return scope.mode === 'RESTRICTED' ? scope.programs : [];
};
exports.getProgramScopeFilter = getProgramScopeFilter;
const getFirstProgramScopeFilter = (user, permissionCodes) => {
    if (user?.permissions?.includes('*') || user?.roles?.includes('admin'))
        return null;
    const permission = permissionCodes.find((code) => user?.permissions?.includes(code));
    return permission ? (0, exports.getProgramScopeFilter)(user, permission) : [];
};
exports.getFirstProgramScopeFilter = getFirstProgramScopeFilter;
