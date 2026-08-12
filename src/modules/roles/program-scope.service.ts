import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import { EffectiveProgramScope, ProgramScopeMode } from '../../services/authorization.service';

type ProgramScopeInput = {
  mode: ProgramScopeMode;
  programs?: string[];
};

type ScopeRow = {
  role_id: bigint;
  mode: string | null;
  subject_code: string | null;
};

const normalizeCodes = (codes: unknown[] = []) => Array.from(new Set(
  codes.map((code) => String(code || '').trim()).filter(Boolean)
)).sort();

const normalizeInput = (input: ProgramScopeInput): ProgramScopeInput => {
  if (!input || !['ALL', 'RESTRICTED', 'DENY'].includes(input.mode)) {
    throw new ApiError('Scope mode không hợp lệ', 400);
  }
  const normalized = { mode: input.mode, programs: normalizeCodes(input.programs) };
  if (normalized.mode === 'RESTRICTED' && !normalized.programs.length) {
    throw new ApiError('RESTRICTED scope phải có ít nhất một Chương trình', 400);
  }
  return normalized;
};

export const listProgramResources = async () => {
  const rows = await prisma.$queryRaw<Array<{ code: string; display_name: string | null }>>(Prisma.sql`
    SELECT subject_code AS code, MAX(subject_name) AS display_name
    FROM lessons
    WHERE status <> 0 AND subject_code IS NOT NULL AND TRIM(subject_code) <> ''
    GROUP BY subject_code
    ORDER BY subject_code ASC
  `);
  return rows.map((row) => ({ code: row.code, displayName: row.display_name }));
};

const scopeFromRows = (rows: ScopeRow[]): EffectiveProgramScope => {
  const rawMode = rows[0]?.mode;
  const mode: ProgramScopeMode = rawMode === 'DENY'
    ? 'DENY'
    : rawMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';
  return {
    mode,
    programs: mode === 'RESTRICTED'
      ? normalizeCodes(rows.map((row) => row.subject_code).filter(Boolean) as string[])
      : [],
  };
};

const getRoleScopeRows = (roleIds: bigint[]) => roleIds.length
  ? prisma.$queryRaw<ScopeRow[]>(Prisma.sql`
      SELECT role_row.id AS role_id, policy.mode, binding.subjectCode AS subject_code
      FROM roles AS role_row
      LEFT JOIN role_program_scope_policies AS policy ON policy.roleId = role_row.id
      LEFT JOIN role_program_scopes AS binding ON binding.roleId = role_row.id
      WHERE role_row.id IN (${Prisma.join(roleIds)})
    `)
  : Promise.resolve([]);

export const getRoleProgramScope = async (roleId: bigint) => {
  const role = await prisma.roles.findUnique({ where: { id: roleId } });
  if (!role) throw new ApiError('Role not found', 404);
  return scopeFromRows(await getRoleScopeRows([roleId]));
};

export const updateRoleProgramScope = async (roleId: bigint, rawInput: ProgramScopeInput) => {
  const role = await prisma.roles.findUnique({ where: { id: roleId } });
  if (!role) throw new ApiError('Role not found', 404);
  const input = normalizeInput(rawInput);

  if (input.mode === 'RESTRICTED') {
    const existingPrograms = await prisma.lessons.findMany({
      where: { subject_code: { in: input.programs }, status: { not: 0 } },
      select: { subject_code: true },
      distinct: ['subject_code'],
    });
    const existingCodes = new Set(existingPrograms.map((item) => item.subject_code));
    const unknown = (input.programs || []).filter((code) => !existingCodes.has(code));
    if (unknown.length) {
      throw new ApiError(`Chương trình không tồn tại: ${unknown.join(', ')}`, 400);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO role_program_scope_policies (roleId, mode, createdAt, updatedAt)
      VALUES (${roleId}, ${input.mode}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE mode = VALUES(mode), updatedAt = CURRENT_TIMESTAMP(3)
    `);
    await tx.$executeRaw(Prisma.sql`DELETE FROM role_program_scopes WHERE roleId = ${roleId}`);
    if (input.mode === 'RESTRICTED') {
      for (const subjectCode of input.programs || []) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO role_program_scopes (roleId, subjectCode, createdAt)
          VALUES (${roleId}, ${subjectCode}, CURRENT_TIMESTAMP(3))
        `);
      }
    }
  });
  return getRoleProgramScope(roleId);
};
