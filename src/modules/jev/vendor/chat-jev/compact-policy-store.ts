import { Prisma, type PrismaClient, type chat_jev_policy_versions as Version } from '@prisma/client';
import { compileJevCompactBundle, validateJevCompactDraft } from './compact-contract';
import { assertJevFrameworkCompatible } from './framework';

export type JevPolicyDatabase = Pick<PrismaClient, '$transaction'>;
export const jevTransaction = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 5000 };
export const jevJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/** Chỉ so dữ liệu storage/import; không thay thuật toán hash policy/request đã publish. */
export function sameJevJson(a: unknown, b: unknown): boolean {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function validateJevActor(actor: string) {
  if (typeof actor !== 'string' || !actor.trim() || actor.trim() !== actor || actor.length > 100) throw Error('INVALID_JEV_ACTOR');
}
export function validateJevIdentity(key: string, revision: number) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key) || !Number.isSafeInteger(revision) || revision < 1 || revision > 4294967295)
    throw Error('INVALID_JEV_IDENTITY');
}
/** Kiểm hash sau compile, không tin cột hash hoặc JSON được sửa tay là một snapshot hợp lệ. */
export function compileCompactJevVersion(version: Version) {
  validateJevIdentity(version.policy_key, version.revision);
  const result = compileJevCompactBundle(version.config_json);
  if (result.policy.version !== version.policy_key + ':r' + version.revision || version.edit_revision < 1
    || !['DRAFT', 'PUBLISHED'].includes(version.status)) throw Error('INVALID_JEV_DATABASE_POLICY');
  if (version.status === 'PUBLISHED' && (version.policy_hash !== result.hash || version.rubric_hash !== result.rubricHash
    || version.bundle_hash !== result.bundleHash || !version.published_by || !version.published_at)) throw Error('JEV_PUBLISHED_HASH_MISMATCH');
  return { ...result, version };
}
export async function readJevPolicyTransaction(tx: Prisma.TransactionClient, id: number) {
  return compileCompactJevVersion(await tx.chat_jev_policy_versions.findUniqueOrThrow({ where: { id } }));
}
export async function createJevPolicyDraft(db: JevPolicyDatabase, input: { policyKey: string; revision: number; actor: string; config: unknown }) {
  validateJevActor(input.actor); validateJevIdentity(input.policyKey, input.revision);
  const config = validateJevCompactDraft(input.config);
  return db.$transaction(tx => tx.chat_jev_policy_versions.create({ data: { policy_key: input.policyKey,
    revision: input.revision, created_by: input.actor, config_json: jevJson(config) } }), jevTransaction);
}
/** Khóa header + CAS; không có đường sửa nội dung PUBLISHED. */
export async function replaceJevPolicyDraft(db: JevPolicyDatabase, input: { id: number; expectedEditRevision: number; actor: string; config: unknown }) {
  validateJevActor(input.actor); const config = validateJevCompactDraft(input.config);
  return db.$transaction(async tx => {
    // UPDATE có predicate revision ngay tại MySQL, không phụ thuộc SELECT/UPDATE tách của ORM.
    const changed = await tx.$executeRaw`UPDATE chat_jev_policy_versions SET config_json=${JSON.stringify(config)},
      edit_revision=edit_revision+1, updated_at=CURRENT_TIMESTAMP(3)
      WHERE id=${input.id} AND status='DRAFT' AND edit_revision=${input.expectedEditRevision}`;
    if (changed !== 1) throw Error('JEV_POLICY_EDIT_CONFLICT');
    return tx.chat_jev_policy_versions.findUniqueOrThrow({ where: { id: input.id } });
  }, jevTransaction);
}
/** Định danh nhóm/counter đã publish phải giữ ý nghĩa; thêm/retire được, tái dùng mã khác nghĩa bị chặn. */
export async function assertCompactJevIdentity(tx: Prisma.TransactionClient, next: ReturnType<typeof compileJevCompactBundle>['policy']) {
  const rows = await tx.chat_jev_policy_versions.findMany({ where: { status: 'PUBLISHED' }, take: 513 });
  if (rows.length > 512) throw Error('JEV_POLICY_HISTORY_LIMIT');
  for (const row of rows) {
    const old = compileCompactJevVersion(row).policy;
    if (old.framework && next.framework) assertJevFrameworkCompatible(old.framework, next.framework);
    for (const c of next.counters ?? []) {
      const before = old.counters?.find(k => k.key === c.key);
      const kind = c.key === 'PII' ? 'INCIDENT' : ['SPAM', 'ABUSE'].includes(c.key) ? 'STRIKE' : null;
      if (kind && c.kind !== kind || before && (before.kind !== c.kind || before.window !== c.window)) throw Error('JEV_COUNTER_IDENTITY_CONFLICT');
    }
  }
}
export async function publishJevPolicy(db: JevPolicyDatabase, input: { id: number; expectedEditRevision: number; actor: string }) {
  validateJevActor(input.actor);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM chat_jev_policy_versions WHERE id=${input.id} FOR UPDATE`;
    const c = await readJevPolicyTransaction(tx, input.id);
    if (c.version.status !== 'DRAFT') throw Error('JEV_PUBLISHED_IMMUTABLE');
    await assertCompactJevIdentity(tx, c.policy);
    if (c.policy.schemaVersion === 3 && (c.policy.safetySignalMin === null || c.policy.rules.some(r => Object.values(r.gates).some(g => g.enabled
      && [g.pCategoryMin, g.categoryConfidenceMin, g.pSeverityMin, g.severityConfidenceMin].some(v => v === null))))) throw Error('JEV_UNCALIBRATED_POLICY');
    const changed = await tx.chat_jev_policy_versions.updateMany({ where: { id: input.id, status: 'DRAFT', edit_revision: input.expectedEditRevision }, data: {
      status: 'PUBLISHED', bundle_hash: c.bundleHash, policy_hash: c.hash, rubric_hash: c.rubricHash, published_by: input.actor, published_at: new Date() } });
    if (changed.count !== 1) throw Error('JEV_POLICY_EDIT_CONFLICT');
    return { versionId: input.id, policyVersion: c.policy.version, contentHash: c.hash, bundleHash: c.bundleHash };
  }, { ...jevTransaction, isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
export async function cloneJevPolicyDraft(db: JevPolicyDatabase, input: { id: number; policyKey: string; revision: number; actor: string }) {
  const c = await db.$transaction(tx => readJevPolicyTransaction(tx, input.id), jevTransaction);
  return createJevPolicyDraft(db, { ...input, config: { ...c.config, policy: { ...c.policy, version: input.policyKey + ':r' + input.revision } } });
}
