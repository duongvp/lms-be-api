import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { chat_moderation_policy_versions as Version, chat_moderation_rules as Rule, chat_moderation_rule_modes as Mode } from './legacy-types';
import { compileJevShadowPolicy, type JevShadowPolicy } from './shadow-policy';
import { CHAT_JEV_MODEL, CHAT_JEV_RUBRIC_VERSION } from './rubric';
import { projectNormalizedPolicy } from './normalized-storage';
const MAX_ACTIONS = 512;
const invalid = (): never => { throw Error('INVALID_JEV_DATABASE_POLICY'); };
const positive = (v: number) => Number.isSafeInteger(v) && v > 0 && v <= 4294967295;
/** Projection cố định + thứ tự ổn định: Decimal/JSON DB không được đi thẳng vào engine. */
export function compileJevDatabaseVersion(header: Version, actionRows: readonly Rule[], modes: readonly Mode[] = []) {
    if (![1, 2].includes(header.storage_version))
        return invalid();
    const projected = header.storage_version === 2 ? projectNormalizedPolicy(header, actionRows, modes) : null;
    const version = projected?.version ?? header, rows = projected?.rows ?? actionRows;
    // Không cho hai nguồn cấu hình mâu thuẫn; legacy chỉ được đọc JSON như trước.
    if (header.storage_version === 1 && (modes.length || [header.fallback_unassessed, header.fallback_unresolved,
        header.fallback_below_threshold, header.fallback_missing_context, header.fallback_missing_history].some(v => v !== null)
        || actionRows.some(row => [row.counter_group, row.min_prior_count, row.max_prior_count,
            row.cooldown_seconds, row.interval_seconds, row.duration_seconds].some(v => v !== null))))
        return invalid();
    if (!positive(version.id) || !positive(version.revision) || !positive(version.edit_revision)
        || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(version.policy_key)
        || !['DRAFT', 'PUBLISHED'].includes(version.status) || rows.length > MAX_ACTIONS
        || version.model_version !== CHAT_JEV_MODEL
        || (version.rubric_version_id === null ? version.rubric_version !== CHAT_JEV_RUBRIC_VERSION
            : !/^jev-classroom-v1:[a-f0-9]{64}$/.test(version.rubric_version)))
        return invalid();
    const groups = new Map<string, {
        id: string;
        category: string;
        severity: string;
        conditions?: unknown;
        actions: string[];
        gates: Record<string, unknown>;
    }>();
    const number = (value: Prisma.Decimal | null) => value === null ? null : Number(value);
    for (const row of [...rows].sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.action.localeCompare(b.action))) {
        if (row.policy_version_id !== version.id || typeof row.is_enabled !== 'boolean'
            || !Array.isArray(row.room_modes))
            return invalid();
        const group = groups.get(row.rule_id) ?? { id: row.rule_id, category: row.category, severity: row.severity,
            ...(row.conditions == null ? {} : { conditions: row.conditions }), actions: [], gates: {} };
        if (group.category !== row.category || group.severity !== row.severity || Object.hasOwn(group.gates, row.action)
            || JSON.stringify(group.conditions ?? null) !== JSON.stringify(row.conditions ?? null))
            return invalid();
        group.actions.push(row.action);
        group.gates[row.action] = { pCategoryMin: number(row.p_category_min), categoryConfidenceMin: number(row.category_confidence_min),
            pSeverityMin: number(row.p_severity_min), severityConfidenceMin: number(row.severity_confidence_min),
            enabled: row.is_enabled, modes: [...row.room_modes].sort(),
            // Không thêm property khi null: giữ hash của bản PUBLISHED cũ sau migration nullable.
            ...(row.student_message == null ? {} : { studentMessage: row.student_message }),
            ...(row.action_params == null ? {} : { params: row.action_params }) };
        groups.set(row.rule_id, group);
    }
    let policy: JevShadowPolicy;
    try {
        policy = compileJevShadowPolicy({ schemaVersion: version.schema_version ?? 1, version: version.policy_key + ':r' + version.revision,
            executionMode: 'shadow', modelVersion: version.model_version, rubricVersion: version.rubric_version,
            safetySignalMin: number(version.safety_signal_min),
            ...(version.fallbacks == null ? {} : { fallbacks: version.fallbacks }), rules: [...groups.values()] });
    }
    catch {
        return invalid();
    }
    const hash = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
    if (version.status === 'PUBLISHED' && (version.content_hash !== hash || !version.published_at || !version.published_by))
        return invalid();
    return Object.freeze({ policy, hash });
}
