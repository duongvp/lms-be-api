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

type UserScopeRow = {
  mode: string;
  subject_code: string | null;
};

const positiveConfigNumber = (value: string | undefined, fallback: number, minimum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
};
const ACCESS_CACHE_TTL_MS = positiveConfigNumber(
  process.env.AUTHORIZATION_CACHE_TTL_MS,
  30_000,
  1_000
);
const ACCESS_CACHE_MAX_ENTRIES = positiveConfigNumber(
  process.env.AUTHORIZATION_CACHE_MAX_ENTRIES,
  1_000,
  100
);
type LoadedUserAccess = Awaited<ReturnType<typeof loadUserAccessUncached>>;
const accessCache = new Map<number, {
  expiresAt: number;
  promise: Promise<LoadedUserAccess>;
}>();

const trimAccessCache = () => {
  const now = Date.now();
  for (const [userId, entry] of accessCache) {
    if (entry.expiresAt <= now) accessCache.delete(userId);
  }
  while (accessCache.size >= ACCESS_CACHE_MAX_ENTRIES) {
    const oldestUserId = accessCache.keys().next().value;
    if (oldestUserId === undefined) break;
    accessCache.delete(oldestUserId);
  }
};

const legacyAccessQuery = async (userId: number, preloadedUser?: any) => {
  const user = preloadedUser ?? await prisma.users.findUnique({ where: { id: userId } });
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

const loadUserAccessUncached = async (userId: number, preloadedUser?: any) => {
  const access = await legacyAccessQuery(userId, preloadedUser);
  let userScopeRows: UserScopeRow[] = [];
  try {
    userScopeRows = await prisma.$queryRaw<UserScopeRow[]>(Prisma.sql`
      SELECT policy.mode, resource.scopeKey AS subject_code
      FROM user_program_scope_policies AS policy
      LEFT JOIN user_program_scopes AS binding ON binding.userId = policy.userId
      LEFT JOIN scope_resources AS resource
        ON resource.id = binding.scopeResourceId
        AND resource.scopeType = 'PROGRAM'
        AND resource.status = 'ACTIVE'
      WHERE policy.userId = ${userId}
    `);
  } catch (error) {
    // Rolling deploy compatibility. Without the new tables, non-admin users
    // receive DENY below instead of accidentally gaining every program.
    if (!isMissingScopeSchema(error)) throw error;
  }

  const roles = access.userRoles.map((item: any) => item.role);
  const isAdmin = roles.some((role: any) => role.code === 'admin');
  const permissionCodes: string[] = isAdmin
    ? ['*']
    : Array.from(new Set<string>(roles.flatMap((role: any) => (
        role.rolePermissions.map((item: any) => String(item.permission.code))
      ))));

  let programScope: EffectiveProgramScope = isAdmin
    ? { mode: 'ALL', programs: [] }
    : { mode: 'DENY', programs: [] };
  if (!isAdmin) {
    if (userScopeRows.length) {
      const rawMode = userScopeRows[0].mode;
      const mode: ProgramScopeMode = rawMode === 'DENY'
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

export const loadUserAccess = async (userId: number, preloadedUser?: any) => {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) accessCache.delete(userId);

  trimAccessCache();
  const promise = loadUserAccessUncached(userId, preloadedUser);
  accessCache.set(userId, {
    expiresAt: Date.now() + ACCESS_CACHE_TTL_MS,
    promise,
  });
  try {
    return await promise;
  } catch (error) {
    if (accessCache.get(userId)?.promise === promise) accessCache.delete(userId);
    throw error;
  }
};

export const invalidateUserAccessCache = (userId?: number) => {
  if (userId === undefined) accessCache.clear();
  else accessCache.delete(userId);
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
  if (!scope) return false;
  if (scope.mode === 'ALL') return true;
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
  if (!scope) return [];
  if (scope.mode === 'ALL') return null;
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
