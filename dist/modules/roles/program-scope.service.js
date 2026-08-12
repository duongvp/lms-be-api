"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRoleProgramScope = exports.getRoleProgramScope = exports.listProgramResources = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const normalizeCodes = (codes = []) => Array.from(new Set(codes.map((code) => String(code || '').trim()).filter(Boolean))).sort();
const normalizeInput = (input) => {
    if (!input || !['ALL', 'RESTRICTED', 'DENY'].includes(input.mode)) {
        throw new ApiError_1.default('Scope mode không hợp lệ', 400);
    }
    const normalized = { mode: input.mode, programs: normalizeCodes(input.programs) };
    if (normalized.mode === 'RESTRICTED' && !normalized.programs.length) {
        throw new ApiError_1.default('RESTRICTED scope phải có ít nhất một Chương trình', 400);
    }
    return normalized;
};
const listProgramResources = async () => {
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    SELECT subject_code AS code, MAX(subject_name) AS display_name
    FROM lessons
    WHERE status <> 0 AND subject_code IS NOT NULL AND TRIM(subject_code) <> ''
    GROUP BY subject_code
    ORDER BY subject_code ASC
  `);
    return rows.map((row) => ({ code: row.code, displayName: row.display_name }));
};
exports.listProgramResources = listProgramResources;
const scopeFromRows = (rows) => {
    const rawMode = rows[0]?.mode;
    const mode = rawMode === 'DENY'
        ? 'DENY'
        : rawMode === 'RESTRICTED' ? 'RESTRICTED' : 'ALL';
    return {
        mode,
        programs: mode === 'RESTRICTED'
            ? normalizeCodes(rows.map((row) => row.subject_code).filter(Boolean))
            : [],
    };
};
const getRoleScopeRows = (roleIds) => roleIds.length
    ? prisma_1.default.$queryRaw(client_1.Prisma.sql `
      SELECT role_row.id AS role_id, policy.mode, binding.subjectCode AS subject_code
      FROM roles AS role_row
      LEFT JOIN role_program_scope_policies AS policy ON policy.roleId = role_row.id
      LEFT JOIN role_program_scopes AS binding ON binding.roleId = role_row.id
      WHERE role_row.id IN (${client_1.Prisma.join(roleIds)})
    `)
    : Promise.resolve([]);
const getRoleProgramScope = async (roleId) => {
    const role = await prisma_1.default.roles.findUnique({ where: { id: roleId } });
    if (!role)
        throw new ApiError_1.default('Role not found', 404);
    return scopeFromRows(await getRoleScopeRows([roleId]));
};
exports.getRoleProgramScope = getRoleProgramScope;
const updateRoleProgramScope = async (roleId, rawInput) => {
    const role = await prisma_1.default.roles.findUnique({ where: { id: roleId } });
    if (!role)
        throw new ApiError_1.default('Role not found', 404);
    const input = normalizeInput(rawInput);
    if (input.mode === 'RESTRICTED') {
        const existingPrograms = await prisma_1.default.lessons.findMany({
            where: { subject_code: { in: input.programs }, status: { not: 0 } },
            select: { subject_code: true },
            distinct: ['subject_code'],
        });
        const existingCodes = new Set(existingPrograms.map((item) => item.subject_code));
        const unknown = (input.programs || []).filter((code) => !existingCodes.has(code));
        if (unknown.length) {
            throw new ApiError_1.default(`Chương trình không tồn tại: ${unknown.join(', ')}`, 400);
        }
    }
    await prisma_1.default.$transaction(async (tx) => {
        await tx.$executeRaw(client_1.Prisma.sql `
      INSERT INTO role_program_scope_policies (roleId, mode, createdAt, updatedAt)
      VALUES (${roleId}, ${input.mode}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE mode = VALUES(mode), updatedAt = CURRENT_TIMESTAMP(3)
    `);
        await tx.$executeRaw(client_1.Prisma.sql `DELETE FROM role_program_scopes WHERE roleId = ${roleId}`);
        if (input.mode === 'RESTRICTED') {
            for (const subjectCode of input.programs || []) {
                await tx.$executeRaw(client_1.Prisma.sql `
          INSERT INTO role_program_scopes (roleId, subjectCode, createdAt)
          VALUES (${roleId}, ${subjectCode}, CURRENT_TIMESTAMP(3))
        `);
            }
        }
    });
    return (0, exports.getRoleProgramScope)(roleId);
};
exports.updateRoleProgramScope = updateRoleProgramScope;
