import { z } from 'zod';
import { CHAT_JEV_CATEGORIES, CHAT_JEV_SEVERITIES, freezeJevSnapshot } from './types';
import type { JevCategory, JevOutcome, JevSeverity, JevState } from './types';
import { CHAT_JEV_MODEL, CHAT_JEV_RUBRIC_VERSION } from './rubric';
import { defaultJevStudentMessage, type JevStudentNotice } from './student-notices';
import { validateDecisionMatrix, previewDecisionMatrix, type JevDecisionHistory, type JevRuleConditions, type JevActionParams } from './decision-matrix';
import { readJevSafetySignals } from './contract';
import type { JevFramework } from './framework';
import type { JevNoticeTemplate } from './notice-templates';
import { compileDynamicJevPolicy, previewDynamicJevPolicy, type JevDynamicCounter, type JevDynamicFallbacks } from './dynamic-policy';

const actions = ['ALLOW', 'BLOCK', 'PRIVATE_NUDGE', 'TEACHER_ALERT', 'SAFETY_ALERT', 'SAFETY_SUPPORT', 'COUNT_STRIKE', 'SLOW_MODE', 'MUTE'] as const;
export type JevPreviewAction = typeof actions[number];
const probability = z.number().finite().min(0).max(1).nullable();
export const gatesSchema = z.object({ pCategoryMin: probability, categoryConfidenceMin: probability,
  pSeverityMin: probability, severityConfidenceMin: probability,
  enabled: z.boolean().default(true),
  modes: z.array(z.enum(['LOBBY', 'LECTURE', 'UNKNOWN'])).min(1).max(3).default(['LOBBY', 'LECTURE', 'UNKNOWN']),
  // Text thuần, không HTML/interpolation/control; không dùng template như code hoặc prompt.
  studentMessage: z.string().min(1).max(255).refine(value => value.trim() === value
    && !/[<>{}\p{Cc}\p{Cf}]/u.test(value)).optional(),
  templateKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  teacherTemplateKey: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  params: z.object({ cooldownSeconds: z.number().int().min(0).max(86400).optional(),
    intervalSeconds: z.number().int().min(1).max(3600).optional(),
    durationSeconds: z.number().int().min(1).max(86400).optional() }).strict().optional(),
}).strict();
type JevGates = z.infer<typeof gatesSchema>;

