"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFirstProgramScopeFilter = exports.getProgramScopeFilter = exports.assertProgramAccess = exports.isProgramAllowed = exports.loadUserAccess = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../lib/prisma"));
const ApiError_1 = __importDefault(require("../utils/ApiError"));
const isMissingScopeSchema = (error) => (error instanceof client_1.Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2021' || (error.code === 'P2010'
        && String(error.meta?.message || '').toLowerCase().includes('doesn\'t exist'))));
const legacyAccessQuery = async (userId) => {
    const user = await prisma_1.default.users.findUnique({ where: { id: userId } });
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
const loadUserAccess = async (userId) => {
    const access = await legacyAccessQuery(userId);
    let roleScopeRows = [];
    try {
        roleScopeRows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT role_row.id AS role_id, policy.mode, binding.subjectCode AS subject_code
      FROM user_roles AS user_role
      INNER JOIN roles AS role_row
        ON role_row.id = user_role.roleId AND role_row.isActive = TRUE
      LEFT JOIN role_program_scope_policies AS policy ON policy.roleId = role_row.id
      LEFT JOIN role_program_scopes AS binding ON binding.roleId = role_row.id
      WHERE user_role.userId = ${userId}
    `);
    }
    catch (error) {
        // Code can be deployed before this additive migration. Existing RBAC must
        // remain available, but any other SQL failure must not be silently ignored.
        if (!isMissingScopeSchema(error))
            throw error;
    }
    const roles = access.userRoles.map((item) => item.role);
    const isAdmin = roles.some((role) => role.code === 'admin');
    const permissionCodes = isAdmin
        ? ['*']
        : Array.from(new Set(roles.flatMap((role) => (role.rolePermissions.map((item) => String(item.permission.code))))));
    let programScope = { mode: 'ALL', programs: [] };
    if (!isAdmin) {
        let roleMode = 'DENY';
        const rolePrograms = new Set();
        for (const role of roles) {
            const rows = roleScopeRows.filter((row) => row.role_id === role.id);
            const policyMode = rows[0]?.mode;
            // Roles created before the additive migration remain unrestricted.
            const mode = policyMode === 'DENY'
                ? 'DENY'
                : policyMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';
            if (mode === 'ALL') {
                roleMode = 'ALL';
                rolePrograms.clear();
                break;
            }
            if (mode === 'RESTRICTED') {
                roleMode = 'RESTRICTED';
                rows.filter((row) => row.subject_code)
                    .forEach((row) => rolePrograms.add(String(row.subject_code)));
            }
        }
        programScope = { mode: roleMode, programs: [...rolePrograms].sort() };
    }
    return { user: access.user, roles, permissionCodes, programScope };
};
exports.loadUserAccess = loadUserAccess;
const isProgramAllowed = (user, permissionCode, programCode) => {
    if (!user)
        return false;
    if (user.permissions?.includes('*') || user.roles?.includes('admin'))
        return true;
    if (!user.permissions?.includes(permissionCode))
        return false;
    const scope = user.programScope;
    // Legacy sessions/role permissions remain unrestricted until configured.
    if (!scope || scope.mode === 'ALL')
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
    if (!scope || scope.mode === 'ALL')
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
