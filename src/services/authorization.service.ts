import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import ApiError from '../utils/ApiError';

export type ProgramScopeMode = 'ALL' | 'RESTRICTED' | 'DENY';

export type EffectiveProgramScope = {
  mode: ProgramScopeMode;
  programs: string[];
};

export type AuthorizationUser = {
  userId: number;
  roles?: string[];
  roleIds?: string[];
  permissions?: string[];
  programScope?: EffectiveProgramScope;
};

const isMissingScopeSchema = (error: unknown) => (
  error instanceof Prisma.PrismaClientKnownRequestError
  && (error.code === 'P2021' || (
    error.code === 'P2010'
    && String(error.meta?.message || '').toLowerCase().includes('doesn\'t exist')
  ))
);

type RoleScopeRow = {
  role_id: bigint;
  mode: string | null;
  subject_code: string | null;
};

const legacyAccessQuery = async (userId: number) => {
  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError('User not found', 404);
  const userRoles = await prisma.userRoles.findMany({
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

export const loadUserAccess = async (userId: number) => {
  const access = await legacyAccessQuery(userId);
  let roleScopeRows: RoleScopeRow[] = [];
  try {
    roleScopeRows = await prisma.$queryRaw<RoleScopeRow[]>(Prisma.sql`
      SELECT role_row.id AS role_id, policy.mode, binding.subjectCode AS subject_code
      FROM user_roles AS user_role
      INNER JOIN roles AS role_row
        ON role_row.id = user_role.roleId AND role_row.isActive = TRUE
      LEFT JOIN role_program_scope_policies AS policy ON policy.roleId = role_row.id
      LEFT JOIN role_program_scopes AS binding ON binding.roleId = role_row.id
      WHERE user_role.userId = ${userId}
    `);
  } catch (error) {
    // Code can be deployed before this additive migration. Existing RBAC must
    // remain available, but any other SQL failure must not be silently ignored.
    if (!isMissingScopeSchema(error)) throw error;
  }

  const roles = access.userRoles.map((item: any) => item.role);
  const isAdmin = roles.some((role: any) => role.code === 'admin');
  const permissionCodes: string[] = isAdmin
    ? ['*']
    : Array.from(new Set<string>(roles.flatMap((role: any) => (
        role.rolePermissions.map((item: any) => String(item.permission.code))
      ))));

  let programScope: EffectiveProgramScope = { mode: 'ALL', programs: [] };
  if (!isAdmin) {
    let roleMode: ProgramScopeMode = 'DENY';
    const rolePrograms = new Set<string>();
    for (const role of roles) {
      const rows = roleScopeRows.filter((row) => row.role_id === role.id);
      const policyMode = rows[0]?.mode;
      // Roles created before the additive migration remain unrestricted.
      const mode: ProgramScopeMode = policyMode === 'DENY'
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

export const isProgramAllowed = (
  user: AuthorizationUser | undefined,
  permissionCode: string,
  programCode: string
) => {
  if (!user) return false;
  if (user.permissions?.includes('*') || user.roles?.includes('admin')) return true;
  if (!user.permissions?.includes(permissionCode)) return false;
  const scope = user.programScope;
  // Legacy sessions/role permissions remain unrestricted until configured.
  if (!scope || scope.mode === 'ALL') return true;
  if (scope.mode === 'DENY') return false;
  return scope.programs.includes(String(programCode).trim());
};

export const assertProgramAccess = (
  user: AuthorizationUser | undefined,
  permissionCode: string,
  programCode: string
) => {
  const code = String(programCode || '').trim();
  if (!code || !isProgramAllowed(user, permissionCode, code)) {
    throw new ApiError('Không có quyền thao tác trên Chương trình này', 403);
  }
};

export const getProgramScopeFilter = (
  user: AuthorizationUser | undefined,
  permissionCode: string
): string[] | null => {
  if (!user) return [];
  if (user.permissions?.includes('*') || user.roles?.includes('admin')) return null;
  if (!user.permissions?.includes(permissionCode)) return [];
  const scope = user.programScope;
  if (!scope || scope.mode === 'ALL') return null;
  return scope.mode === 'RESTRICTED' ? scope.programs : [];
};

export const getFirstProgramScopeFilter = (
  user: AuthorizationUser | undefined,
  permissionCodes: string[]
) => {
  if (user?.permissions?.includes('*') || user?.roles?.includes('admin')) return null;
  const permission = permissionCodes.find((code) => user?.permissions?.includes(code));
  return permission ? getProgramScopeFilter(user, permission) : [];
};