// Đây là 14 tổ hợp nghiệp vụ; 21 tổ hợp còn lại là mâu thuẫn cần review, không được ép về VALID.
const matrix: readonly [string, JevCategory, JevSeverity, readonly JevPreviewAction[]][] = [
  ['R01', 'VALID', 'NONE', ['ALLOW']],
  ['R02', 'OFF_TOPIC', 'LOW', ['ALLOW', 'PRIVATE_NUDGE']],
  ['R03', 'OFF_TOPIC', 'MEDIUM', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R04', 'SPAM_DISRUPTION', 'LOW', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R05', 'SPAM_DISRUPTION', 'MEDIUM', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R06', 'SPAM_DISRUPTION', 'HIGH', ['BLOCK', 'TEACHER_ALERT']],
  ['R07', 'ABUSE_BULLYING', 'LOW', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R08', 'ABUSE_BULLYING', 'MEDIUM', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R09', 'ABUSE_BULLYING', 'HIGH', ['BLOCK', 'TEACHER_ALERT']],
  ['R10', 'PII_EXTERNAL', 'LOW', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R11', 'PII_EXTERNAL', 'MEDIUM', ['BLOCK', 'PRIVATE_NUDGE']],
  ['R12', 'PII_EXTERNAL', 'HIGH', ['BLOCK', 'TEACHER_ALERT']],
  ['R13', 'SAFETY_THREAT', 'CRITICAL', ['SAFETY_ALERT']],
  ['R14', 'SAFETY_DISTRESSED', 'CRITICAL', ['SAFETY_SUPPORT']],
];

const policySchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]), version: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
  executionMode: z.literal('shadow'), modelVersion: z.string().regex(/^jev-\d+\.\d+\.\d+$/),
  rubricVersion: z.string().regex(/^jev-classroom-v1:[a-f0-9]{64}$/), safetySignalMin: probability,
  fallbacks: z.object({ unassessed: z.enum(['NO_AUTOMATIC_ACTION', 'REVIEW']),
    unresolved: z.literal('REVIEW'), belowThreshold: z.enum(['NO_AUTOMATIC_ACTION', 'REVIEW']),
    missingContext: z.enum(['NO_AUTOMATIC_ACTION', 'REVIEW']), missingHistory: z.literal('REVIEW') }).strict().optional(),
  // ANY là phạm vi rule bảo vệ theo nhóm, không phải mức độ model được phép trả về.
  rules: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), category: z.enum(CHAT_JEV_CATEGORIES), severity: z.enum([...CHAT_JEV_SEVERITIES, 'ANY']),
    conditions: z.object({ modes: z.array(z.enum(['LOBBY', 'LECTURE', 'UNKNOWN'])).min(1).max(3),
      counterGroup: z.enum(['SPAM', 'ABUSE', 'PII']).nullable(),
      minPriorCount: z.number().int().min(0).max(1000000), maxPriorCount: z.number().int().min(0).max(1000000).nullable(),
    }).strict().optional(),
    actions: z.array(z.enum(actions)).min(1).max(actions.length), gates: z.record(z.enum(actions), gatesSchema),
  }).strict()).min(14).max(128),
}).strict();
export type JevShadowPolicy = Readonly<{
  schemaVersion: 1 | 2 | 3; version: string; executionMode: 'shadow'; modelVersion: string; rubricVersion: string;
  framework?: JevFramework; templates?: readonly JevNoticeTemplate[]; counters?: readonly JevDynamicCounter[];
  fallbackPlans?: JevDynamicFallbacks;
  safetyTemplates?: Readonly<Record<'threat' | 'distress', Readonly<{ student: string; teacher: string }>>>;
  safetySignalMin: number | null;
  fallbacks?: Readonly<{ unassessed: 'NO_AUTOMATIC_ACTION' | 'REVIEW'; unresolved: 'REVIEW';
    belowThreshold: 'NO_AUTOMATIC_ACTION' | 'REVIEW'; missingContext: 'NO_AUTOMATIC_ACTION' | 'REVIEW'; missingHistory: 'REVIEW' }>;
  rules: readonly Readonly<{ id: string; category: JevCategory; severity: JevSeverity | 'ANY';
    resolutionOnly?: boolean; restrictionBasis?: 'NONE' | 'REPEAT' | 'IMMEDIATE';
    conditions?: JevRuleConditions;
    actions: readonly JevPreviewAction[]; gates: Readonly<Partial<Record<JevPreviewAction, JevGates>>> }>[];
}>;

