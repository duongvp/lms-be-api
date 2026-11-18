import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { localModerationPlan, moderationTables } from '../local-moderation/plan';

/** Schema-only operation authorized for this shared Live DB. Never seed, ALTER, or migrate other tables. */
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw Error('INVALID_ARGUMENTS');
  const target = new URL(process.env.DATABASE_URL || '');
  if (target.protocol !== 'mysql:' || target.hostname !== '42.115.41.6'
    || (target.port || '3306') !== '3306' || target.pathname !== '/livestream'
    || decodeURIComponent(target.username) !== 'tester@hocmai.vn' || target.hash) {
    throw Error('SHARED_LIVE_DATABASE_TARGET_REJECTED');
  }
  target.searchParams.set('connect_timeout', '5');
  target.searchParams.set('pool_timeout', '5');
  target.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  try {
    const identity = await db.$queryRaw<{ name: string; port: number }[]>`SELECT DATABASE() AS name, @@port AS port`;
    if (identity[0]?.name !== 'livestream' || Number(identity[0]?.port) !== 3306) throw Error('CONNECTED_DATABASE_MISMATCH');
    const tables = await db.$queryRaw<{ name: string }[]>`SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()`;
    const existing = new Set(tables.map(table => table.name));
    const root = resolve(__dirname, '../local-moderation');
    const plan = localModerationPlan(readFileSync(resolve(root, 'l1.sql'), 'utf8'), readFileSync(resolve(root, 'jev.sql'), 'utf8'), existing);
    console.log('Target: 42.115.41.6:3306/livestream');
    console.log('Existing moderation tables:', moderationTables.filter(name => existing.has(name)));
    console.log('Missing moderation tables:', plan.map(item => item.name));
    if (!args.includes('--apply')) { console.log('Read-only check complete. No changes.'); return; }
    for (const item of plan) {
      // Static DDL from reviewed Live migration, with FK definitions inside CREATE for new tables only.
      if (!/^CREATE TABLE(?: IF NOT EXISTS)? `chat_(?:l1|jev)_/.test(item.sql)) throw Error('UNEXPECTED_DDL');
      await db.$executeRawUnsafe(item.sql);
      console.log('Created:', item.name);
    }
    const verified = await db.$queryRaw<{ name: string }[]>`SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()`;
    if (!moderationTables.every(name => verified.some(table => table.name === name))) throw Error('TABLE_VERIFICATION_FAILED');
    console.log('Verified all 6 L1/JEV tables. Existing tables/data preserved. No seed, DML, reload or activation.');
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error('Schema-only initialization failed:', /^([A-Z_]+)$/.test(error?.message || '') ? error.message : 'CHECK_CONNECTION_PERMISSIONS_OR_SCHEMA');
  process.exitCode = 1;
});
