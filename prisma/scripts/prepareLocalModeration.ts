import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertLocalModerationUrl, localModerationPlan, moderationTables } from '../local-moderation/plan';
import { seedChatL1 } from '../local-moderation/seed-live-l1';
import { compileJevDeploymentSeed } from '../../src/modules/jev/vendor/chat-jev/deployment-seed';
import { createJevCompactBundle } from '../../src/modules/jev/vendor/chat-jev/compact-contract';
import { createJevPolicyDraft } from '../../src/modules/jev/vendor/chat-jev/compact-policy-store';
import { jevRuntimeJson } from '../../src/modules/jev/vendor/chat-jev/runtime-settings';
import { defaultJevSettings } from '../../src/modules/jev/vendor/chat-jev/config';
import { JEV_PERMISSIONS } from '../../src/modules/jev/jev.permissions';

async function main() {
  // Guard before constructing a client; no fallback URL or remote connection is possible here.
  const url = assertLocalModerationUrl(process.env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const identity = await db.$queryRaw<{ name: string }[]>`SELECT DATABASE() AS name`;
    if (identity[0]?.name !== 'livestream_local') throw Error('LOCAL_DATABASE_MISMATCH');
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()`;
    const existing = new Set(tables.map(row => row.name));
    const root = resolve(__dirname, '../local-moderation');
    const plan = localModerationPlan(readFileSync(resolve(root, 'l1.sql'), 'utf8'), readFileSync(resolve(root, 'jev.sql'), 'utf8'), existing);
    console.log('Target: localhost:3306/livestream_local. Only missing moderation tables will be created.');
    // MySQL DDL is not transactional. Each statement is independently resumable; no existing table ALTER/DROP.
    for (const item of plan) { await db.$executeRawUnsafe(item.sql); console.log('Created:', item.name); }

    const global = await db.chat_l1_settings.findUnique({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } });
    if (!global) {
      if (await db.chat_l1_lexicon.count()) throw Error('EXISTING_L1_ENTRIES_WITHOUT_GLOBAL_REQUIRES_REVIEW');
      // Reuse Live seed, explicitly off for fresh local initialization regardless of the shell ENV.
      const previous = process.env.CHAT_L1_MODE;
      try { process.env.CHAT_L1_MODE = 'off'; console.log('L1 seed inserted:', await seedChatL1(db)); }
      finally { if (previous === undefined) delete process.env.CHAT_L1_MODE; else process.env.CHAT_L1_MODE = previous; }
    } else console.log('Preserved existing L1 GLOBAL and lexicon.');

    // Use the genuine Live seed/compiler; never backfill or overwrite an existing runtime row.
    await db.chat_jev_bindings.createMany({ data: [{ scope_type: 'GLOBAL', scope_key: '*', mode: 'off',
      runtime_json: jevRuntimeJson(defaultJevSettings()), updated_by: 'system_seed:chat-jev' }], skipDuplicates: true });
    const { data, policy, rubric } = compileJevDeploymentSeed();
    const found = await db.chat_jev_policy_versions.findUnique({ where: { policy_key_revision: { policy_key: data.policyKey, revision: data.revision } } });
    if (!found) await createJevPolicyDraft(db, { policyKey: data.policyKey, revision: data.revision,
      actor: 'system_seed:chat-jev-c2', config: createJevCompactBundle(policy, rubric.runtime).config });
    console.log('JEV seed:', found ? 'existing version preserved' : 'DRAFT created from Live seed');

    // Add only missing feature permissions; leave existing roles, users and grants untouched.
    const rbacTables = ['modules', 'roles', 'permissions', 'rolePermissions'];
    if (rbacTables.every(name => existing.has(name))) await db.$transaction(async tx => {
      await tx.modules.upsert({ where: { code: 'jev' }, update: {}, create: { code: 'jev', name: 'Kiểm duyệt JEV' } });
      const admin = await tx.roles.findUnique({ where: { code: 'admin' } });
      for (const [code, name] of JEV_PERMISSIONS) {
        const permission = await tx.permissions.upsert({ where: { code }, update: {}, create: { code, name, description: 'Quản trị L1/JEV toàn hệ thống; yêu cầu phạm vi ALL' } });
        if (admin) await tx.rolePermissions.upsert({ where: { roleId_permissionId: { roleId: admin.id, permissionId: permission.id } }, update: {}, create: { roleId: admin.id, permissionId: permission.id } });
      }
      console.log('Added missing L1/JEV permissions and admin grants.');
    });
    else console.log('RBAC schema incomplete; skipped permission initialization.');

    const counts: Record<string, number> = {};
    for (const table of moderationTables) {
      const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
      counts[table] = Number(rows[0].count);
    }
    console.log('Moderation row counts:', counts);
    console.log('Initialization complete. No publish, enable, reload, state or ledger mutation performed.');
  } finally { await db.$disconnect(); }
}

if (require.main === module) main().catch(error => {
  // Avoid printing connection strings, SQL, provider tokens or database contents.
  console.error('Local initialization failed:', /^([A-Z_]+)$/.test(error?.message || '') ? error.message : 'CHECK_LOCAL_DB_OR_EXISTING_SCHEMA');
  process.exitCode = 1;
});
