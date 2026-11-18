import type { Prisma } from '@prisma/client';
/** Kiểu nguồn chuyển đổi/test, không phải model runtime. */
export type chat_moderation_policy_versions = {
    id: number;
    policy_key: string;
    revision: number;
    edit_revision: number;
    status: string;
    schema_version: number;
    storage_version: number;
    rubric_version_id: number | null;
    minimum_runtime_contract: number | null;
    safety_threat_student: string | null;
    safety_threat_teacher: string | null;
    safety_distress_student: string | null;
    safety_distress_teacher: string | null;
    fallback_unassessed: string | null;
    fallback_unresolved: string | null;
    fallback_below_threshold: string | null;
    fallback_missing_context: string | null;
    fallback_missing_history: string | null;
    fallbacks: Prisma.JsonValue | null;
    model_version: string;
    rubric_version: string;
    safety_signal_min: Prisma.Decimal | null;
    content_hash: string | null;
    created_by: string;
    published_by: string | null;
    created_at: Date;
    updated_at: Date;
    published_at: Date | null;
};
export type chat_moderation_rules = {
    id: number;
    policy_version_id: number;
    rule_id: string;
    conditions: Prisma.JsonValue | null;
    action_params: Prisma.JsonValue | null;
    counter_group: string | null;
    min_prior_count: number | null;
    max_prior_count: number | null;
    cooldown_seconds: number | null;
    interval_seconds: number | null;
    duration_seconds: number | null;
    category: string;
    severity: string;
    action: string;
    room_modes: Prisma.JsonValue | null;
    is_enabled: boolean;
    p_category_min: Prisma.Decimal | null;
    category_confidence_min: Prisma.Decimal | null;
    p_severity_min: Prisma.Decimal | null;
    severity_confidence_min: Prisma.Decimal | null;
    student_message: string | null;
    resolution_only: boolean | null;
    restriction_basis: string | null;
    notice_template_key: string | null;
    teacher_template_key: string | null;
};
export type chat_moderation_rule_modes = {
    rule_action_id: number;
    mode: string;
    position: number;
};
export type chat_moderation_rubric_versions = {
    id: number;
    rubric_key: string;
    revision: number;
    edit_revision: number;
    status: string;
    model_version: string;
    framework_version: number;
    common_instructions: string;
    category_instructions: string;
    severity_instructions: string;
    threat_instructions: string;
    distress_instructions: string;
    severity_none: string;
    severity_low: string;
    severity_medium: string;
    severity_high: string;
    severity_critical: string;
    content_hash: string | null;
    created_by: string;
    published_by: string | null;
    created_at: Date;
    updated_at: Date;
    published_at: Date | null;
};
export type chat_moderation_categories = {
    id: number;
    rubric_version_id: number;
    code: string;
    label: string;
    definition: string;
    criteria_none: string | null;
    criteria_low: string | null;
    criteria_medium: string | null;
    criteria_high: string | null;
    criteria_critical: string | null;
    is_enabled: boolean;
    archetype: string | null;
    context_requirement: string | null;
    counter_key: string | null;
    safety_signal: string | null;
};
export type chat_moderation_levels = {
    id: number;
    rubric_version_id: number;
    code: string;
    label: string;
    rank: number;
    instructions: string;
    is_enabled: boolean;
};
export type chat_moderation_category_levels = {
    rubric_version_id: number;
    category_id: number;
    level_id: number;
    is_applicable: boolean;
    criterion: string | null;
};
export type chat_moderation_notice_templates = {
    id: number;
    policy_version_id: number;
    template_key: string;
    audience: string;
    kind: string;
    body: string;
    guidance: string | null;
};
export type chat_moderation_counter_groups = {
    policy_version_id: number;
    counter_key: string;
    count_kind: string;
    window_kind: string;
};
export type chat_moderation_violation_events = {
    id: bigint;
    event_key: string;
    fingerprint: string;
    evaluation_id: bigint | null;
    policy_version_id: number;
    calendar_id: number;
    user_id: string;
    counter_group: string;
    count_kind: string;
    rule_id: string;
    action: string;
    action_snapshot: Prisma.JsonValue;
    window_started_at: Date;
    created_at: Date;
};
export type chat_moderation_student_states = {
    calendar_id: number;
    user_id: string;
    counter_group: string;
    confirmed_count: number;
    revision: number;
    muted_until: Date | null;
    slow_until: Date | null;
    slow_interval_seconds: number | null;
    window_started_at: Date;
    window_expires_at: Date;
    latest_event_id: bigint | null;
};
export type chat_moderation_bindings = {
    id: number;
    scope_type: string;
    scope_key: string;
    policy_version_id: number | null;
    mode: string;
    revision: number;
    updated_by: string;
    updated_at: Date;
};
export type chat_jev_evaluations = {
    id: bigint;
    event_key: string;
    calendar_id: number | null;
    scope_hash: string;
    message_hash: string;
    context_hash: string;
    outcome_status: string;
    failure_reason: string | null;
    classroom_mode: string;
    context_known: boolean;
    model_version: string;
    rubric_version: string;
    policy_version: string;
    policy_hash: string;
    rule_id: string | null;
    preview_status: string;
    assessment_json: Prisma.JsonValue | null;
    decision_json: Prisma.JsonValue;
    queue_ms: number | null;
    adapter_ms: number | null;
    total_ms: number;
    input_tokens: bigint | null;
    output_tokens: bigint | null;
    reserved_micro_usd: number;
    received_at: Date;
    finished_at: Date;
    created_at: Date;
    expires_at: Date;
};
/** UInt từ raw MySQL có thể là BigInt; hydrate chỉ những cột này, không ép audit BigInt. */
export const LEGACY_JEV_NUMBERS: Readonly<Record<string, readonly string[]>> = {
    "chat_moderation_policy_versions": [
        "id",
        "revision",
        "edit_revision",
        "schema_version",
        "storage_version",
        "rubric_version_id",
        "minimum_runtime_contract"
    ],
    "chat_moderation_rules": [
        "id",
        "policy_version_id",
        "min_prior_count",
        "max_prior_count",
        "cooldown_seconds",
        "interval_seconds",
        "duration_seconds"
    ],
    "chat_moderation_rule_modes": [
        "rule_action_id",
        "position"
    ],
    "chat_moderation_rubric_versions": [
        "id",
        "revision",
        "edit_revision",
        "framework_version"
    ],
    "chat_moderation_categories": [
        "id",
        "rubric_version_id"
    ],
    "chat_moderation_levels": [
        "id",
        "rubric_version_id",
        "rank"
    ],
    "chat_moderation_category_levels": [
        "rubric_version_id",
        "category_id",
        "level_id"
    ],
    "chat_moderation_notice_templates": [
        "id",
        "policy_version_id"
    ],
    "chat_moderation_counter_groups": [
        "policy_version_id"
    ],
    "chat_moderation_violation_events": [
        "policy_version_id",
        "calendar_id"
    ],
    "chat_moderation_student_states": [
        "calendar_id",
        "confirmed_count",
        "revision",
        "slow_interval_seconds"
    ],
    "chat_moderation_bindings": [
        "id",
        "policy_version_id",
        "revision"
    ],
    "chat_jev_evaluations": [
        "calendar_id",
        "queue_ms",
        "adapter_ms",
        "total_ms",
        "reserved_micro_usd"
    ]
};
export const LEGACY_JEV_COLUMNS: Readonly<Record<string, readonly string[]>> = { "chat_moderation_policy_versions": ["id", "policy_key", "revision", "edit_revision", "status", "schema_version", "storage_version", "rubric_version_id", "minimum_runtime_contract", "safety_threat_student", "safety_threat_teacher", "safety_distress_student", "safety_distress_teacher", "fallback_unassessed", "fallback_unresolved", "fallback_below_threshold", "fallback_missing_context", "fallback_missing_history", "fallbacks", "model_version", "rubric_version", "safety_signal_min", "content_hash", "created_by", "published_by", "created_at", "updated_at", "published_at"], "chat_moderation_rules": ["id", "policy_version_id", "rule_id", "conditions", "action_params", "counter_group", "min_prior_count", "max_prior_count", "cooldown_seconds", "interval_seconds", "duration_seconds", "category", "severity", "action", "room_modes", "is_enabled", "p_category_min", "category_confidence_min", "p_severity_min", "severity_confidence_min", "student_message", "resolution_only", "restriction_basis", "notice_template_key", "teacher_template_key"], "chat_moderation_rule_modes": ["rule_action_id", "mode", "position"], "chat_moderation_rubric_versions": ["id", "rubric_key", "revision", "edit_revision", "status", "model_version", "framework_version", "common_instructions", "category_instructions", "severity_instructions", "threat_instructions", "distress_instructions", "severity_none", "severity_low", "severity_medium", "severity_high", "severity_critical", "content_hash", "created_by", "published_by", "created_at", "updated_at", "published_at"], "chat_moderation_categories": ["id", "rubric_version_id", "code", "label", "definition", "criteria_none", "criteria_low", "criteria_medium", "criteria_high", "criteria_critical", "is_enabled", "archetype", "context_requirement", "counter_key", "safety_signal"], "chat_moderation_levels": ["id", "rubric_version_id", "code", "label", "rank", "instructions", "is_enabled"], "chat_moderation_category_levels": ["rubric_version_id", "category_id", "level_id", "is_applicable", "criterion"], "chat_moderation_notice_templates": ["id", "policy_version_id", "template_key", "audience", "kind", "body", "guidance"], "chat_moderation_counter_groups": ["policy_version_id", "counter_key", "count_kind", "window_kind"], "chat_moderation_violation_events": ["id", "event_key", "fingerprint", "evaluation_id", "policy_version_id", "calendar_id", "user_id", "counter_group", "count_kind", "rule_id", "action", "action_snapshot", "window_started_at", "created_at"], "chat_moderation_student_states": ["calendar_id", "user_id", "counter_group", "confirmed_count", "revision", "muted_until", "slow_until", "slow_interval_seconds", "window_started_at", "window_expires_at", "latest_event_id"], "chat_moderation_bindings": ["id", "scope_type", "scope_key", "policy_version_id", "mode", "revision", "updated_by", "updated_at"], "chat_jev_evaluations": ["id", "event_key", "calendar_id", "scope_hash", "message_hash", "context_hash", "outcome_status", "failure_reason", "classroom_mode", "context_known", "model_version", "rubric_version", "policy_version", "policy_hash", "rule_id", "preview_status", "assessment_json", "decision_json", "queue_ms", "adapter_ms", "total_ms", "input_tokens", "output_tokens", "reserved_micro_usd", "received_at", "finished_at", "created_at", "expires_at"] };
export const LEGACY_JEV_JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = { "chat_moderation_policy_versions": ["fallbacks"], "chat_moderation_rules": ["conditions", "action_params", "room_modes"], "chat_moderation_rule_modes": [], "chat_moderation_rubric_versions": [], "chat_moderation_categories": [], "chat_moderation_levels": [], "chat_moderation_category_levels": [], "chat_moderation_notice_templates": [], "chat_moderation_counter_groups": [], "chat_moderation_violation_events": ["action_snapshot"], "chat_moderation_student_states": [], "chat_moderation_bindings": [], "chat_jev_evaluations": ["assessment_json", "decision_json"] };
