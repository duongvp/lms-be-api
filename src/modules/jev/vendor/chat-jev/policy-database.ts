import { Prisma, type chat_jev_bindings as Binding } from '@prisma/client';
import { createHash } from 'node:crypto';
import { type JevShadowPolicy } from './shadow-policy';
import { type JevRuntimeRubric } from './runtime-rubric';
import { assertJevFrameworkCompatible, jevHash } from './framework';
import { defaultJevSettings, resolveJevMode, type JevMode } from './config';
import { projectJevSettings } from './runtime-settings';
import { readJevPolicyTransaction, compileCompactJevVersion, assertCompactJevIdentity, jevTransaction as transaction, validateJevActor as actor, type JevPolicyDatabase } from './compact-policy-store';
export { type JevPolicyDatabase, readJevPolicyTransaction, publishJevPolicy } from './compact-policy-store';
export { compileJevDatabaseVersion } from './legacy-projection';
export const JEV_POLICY_CHANNEL = 'chat:jev:policy_reload';
const MAX_BINDINGS = 1000, MAX_VERSIONS = 128;
// Lịch đã kết thúc không cần giữ override trong RAM. Hàng DB/tombstone vẫn còn để
// đối soát revision; lịch không có end_time được giữ để tránh suy đoán đã hết buổi.
const liveBindingSource = Prisma.sql`FROM chat_jev_bindings b LEFT JOIN calendar c
    ON b.scope_type='CALENDAR' AND c.id=CAST(b.scope_key AS UNSIGNED)
    WHERE b.scope_type<>'CALENDAR' OR c.end_time IS NULL OR c.end_time>CURRENT_TIMESTAMP(3)`;
