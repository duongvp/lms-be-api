import { z } from 'zod';
import { compileJevFramework, JEV_ACTIONS, jevCode, type JevFramework } from './framework';
import { jevNoticeTemplateSchema } from './notice-templates';
import { freezeJevSnapshot, type JevOutcome, type JevState } from './types';
import { readJevSafetySignals } from './contract';
import type { JevPreview, JevPreviewAction, JevShadowPolicy } from './shadow-policy';
import type { JevDecisionHistory } from './decision-matrix';

const modes = ['LOBBY', 'LECTURE', 'UNKNOWN'] as const;
const probability = z.number().finite().min(0).max(1).nullable();
const templateKey = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const gate = z.object({ enabled: z.boolean(), modes: z.array(z.enum(modes)).min(1).max(3),
  pCategoryMin: probability, categoryConfidenceMin: probability, pSeverityMin: probability, severityConfidenceMin: probability,
  templateKey: templateKey.optional(), teacherTemplateKey: templateKey.optional(),
  params: z.object({ cooldownSeconds: z.number().int().min(0).max(86400).optional(),
    intervalSeconds: z.number().int().min(1).max(3600).optional(), durationSeconds: z.number().int().min(1).max(86400).optional() }).strict().optional() }).strict();
const counter = z.object({ key: jevCode, kind: z.enum(['STRIKE', 'INCIDENT']), window: z.literal('CALENDAR') }).strict();
export type JevDynamicCounter = Readonly<z.infer<typeof counter>>;
const fallback = z.object({ actions: z.array(z.enum(['ALLOW', 'BLOCK', 'PRIVATE_NUDGE', 'TEACHER_ALERT'])).min(1).max(3),
  templates: z.record(z.string(), templateKey) }).strict();
const fallbacks = z.object({ belowThreshold: fallback, missingContext: fallback, missingHistory: fallback }).strict();
export type JevDynamicFallbacks = Readonly<z.infer<typeof fallbacks>>;
const rule = z.object({ id: templateKey, category: jevCode, severity: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/),
  resolutionOnly: z.boolean(), restrictionBasis: z.enum(['NONE', 'REPEAT', 'IMMEDIATE']),
  conditions: z.object({ modes: z.array(z.enum(modes)).min(1).max(3), counterGroup: jevCode.nullable(),
    minPriorCount: z.number().int().min(0).max(1000000), maxPriorCount: z.number().int().min(0).max(1000000).nullable() }).strict(),
  actions: z.array(z.enum(JEV_ACTIONS)).min(1).max(9), gates: z.record(z.enum(JEV_ACTIONS), gate) }).strict();
const schema = z.object({ schemaVersion: z.literal(3), version: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/),
  executionMode: z.literal('shadow'), modelVersion: z.string().regex(/^jev-\d+\.\d+\.\d+$/),
  rubricVersion: z.string().regex(/^jev-classroom-v1:[a-f0-9]{64}$/), safetySignalMin: probability,
  framework: z.unknown(), templates: z.array(jevNoticeTemplateSchema).max(1024), counters: z.array(counter).max(16),
  safetyTemplates: z.object({ threat: z.object({ student: templateKey, teacher: templateKey }).strict(),
    distress: z.object({ student: templateKey, teacher: templateKey }).strict() }).strict(),
  fallbackPlans: fallbacks, rules: z.array(rule).min(1).max(512) }).strict();

export class JevPolicyValidationError extends Error {
  constructor(public readonly issues: readonly string[]) { super('INVALID_JEV_DYNAMIC_POLICY'); }
}
const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;
const punitive = (a: string) => ['COUNT_STRIKE', 'SLOW_MODE', 'MUTE'].includes(a);
const notices = (a: string) => ['BLOCK', 'PRIVATE_NUDGE', 'TEACHER_ALERT', 'SAFETY_ALERT', 'SAFETY_SUPPORT'].includes(a);