/** Cổng chung cho mọi nguồn cấu hình tương lai: file hoặc DB đều phải qua cùng một validator. */
export function compileJevShadowPolicy(input: unknown): JevShadowPolicy {
  if (input && typeof input === 'object' && (input as { schemaVersion?: unknown }).schemaVersion === 3) return compileDynamicJevPolicy(input);
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_JEV_POLICY');
  const policy = parsed.data;
  // Các trường chỉ phục vụ V3 không được lén thêm vào phiên bản cũ làm đổi hash/cách diễn giải.
  if (policy.rules.some(r => Object.values(r.gates).some(g => g.templateKey || g.teacherTemplateKey))) throw Error('INVALID_JEV_POLICY');
  if (policy.schemaVersion === 2) {
    validateDecisionMatrix(policy as JevShadowPolicy, matrix);
    return freezeJevSnapshot(policy as JevShadowPolicy);
  }
  // Không nới v1 hoặc thêm default field vào v1: hash của bản đã publish phải giữ nguyên.
  if (policy.rules.length !== 14 || policy.fallbacks || policy.rules.some(rule => rule.conditions ||
      Object.values(rule.gates).some(gate => gate.params))) throw new Error('INVALID_JEV_POLICY');
  const seen = new Set<string>();
  for (const rule of policy.rules) {
    const expected = matrix.find(row => row[0] === rule.id && row[1] === rule.category && row[2] === rule.severity);
    const pair = `${rule.category}:${rule.severity}`;
    if (!expected || seen.has(pair) || new Set(rule.actions).size !== rule.actions.length
      || rule.actions.some(action => !expected[3].includes(action))
      || Object.keys(rule.gates).length !== rule.actions.length
      || rule.actions.some(action => !Object.hasOwn(rule.gates, action)
        || new Set(rule.gates[action]!.modes).size !== rule.gates[action]!.modes.length
        || rule.gates[action]!.studentMessage !== undefined && action !== 'BLOCK' && action !== 'PRIVATE_NUDGE')) throw new Error('INVALID_JEV_POLICY');
    seen.add(pair);
  }
  // Zod dựng bản sao; đóng băng toàn cây để việc sửa object nguồn không đổi tin đang xử lý.
  return freezeJevSnapshot(policy as JevShadowPolicy);
}

const emptyGates = () => ({ pCategoryMin: null, categoryConfidenceMin: null, pSeverityMin: null, severityConfidenceMin: null });
export const DEFAULT_JEV_SHADOW_POLICY = compileJevShadowPolicy({
  schemaVersion: 1, version: 'classroom-shadow-v1', executionMode: 'shadow', modelVersion: CHAT_JEV_MODEL,
  rubricVersion: CHAT_JEV_RUBRIC_VERSION, safetySignalMin: null,
  rules: matrix.map(([id, category, severity, candidateActions]) => ({ id, category, severity,
    actions: [...candidateActions], gates: Object.fromEntries(candidateActions.map(action => [action, emptyGates()])) })),
});

export type JevPreview = Readonly<{
  status: 'UNASSESSED' | 'UNRESOLVED' | 'SAFETY_REVIEW' | 'CONTEXT_REQUIRED' | 'HISTORY_REQUIRED' | 'PENDING_CALIBRATION' | 'PREVIEW';
  policyVersion: string; ruleId: string | null; candidateActions: readonly JevPreviewAction[];
  eligibleActions: readonly JevPreviewAction[]; appliedActions: readonly never[]; countStrike: false;
  studentNotices: readonly JevStudentNotice[];
  fallback?: 'NO_AUTOMATIC_ACTION' | 'REVIEW' | 'SAFETY_REVIEW' | null;
  actionPlan?: readonly Readonly<{ action: JevPreviewAction; params: JevActionParams }>[];
  wouldCountStrike?: boolean;
  history?: Readonly<{ counterGroup: string; counterKind: 'STRIKE' | 'INCIDENT'; priorCount: number; projectedCount: number }> | null;
  /** Dấu vết hai tầng; v1/v2 cũ không thêm field để giữ tương thích snapshot/log cũ. */
  groupRuleId?: string | null; severityRuleId?: string | null; severityDecision?: JevPreview['status'];
  actionSources?: Readonly<Partial<Record<JevPreviewAction, string>>>;
  notifications?: readonly Readonly<{ action: JevPreviewAction; audience: 'student' | 'teacher'; kind: 'NUDGE' | 'ALERT' | 'SAFETY';
    text: string; guidance?: string; templateKey: string }>[];
}>;