const invalid = (): never => { throw Error('INVALID_JEV_DATABASE_POLICY'); };
const positive = (v: number) => Number.isSafeInteger(v) && v > 0 && v <= 4294967295;
/** Binding CODE dùng đúng mã đã xác thực, không tự lowercase hay suy diễn từ tên môn. */
export function jevScopeKey(type: string, key: string) {
    if (type === 'GLOBAL' && key === '*')
        return 'GLOBAL:*';
    if (type === 'CALENDAR' && /^[1-9]\d{0,9}$/.test(key) && positive(Number(key)))
        return 'CALENDAR:' + key;
    if (type === 'CODE' && typeof key === 'string' && key.trim() === key && key.length > 0 && key.length <= 30
        && !/[\p{Cc}\p{Cf}]/u.test(key))
        return 'CODE:' + key;
    return invalid();
}
export function readJevPolicyForPreview(db: JevPolicyDatabase, id: number) {
    if (!positive(id)) return Promise.reject(Error('INVALID_JEV_DATABASE_POLICY'));
    return db.$transaction(tx => readJevPolicyTransaction(tx, id), transaction);
}
export const readJevPolicyForValidation = readJevPolicyForPreview;
export function readJevCalendarCode(db: JevPolicyDatabase, id: number) {
    if (!positive(id)) return Promise.reject(Error('INVALID_JEV_DATABASE_POLICY'));
    return db.$transaction(async tx => {
        const row = await tx.calendar.findUnique({ where: { id }, select: { code: true } });
        if (!row) return invalid();
        return row.code;
    }, transaction);
}
/** CAS chống hai Admin ghi đè nhau. INHERIT là tombstone giữ revision, không phải OFF. */
export async function bindJevPolicy(db: JevPolicyDatabase, input: {
    scopeType: string;
    scopeKey: string;
    mode: 'off' | 'shadow' | 'enforce' | 'inherit';
    policyVersionId: number | null;
    expectedRevision: number;
    actor: string;
}) {
    actor(input.actor);
    jevScopeKey(input.scopeType, input.scopeKey);
    const active = input.mode === 'shadow' || input.mode === 'enforce';
    if (!['off', 'shadow', 'enforce', 'inherit'].includes(input.mode) || input.scopeType === 'GLOBAL' && input.mode === 'inherit'
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 4294967295
        || input.policyVersionId !== null && !positive(input.policyVersionId)
        || !active && input.policyVersionId !== null || active && input.policyVersionId === null)
        return invalid();
    return db.$transaction(async (tx) => {
        if (input.scopeType === 'CALENDAR' && !await tx.calendar.findUnique({ where: { id: Number(input.scopeKey) }, select: { id: true } }))
            invalid();
        if (input.scopeType === 'CODE') {
            const scope = await tx.calendar.findFirst({ where: { code: input.scopeKey }, select: { code: true } });
            // DB lịch cũ có thể collation không phân biệt hoa/thường; cache binding thì so chính xác.
            if (!scope || scope.code !== input.scopeKey)
                invalid();
        }
        if (input.policyVersionId !== null) {
            const target = await readJevPolicyTransaction(tx, input.policyVersionId);
            if (target.version.status !== 'PUBLISHED')
                invalid();
            await assertCompactJevIdentity(tx, target.policy);
            const existing = await tx.chat_jev_bindings.findUnique({ where: { scope_type_scope_key: { scope_type: input.scopeType, scope_key: input.scopeKey } } });
            if (existing?.policy_version_id && existing.policy_version_id !== input.policyVersionId) {
                const old = await readJevPolicyTransaction(tx, existing.policy_version_id);
                if (old.policy.framework && target.policy.framework)
                    assertJevFrameworkCompatible(old.policy.framework, target.policy.framework);
            }
        }
        const where = { scope_type: input.scopeType, scope_key: input.scopeKey };
        const data = { mode: input.mode, policy_version_id: input.policyVersionId, updated_by: input.actor };
        if (input.expectedRevision === 0) {
            let created: Binding;
            try {
                created = await tx.chat_jev_bindings.create({ data: { ...where, ...data, revision: 1 } });
            }
            catch {
                throw new Error('JEV_BINDING_CONFLICT');
            }
            // Chặn ghi scope vượt sức chứa ngay tại transaction, thay vì lưu xong
            // mới phát hiện mọi worker không nạp được. GLOBAL vẫn có đường tắt riêng.
            if (input.scopeType !== 'GLOBAL') {
                const counts = await tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) total ${liveBindingSource}`);
                if (Number(counts[0]?.total) > MAX_BINDINGS) throw Error('JEV_BINDING_LIMIT');
            }
            return created;
        }
        const changed = await tx.$executeRaw `UPDATE chat_jev_bindings SET mode=${input.mode},policy_version_id=${input.policyVersionId},
      updated_by=${input.actor},revision=revision+1,updated_at=CURRENT_TIMESTAMP(3)
      WHERE scope_type=${input.scopeType} AND scope_key=${input.scopeKey} AND revision=${input.expectedRevision}`;
        if (changed !== 1)
            throw new Error('JEV_BINDING_CONFLICT');
        return tx.chat_jev_bindings.findUniqueOrThrow({ where: { scope_type_scope_key: where } });
    }, { ...transaction, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function readSnapshot(db: JevPolicyDatabase, previous?: {
    byScope: ReadonlyMap<string, Binding>;
}) {
    return db.$transaction(async (tx) => {
        // Thường hai SELECT cấu hình/snapshot; thêm một lượt xác nhận theo lô khi
        // calendar vừa bị kết thúc sớm. Không truy vấn từng rule/nhóm/mức hoặc từng tin.
        const rawBindings = await tx.$queryRaw<Array<Omit<Binding, 'id' | 'revision' | 'policy_version_id'> & {
            id: bigint | number; revision: bigint | number; policy_version_id: bigint | number | null; scope_end_ms: bigint | null;
        }>>(Prisma.sql`
          SELECT b.*, CAST(UNIX_TIMESTAMP(c.end_time)*1000 AS UNSIGNED) scope_end_ms ${liveBindingSource}
          ORDER BY (b.scope_type='GLOBAL' AND b.scope_key='*') DESC,b.id ASC LIMIT ${MAX_BINDINGS + 1}`);
        // Raw MySQL trả UNSIGNED INT thành bigint; các cột này chỉ thuộc dải UInt32.
        const normalizeBinding = (row: typeof rawBindings[number]) => ({ ...row, id: Number(row.id), revision: Number(row.revision),
            policy_version_id: row.policy_version_id === null ? null : Number(row.policy_version_id) });
        const bindings = rawBindings.map(normalizeBinding);
        const byScope = new Map<string, Binding>();
        const retiredScopes = new Map<string, Binding>();
        const add = (row: Binding & { scope_end_ms?: bigint | null }) => {
            const key = jevScopeKey(row.scope_type, row.scope_key), active = ['shadow', 'enforce'].includes(row.mode);
            if (byScope.has(key) || !positive(row.revision) || !['off', 'shadow', 'enforce', 'inherit'].includes(row.mode) || row.scope_type === 'GLOBAL' && row.mode === 'inherit'
                || active && row.policy_version_id === null || !active && row.policy_version_id !== null || key !== 'GLOBAL:*' && row.runtime_json !== null)
                invalid();
            byScope.set(key, { ...row });
            if (row.scope_type === 'CALENDAR' && row.scope_end_ms != null) {
                const end = Number(row.scope_end_ms);
                if (!Number.isSafeInteger(end) || end <= 0) invalid();
            }
            return key;
        };
        const global = bindings.find(row => row.scope_type === 'GLOBAL' && row.scope_key === '*');
        if (!global)
            return invalid();
        add(global);
        const settings = global.runtime_json === null ? null : projectJevSettings(global);
        // Đọc công tắc tổng trước giới hạn/validate scope con: DB off luôn áp được
        // kể cả snapshot phòng quá đầy/hỏng. Giữ revision scope cũ để bật lại không
        // vô tình chấp nhận rollback; không nạp policy hoặc thực thi từ phần cache này.
        if (settings?.mode === 'off') {
            for (const [key, row] of previous?.byScope ?? []) if (key !== 'GLOBAL:*') byScope.set(key, row);
        } else {
            if (bindings.length > MAX_BINDINGS) invalid();
            for (const row of bindings) if (row !== global) add(row);
            const missingCalendars = [...previous?.byScope.keys() ?? []]
                .filter(key => key.startsWith('CALENDAR:') && !byScope.has(key)).map(key => key.slice(9));
            if (missingCalendars.length) {
                // Buổi có thể kết thúc sớm hơn deadline cache. Xác nhận cả lô từ DB
                // để phân biệt scope hết buổi với DELETE cấu hình đang còn hiệu lực.
                const retired = await tx.$queryRaw<typeof rawBindings>(Prisma.sql`
                  SELECT b.*, CAST(UNIX_TIMESTAMP(c.end_time)*1000 AS UNSIGNED) scope_end_ms
                  FROM chat_jev_bindings b JOIN calendar c ON c.id=CAST(b.scope_key AS UNSIGNED)
                  WHERE b.scope_type='CALENDAR' AND b.scope_key IN (${Prisma.join(missingCalendars)})
                    AND c.end_time<=CURRENT_TIMESTAMP(3) LIMIT ${MAX_BINDINGS}`);
                for (const raw of retired) {
                    const row = normalizeBinding(raw), key = add(row);
                    byScope.delete(key); retiredScopes.set(key, row);
                }
            }
        }
        const ids = settings?.mode === 'off' ? [] : [...new Set(bindings.flatMap(b => b.policy_version_id === null ? [] : [b.policy_version_id]))];
        if (ids.length > MAX_VERSIONS)
            invalid();
        const headers = ids.length ? await tx.chat_jev_policy_versions.findMany({ where: { id: { in: ids } }, take: MAX_VERSIONS + 1 }) : [];
        if (headers.length !== ids.length)
            invalid();
        const versions = new Map<number, ReturnType<typeof compileCompactJevVersion>>(), rubrics = new Map<string, JevRuntimeRubric>();
        for (const h of headers) {
            if (h.status !== 'PUBLISHED')
                invalid();
            const c = compileCompactJevVersion(h);
            versions.set(h.id, c);
            rubrics.set(JSON.stringify([c.rubric.modelVersion, c.rubric.rubricVersion]), c.rubric);
        }
        if (Buffer.byteLength(JSON.stringify([...headers])) > 16 * 1024 * 1024)
            invalid();
        const digest = createHash('sha256').update(JSON.stringify([settings, [...byScope].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [k, r.mode, r.revision, r.policy_version_id]), [...versions].sort(([a], [b]) => a - b).map(([id, c]) => [id, c.bundleHash])])).digest('hex');
        // Tách hash mode khỏi hash nội dung guide: hạ/tắt scope phải hủy engine cũ,
        // nhưng chỉ thay guide vẫn giữ cơ chế ghim snapshot của job đang chạy.
        const modeDigest = createHash('sha256').update(JSON.stringify([...byScope].sort(([a], [b]) => a.localeCompare(b))
            .map(([key, row]) => [key, row.mode]))).digest('hex');
        return { byScope, retiredScopes, versions, rubrics, digest, modeDigest, settings };
    }, transaction);
}
/** Một snapshot RAM nguyên khối, không query trong resolve; lỗi reload giữ bản tốt gần nhất. */
export function createJevPolicyManager(options: {
    env?: Readonly<Record<string, string | undefined>>;
} = {}) {
    const environment = options.env ?? process.env;
    const fallbackSettings = defaultJevSettings(environment);
    let current: Awaited<ReturnType<typeof readSnapshot>> | undefined, loadedAt: string | null = null;
    let inFlight: Promise<void> | undefined, pending = false, closed = false, lastError: string | null = null;
    const knownHashes = new Map<number, string>();
    const listeners = new Set<() => void>();
    const scopeMode = (calendarId: number, code?: string): JevMode => {
        if (closed || !current || !positive(calendarId))
            return 'off';
        const master = resolveJevMode(environment, (current.settings ?? fallbackSettings).mode);
        if (master === 'off')
            return 'off';
        for (const key of ['CALENDAR:' + calendarId, ...(code ? ['CODE:' + code] : []), 'GLOBAL:*']) {
            const row = current.byScope.get(key);
            if (!row || row.mode === 'inherit')
                continue;
            // Scope chỉ thu hẹp trần ENV và GLOBAL.runtime_json, không được vượt shadow/off.
            return row.mode === 'enforce' && master === 'enforce' ? 'enforce' : row.mode === 'off' ? 'off' : 'shadow';
        }
        return 'off';
    };
    return {
        metadata: () => ({ runtimeContract: 3, source: current ? 'database' : 'unloaded', snapshotHash: current?.digest ?? null, modeHash: current?.modeDigest ?? null,
            bindingCount: current?.byScope.size ?? 0, versionCount: current?.versions.size ?? 0,
            rubricCount: current?.rubrics.size ?? 0, loadedAt, lastError,
            runtime: { source: current?.settings ? 'database' : 'fallback', settings: current?.settings ?? fallbackSettings } }),
        settings: () => current?.settings ?? fallbackSettings,
        resolveMode: scopeMode,
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        /** Lookup RAM đồng bộ theo hash của policy, tuyệt đối không truy vấn trong mỗi tin. */
        resolveRubric(policy: JevShadowPolicy): JevRuntimeRubric | null {
            if (closed || !current)
                return null;
            return current.rubrics.get(JSON.stringify([policy.modelVersion, policy.rubricVersion])) ?? null;
        },
        resolve(calendarId: number, code?: string): JevShadowPolicy | null {
            if (closed || !current || !positive(calendarId))
                return null;
            const keys = ['CALENDAR:' + calendarId, ...(code ? ['CODE:' + code] : []), 'GLOBAL:*'];
            for (const key of keys) {
                const binding = current.byScope.get(key);
                if (!binding || binding.mode === 'inherit')
                    continue;
                return (binding.mode === 'shadow' || binding.mode === 'enforce') && binding.policy_version_id !== null
                    ? current.versions.get(binding.policy_version_id)?.policy ?? null : null;
            }
            return null;
        },
        reload(db: JevPolicyDatabase): Promise<void> {
            if (closed)
                return Promise.reject(new Error('JEV_POLICY_CLOSED'));
            pending = true;
            if (inFlight)
                return inFlight;
            inFlight = (async () => {
                do {
                    pending = false;
                    try {
                        const next = await readSnapshot(db, current);
                        if (closed)
                            return;
                        if (current?.settings && (!next.settings || next.settings.revision < current.settings.revision
                            || next.settings.revision === current.settings.revision && jevHash(next.settings) !== jevHash(current.settings)))
                            invalid();
                        for (const [key, old] of current?.byScope ?? []) {
                            const row = next.byScope.get(key) ?? next.retiredScopes.get(key);
                            // Chỉ bỏ scope khi DB xác nhận đã hết buổi và hàng binding
                            // vẫn còn. Không suy từ deadline cache vì lịch có thể vừa gia hạn.
                            // Bỏ override bằng inherit và tăng revision; không DELETE khiến worker hiểu nhầm fallback.
                            if (!row || row.revision < old.revision || row.revision === old.revision
                                && (row.mode !== old.mode || row.policy_version_id !== old.policy_version_id))
                                return invalid();
                            if (next.retiredScopes.has(key)) continue;
                            const before = old.policy_version_id ? current?.versions.get(old.policy_version_id)?.policy : null;
                            const after = row.policy_version_id ? next.versions.get(row.policy_version_id)?.policy : null;
                            if (before?.framework && after?.framework)
                                assertJevFrameworkCompatible(before.framework, after.framework);
                            if (before?.counters && after?.counters)
                                for (const c of before.counters) {
                                    const updated = after.counters.find(n => n.key === c.key);
                                    if (updated && jevHash(updated) !== jevHash(c))
                                        invalid();
                                }
                        }
                        const newIds = [...next.versions.keys()].filter(id => !knownHashes.has(id)).length;
                        if (knownHashes.size + newIds > 512)
                            invalid();
                        for (const [id, value] of next.versions) {
                            const known = knownHashes.get(id);
                            if (known && known !== value.bundleHash)
                                invalid();
                        }
                        next.versions.forEach((value, id) => knownHashes.set(id, value.bundleHash));
                        const changed = current?.digest !== next.digest;
                        current = next;
                        loadedAt = new Date().toISOString();
                        lastError = null;
                        if (changed)
                            for (const listener of listeners) {
                                try {
                                    listener();
                                }
                                catch { /* Consumer lỗi không đảo snapshot. */ }
                            }
                    }
                    catch {
                        lastError = 'JEV_POLICY_RELOAD_FAILED';
                        throw new Error(lastError); // Không đẩy SQL, đường dẫn hoặc credential ra response/log.
                    }
                } while (pending && !closed);
            })().finally(() => { inFlight = undefined; });
            return inFlight;
        },
        close() { closed = true; current = undefined; knownHashes.clear(); listeners.clear(); },
    };
}