/** Validate toàn bộ rồi mới đóng băng: tuyệt đối không publish nửa khung/nửa ma trận. */
export function compileDynamicJevPolicy(input: unknown, options: { allowIncompleteDraft?: boolean } = {}): JevShadowPolicy {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new JevPolicyValidationError(parsed.error.issues.slice(0, 50).map(i => i.path.join('.') + ':' + i.code));
  const p = parsed.data, f = compileJevFramework(p.framework), errors: string[] = [];
  const add = (code: string) => { if (errors.length < 100) errors.push(code); };
  if (duplicate(p.rules.map(r => r.id))) add('rules:duplicate_id');
  if (duplicate(p.templates.map(t => t.key))) add('templates:duplicate_key');
  if (duplicate(p.counters.map(c => c.key))) add('counters:duplicate_key');
  if (p.rules.reduce((n, r) => n + r.actions.length, 0) > 2048) add('rules:too_many_actions');
  const text = (key: string | undefined, audience: string, kind: string, path: string) => {
    const t = p.templates.find(t => t.key === key);
    if (!t || t.audience !== audience || t.kind !== kind) add(path + ':missing_or_wrong_template');
  };
  for (const signal of ['threat', 'distress'] as const) for (const audience of ['student', 'teacher'] as const) {
    text(p.safetyTemplates[signal][audience], audience, 'SAFETY', 'safetyTemplates.' + signal + '.' + audience);
  }
  for (const c of f.categories) if (c.counterKey && !p.counters.some(k => k.key === c.counterKey)) add(c.code + ':unknown_counter');
  for (const r of p.rules) {
    const path = 'rules.' + r.id, c = f.categories.find(c => c.code === r.category);
    const pair = f.pairs.find(pair => pair.category === r.category && pair.severity === r.severity), cond = r.conditions;
    if (!c || !pair) { add(path + ':unknown_pair'); continue; }
    if (r.resolutionOnly === pair.applicable) add(path + ':wrong_resolution_kind');
    if (duplicate(cond.modes) || cond.maxPriorCount !== null && cond.maxPriorCount < cond.minPriorCount) add(path + ':invalid_range');
    if (cond.counterGroup !== null && cond.counterGroup !== c.counterKey) add(path + ':counter_mismatch');
    if (cond.counterGroup === null && (cond.minPriorCount !== 0 || cond.maxPriorCount !== null)) add(path + ':range_without_counter');
    if (duplicate(r.actions) || Object.keys(r.gates).length !== r.actions.length || r.actions.some(a => !r.gates[a])) add(path + ':invalid_actions');
    if (r.actions.includes('ALLOW') && r.actions.includes('BLOCK') || r.actions.includes('MUTE') && r.actions.includes('SLOW_MODE')) add(path + ':contradictory_actions');
    const sanction = r.actions.some(punitive);
    if ((r.resolutionOnly || c.archetype !== 'DISCIPLINARY_NORMAL') && sanction) add(path + ':sanction_not_allowed');
    if (c.archetype === 'VALID_SAFE' && r.actions.some(a => a !== 'ALLOW')) add(path + ':valid_must_allow');
    if (r.actions.some(a => a === 'SAFETY_ALERT' || a === 'SAFETY_SUPPORT') && !c.archetype.startsWith('SAFETY_')) add(path + ':wrong_safety_archetype');
    if (c.archetype === 'SAFETY_DISTRESSED' && r.actions.includes('SAFETY_ALERT')
      || c.archetype === 'SAFETY_THREAT' && r.actions.includes('SAFETY_SUPPORT')) add(path + ':wrong_safety_action');
    if (sanction && (!r.actions.includes('BLOCK') || cond.counterGroup === null)) add(path + ':sanction_requires_block_counter');
    const restriction = r.actions.includes('SLOW_MODE') || r.actions.includes('MUTE');
    if (restriction && r.restrictionBasis === 'NONE' || !restriction && r.restrictionBasis !== 'NONE') add(path + ':restriction_basis');
    if (restriction && r.restrictionBasis === 'REPEAT' && (cond.minPriorCount < 1 || !r.actions.includes('COUNT_STRIKE'))) add(path + ':repeat_requires_history_strike');
    for (const a of r.actions) {
      const g = r.gates[a]; if (!g) continue;
      if (duplicate(g.modes) || [...g.modes].sort().join() !== [...cond.modes].sort().join()) add(path + '.' + a + ':modes_mismatch');
      if (notices(a)) text(g.templateKey, a === 'TEACHER_ALERT' ? 'teacher' : 'student', a.startsWith('SAFETY_') ? 'SAFETY' : a === 'TEACHER_ALERT' ? 'ALERT' : 'NUDGE', path + '.' + a);
      else if (g.templateKey || g.teacherTemplateKey) add(path + '.' + a + ':unexpected_template');
      if (a.startsWith('SAFETY_')) text(g.teacherTemplateKey, 'teacher', 'SAFETY', path + '.' + a + '.teacher');
      else if (g.teacherTemplateKey) add(path + '.' + a + ':unexpected_teacher_template');
      const keys = Object.keys(g.params ?? {}).sort().join();
      if (a === 'MUTE' ? keys !== 'durationSeconds' : a === 'SLOW_MODE' ? keys !== 'durationSeconds,intervalSeconds'
        || g.params!.intervalSeconds! > g.params!.durationSeconds! : ['PRIVATE_NUDGE', 'TEACHER_ALERT'].includes(a) ? keys !== 'cooldownSeconds' : keys !== '') add(path + '.' + a + ':params');
    }
  }
  for (const pair of f.pairs) for (const mode of modes) {
    const rows = p.rules.filter(r => r.category === pair.category && r.severity === pair.severity && r.conditions.modes.includes(mode))
      .sort((a, b) => a.conditions.minPriorCount - b.conditions.minPriorCount);
    let next = 0;
    if (!rows.length || new Set(rows.map(r => r.conditions.counterGroup)).size > 1) add(pair.category + '.' + pair.severity + '.' + mode + ':missing_or_mixed_counter');
    for (const r of rows) {
      if (r.conditions.minPriorCount !== next) add(pair.category + '.' + pair.severity + '.' + mode + ':gap_or_overlap');
      next = r.conditions.maxPriorCount === null ? Infinity : r.conditions.maxPriorCount + 1;
    }
    if (next !== Infinity) add(pair.category + '.' + pair.severity + '.' + mode + ':missing_tail');
  }
  for (const [name, plan] of Object.entries(p.fallbackPlans)) {
    if (duplicate(plan.actions) || plan.actions.includes('ALLOW') && plan.actions.includes('BLOCK')) add('fallback.' + name + ':contradictory_actions');
    // Thiếu điểm/ngữ cảnh không được cấu hình thành bằng chứng vi phạm mới.
    if (name !== 'missingHistory' && plan.actions.some(a => a !== 'ALLOW')) add('fallback.' + name + ':must_allow');
    for (const a of plan.actions) if (notices(a)) text(plan.templates[a], a === 'TEACHER_ALERT' ? 'teacher' : 'student', a === 'TEACHER_ALERT' ? 'ALERT' : 'NUDGE', 'fallback.' + name + '.' + a);
    if (Object.keys(plan.templates).some(a => !plan.actions.includes(a as typeof plan.actions[number]) || !notices(a))) add('fallback.' + name + ':extra_template');
  }
  if (Buffer.byteLength(JSON.stringify(p)) > 512 * 1024) add('policy:too_large');
  if (errors.length && !options.allowIncompleteDraft) throw new JevPolicyValidationError(errors);
  // Thứ tự SELECT/nhập liệu không được làm đổi hash của cùng một cấu hình.
  const canonical = { ...p, framework: f,
    templates: [...p.templates].sort((a, b) => a.key.localeCompare(b.key)), counters: [...p.counters].sort((a, b) => a.key.localeCompare(b.key)),
    fallbackPlans: fallbacks.parse(Object.fromEntries(Object.entries(p.fallbackPlans).map(([key, value]) => [key, { actions: [...value.actions].sort(),
      templates: Object.fromEntries(Object.entries(value.templates).sort(([a], [b]) => a.localeCompare(b))) }]))),
    rules: [...p.rules].sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ ...r, conditions: { ...r.conditions, modes: [...r.conditions.modes].sort() },
      actions: [...r.actions].sort(), gates: Object.fromEntries(Object.entries(r.gates).sort(([a], [b]) => a.localeCompare(b)).map(([a, g]) => [a, { ...g, modes: [...g.modes].sort() }])) })) };
  return freezeJevSnapshot(canonical) as JevShadowPolicy;
}