/** Preview không có mutator/side effect; eligible cũng chỉ là đủ gate giả lập, chưa được thực thi. */
export function previewJevAssessment(outcome: JevOutcome, state: JevState, policy: JevShadowPolicy,
  history?: JevDecisionHistory): JevPreview {
  if (policy.schemaVersion === 3) return previewDynamicJevPolicy(outcome, state, policy, history);
  if (policy.schemaVersion === 2) return previewDecisionMatrix(outcome, state, policy, history);
  const result = (status: JevPreview['status'], ruleId: string | null = null,
    candidateActions: readonly JevPreviewAction[] = [], eligibleActions: readonly JevPreviewAction[] = []): JevPreview => {
    const noticeRule = policy.rules.find(row => row.id === ruleId);
    return freezeJevSnapshot({ status, policyVersion: policy.version, ruleId, candidateActions, eligibleActions,
      // Chỉ mô tả thông báo của action đủ gate; KHÔNG emit socket hoặc gửi tới học sinh ở shadow.
      studentNotices: eligibleActions.flatMap(action => {
        if (!noticeRule || action !== 'BLOCK' && action !== 'PRIVATE_NUDGE') return [];
        const configured = noticeRule.gates[action]?.studentMessage;
        const text = configured ?? defaultJevStudentMessage(noticeRule.category, action);
        return text ? [{ action, text, source: configured === undefined ? 'default' as const : 'policy' as const }] : [];
      }), appliedActions: [] as never[], countStrike: false as const });
  };
  // Kiểm phần an toàn trước verdict đầy đủ: chỉ đề xuất người xem xét, không cứu nhãn hỏng để phạt.
  const safetySignals = readJevSafetySignals(outcome, policy.modelVersion, policy.rubricVersion);
  if (policy.safetySignalMin !== null && safetySignals &&
    ((safetySignals.threat ?? -1) >= policy.safetySignalMin || (safetySignals.distress ?? -1) >= policy.safetySignalMin)) {
    const safety: JevPreviewAction[] = [];
    if ((safetySignals.distress ?? -1) >= policy.safetySignalMin) safety.push('SAFETY_SUPPORT');
    if ((safetySignals.threat ?? -1) >= policy.safetySignalMin) safety.push('SAFETY_ALERT');
    return result('SAFETY_REVIEW', null, safety);
  }
  if (outcome.status !== 'ASSESSED') return result('UNASSESSED');
  if (outcome.modelVersion !== policy.modelVersion || outcome.rubricVersion !== policy.rubricVersion) return result('UNRESOLVED');
  const { category, severity } = outcome.assessment;
  const rule = policy.rules.find(row => row.category === category.choice && row.severity === severity.choice);
  if (!rule) return result('UNRESOLVED');
  if (category.choice === 'OFF_TOPIC') {
    if (state.classroom.mode === 'LOBBY') return result('PREVIEW', rule.id, ['ALLOW']);
    if (state.classroom.mode !== 'LECTURE' || !state.classroom.contextKnown) return result('CONTEXT_REQUIRED', rule.id);
  }
  // Công tắc/mode chỉ thu hẹp action đã cho phép; không mở nhãn mới hoặc chế tài ngoài registry.
  const candidates = rule.actions.filter(action => rule.gates[action]?.enabled
    && rule.gates[action]!.modes.includes(state.classroom.mode));
  if (!candidates.length) return result('PREVIEW', rule.id);
  if (policy.safetySignalMin === null) return result('PENDING_CALIBRATION', rule.id, candidates);
  let incomplete = false;
  const eligible = candidates.filter(action => {
    const gate = rule.gates[action];
    if (!gate || [gate.pCategoryMin, gate.categoryConfidenceMin, gate.pSeverityMin, gate.severityConfidenceMin]
      .some(value => value === null)) { incomplete = true; return false; }
    // AND theo từng action, không lấy gate nhắc nhẹ làm quyền chặn/cấm và không nhân các điểm.
    return category.probabilities[category.choice] >= gate.pCategoryMin!
      && category.confidence >= gate.categoryConfidenceMin!
      && severity.probabilities[severity.choice] >= gate.pSeverityMin!
      && severity.confidence >= gate.severityConfidenceMin!;
  });
  return result(incomplete ? 'PENDING_CALIBRATION' : 'PREVIEW', rule.id, candidates, eligible);
}
