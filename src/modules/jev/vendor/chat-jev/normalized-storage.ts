import type { chat_moderation_policy_versions as Version, chat_moderation_rules as Rule, chat_moderation_rule_modes as Mode } from './legacy-types';
/** Projection nguồn cũ chỉ phục vụ chuyển đổi, không tạo bảng chuẩn hóa ở runtime mới. */
const invalid = (): never => { throw new Error('INVALID_JEV_DATABASE_POLICY'); };
const fallbackKeys = ['unassessed', 'unresolved', 'belowThreshold', 'missingContext', 'missingHistory'] as const;
const fallbackColumns = ['fallback_unassessed', 'fallback_unresolved', 'fallback_below_threshold',
    'fallback_missing_context', 'fallback_missing_history'] as const;
/** Chiếu storage mới về đúng contract cũ; không đưa storage_version vào hash nghiệp vụ. */
export function projectNormalizedPolicy(version: Version, rows: readonly Rule[], modes: readonly Mode[]) {
    if (version.storage_version !== 2 || version.fallbacks !== null || modes.length > rows.length * 3)
        return invalid();
    const byId = new Map<number, string[]>();
    for (const mode of [...modes].sort((a, b) => a.position - b.position)) {
        if (!rows.some(row => row.id === mode.rule_action_id) || !['LOBBY', 'LECTURE', 'UNKNOWN'].includes(mode.mode))
            return invalid();
        const list = byId.get(mode.rule_action_id) || [];
        if (list.includes(mode.mode) || mode.position !== list.length)
            return invalid();
        list.push(mode.mode);
        byId.set(mode.rule_action_id, list);
    }
    const fallbacks = version.schema_version === 2
        ? Object.fromEntries(fallbackKeys.map((key, i) => [key, version[fallbackColumns[i]!]])) : null;
    if (version.schema_version === 1 && fallbackColumns.some(key => version[key] !== null))
        return invalid();
    const projected = rows.map(row => {
        if (row.conditions !== null || row.action_params !== null || row.room_modes !== null)
            return invalid();
        const list = byId.get(row.id);
        if (!list?.length)
            return invalid();
        if (version.schema_version === 1 && [row.counter_group, row.min_prior_count, row.max_prior_count,
            row.cooldown_seconds, row.interval_seconds, row.duration_seconds].some(value => value !== null))
            return invalid();
        // Ghi/đọc cùng thứ tự thuộc tính như contract v2 để không đổi hash chỉ vì đổi nơi lưu.
        const conditions = version.schema_version === 2 ? { modes: [...list], counterGroup: row.counter_group,
            minPriorCount: row.min_prior_count, maxPriorCount: row.max_prior_count } : null;
        const params = { ...(row.cooldown_seconds === null ? {} : { cooldownSeconds: row.cooldown_seconds }),
            ...(row.interval_seconds === null ? {} : { intervalSeconds: row.interval_seconds }),
            ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }) };
        return { ...row, room_modes: [...list].sort(), conditions, action_params: Object.keys(params).length ? params : null };
    });
    return { version: { ...version, fallbacks }, rows: projected };
}