/** Chỉ trả kế hoạch thuần; mọi điểm phạt vẫn được kiểm riêng theo action, không đổi gate đang chạy. */
export function previewDynamicJevPolicy(outcome: JevOutcome, state: JevState, policy: JevShadowPolicy, history?: JevDecisionHistory): JevPreview {
  const f = policy.framework!, templates = policy.templates!;
  const notification = (a: JevPreviewAction, key: string) => {
    const t = templates.find(t => t.key === key)!;
    return { action: a, audience: t.audience, kind: t.kind, text: t.body, templateKey: t.key, ...(t.guidance ? { guidance: t.guidance } : {}) };
  };
  const result = (status: JevPreview['status'], actions: readonly JevPreviewAction[], r?: JevShadowPolicy['rules'][number],
    notes: JevPreview['notifications'] = [], prior: number | null = null): JevPreview => {
    const counter = policy.counters!.find(c => c.key === r?.conditions?.counterGroup);
    const count = actions.includes('COUNT_STRIKE') || !!counter && counter.kind === 'INCIDENT' && actions.includes('BLOCK') && !r?.resolutionOnly;
    return freezeJevSnapshot({ status, policyVersion: policy.version, ruleId: r?.id ?? null,
      candidateActions: r?.actions ?? actions, eligibleActions: actions, appliedActions: [] as never[], countStrike: false,
      fallback: null, actionPlan: actions.map(action => ({ action, params: r?.gates[action]?.params ?? {} })),
      wouldCountStrike: actions.includes('COUNT_STRIKE'), notifications: notes,
      studentNotices: notes.filter(n => n.audience === 'student' && (n.action === 'BLOCK' || n.action === 'PRIVATE_NUDGE'))
        .map(n => ({ action: n.action as 'BLOCK' | 'PRIVATE_NUDGE', text: n.text, source: 'policy' as const })),
      history: counter && prior !== null ? { counterGroup: counter.key, counterKind: counter.kind, priorCount: prior, projectedCount: Math.min(1000000, prior + (count ? 1 : 0)) } : null });
  };
  const safety = readJevSafetySignals(outcome, policy.modelVersion, policy.rubricVersion);
  const fired = (['threat', 'distress'] as const).filter(s => policy.safetySignalMin !== null && (safety?.[s] ?? -1) >= policy.safetySignalMin);
  if (fired.length) {
    const actions: JevPreviewAction[] = ['BLOCK'], notes: NonNullable<JevPreview['notifications']>[number][] = [];
    // Tín hiệu độc lập bảo vệ nội dung và báo riêng, tuyệt đối không tạo strike/mute.
    for (const signal of fired) {
      const a = signal === 'threat' ? 'SAFETY_ALERT' : 'SAFETY_SUPPORT'; actions.push(a);
      for (const audience of ['student', 'teacher'] as const) notes.push(notification(a, policy.safetyTemplates![signal][audience]));
    }
    return result('SAFETY_REVIEW', actions, undefined, notes);
  }
  if (outcome.status !== 'ASSESSED' || outcome.modelVersion !== policy.modelVersion || outcome.rubricVersion !== policy.rubricVersion) return result('UNASSESSED', ['ALLOW']);
  const c = f.categories.find(c => c.code === outcome.assessment.category.choice);
  const l = f.levels.find(l => l.code === outcome.assessment.severity.choice);
  if (!c || !l) return result('UNASSESSED', ['ALLOW']);
  const fallbackResult = (name: keyof JevDynamicFallbacks) => {
    const plan = policy.fallbackPlans![name];
    return result(name === 'missingContext' ? 'CONTEXT_REQUIRED' : name === 'missingHistory' ? 'HISTORY_REQUIRED' : 'PREVIEW', plan.actions, undefined,
      plan.actions.filter(notices).map(a => notification(a, plan.templates[a]!)));
  };
  if (c.contextRequirement === 'LECTURE_KNOWN' && (state.classroom.mode !== 'LECTURE' || !state.classroom.contextKnown)) return fallbackResult('missingContext');
  const rows = policy.rules.filter(r => r.category === c.code && r.severity === l.code && r.conditions!.modes.includes(state.classroom.mode));
  const key = rows[0]?.conditions?.counterGroup, prior = key ? history?.[key] : 0;
  if (!Number.isSafeInteger(prior) || prior! < 0 || prior! > 1000000) return fallbackResult('missingHistory');
  const r = rows.find(r => r.conditions!.minPriorCount <= prior! && (r.conditions!.maxPriorCount === null || prior! <= r.conditions!.maxPriorCount!));
  if (!r) return result('UNASSESSED', ['ALLOW']); // Không thể xảy ra với policy đã compile; không tự phạt nếu bị gọi sai.
  const a = outcome.assessment;
  let eligible = r.actions.filter(action => {
    const g = r.gates[action]!;
    return g.enabled && g.modes.includes(state.classroom.mode) && [[a.category.probabilities[a.category.choice], g.pCategoryMin],
      [a.category.confidence, g.categoryConfidenceMin], [a.severity.probabilities[a.severity.choice], g.pSeverityMin],
      [a.severity.confidence, g.severityConfidenceMin]].every(([value, min]) => min !== null && value !== null && value >= min);
  });
  eligible = eligible.filter(a => !punitive(a) || eligible.includes('BLOCK'));
  if (r.restrictionBasis === 'REPEAT') eligible = eligible.filter(a => !['SLOW_MODE', 'MUTE'].includes(a) || eligible.includes('COUNT_STRIKE'));
  if (!eligible.length) return fallbackResult('belowThreshold');
  const notes = eligible.flatMap(a => {
    const g = r.gates[a]!;
    return [...(g.templateKey ? [notification(a, g.templateKey)] : []), ...(g.teacherTemplateKey ? [notification(a, g.teacherTemplateKey)] : [])];
  });
  return result('PREVIEW', eligible, r, notes, prior!);
}

/** Kiểm tra được từng gate của draft trước publish, không nạp policy thiếu vào runtime. */
export function validateDynamicJevPolicy(input: unknown) {
  try { return { valid: true as const, policy: compileDynamicJevPolicy(input), issues: [] }; }
  catch (error) { return { valid: false as const, issues: error instanceof JevPolicyValidationError ? [...error.issues] : ['framework:invalid'] }; }
}
