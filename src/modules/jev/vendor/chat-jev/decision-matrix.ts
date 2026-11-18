import type { JevPreview, JevPreviewAction, JevShadowPolicy } from './shadow-policy';
import { freezeJevSnapshot, type JevCategory, type JevSeverity, type JevMode, type JevOutcome, type JevState } from './types';
import { defaultJevStudentMessage } from './student-notices';
import { readJevSafetySignals } from './contract';

export type JevCounterGroup = string;
/** Lịch sử do BE chụp theo UID/calendar, không nằm trong state gửi Jev; thiếu không đồng nghĩa 0. */
export type JevDecisionHistory = Readonly<Partial<Record<JevCounterGroup, number>>>;
export type JevRuleConditions = Readonly<{ modes: readonly JevMode[]; counterGroup: JevCounterGroup | null;
  minPriorCount: number; maxPriorCount: number | null }>;
export type JevActionParams = Readonly<{ cooldownSeconds?: number; intervalSeconds?: number; durationSeconds?: number }>;
type BaseMatrix = readonly (readonly [string, JevCategory, JevSeverity, readonly JevPreviewAction[]])[];
const modes: readonly JevMode[] = ['LOBBY', 'LECTURE', 'UNKNOWN'];
function fail(): never { throw new Error('INVALID_JEV_POLICY'); }
const sameModes = (a: readonly string[], b: readonly string[]) => [...a].sort().join(',') === [...b].sort().join(',');

/** v2 vẫn dùng danh mục model hữu hạn, nhưng số rule/mode/nấc lượt không bị khóa cứng ở 14. */
export function validateDecisionMatrix(policy: JevShadowPolicy, base: BaseMatrix) {
  if (!policy.fallbacks || policy.rules.length > 128 || policy.rules.reduce((sum, rule) => sum + rule.actions.length, 0) > 512) fail();
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (rule.severity === 'ANY') {
      // Nhánh bảo vệ nội dung không được ghi lịch sử hoặc ngụy trang thành hình phạt.
      const c = rule.conditions;
      if (!['SPAM_DISRUPTION', 'ABUSE_BULLYING', 'PII_EXTERNAL'].includes(rule.category) || !c || ids.has(rule.id)
        || c.counterGroup !== null || c.minPriorCount !== 0 || c.maxPriorCount !== null
        || new Set(c.modes).size !== c.modes.length || new Set(rule.actions).size !== rule.actions.length
        || Object.keys(rule.gates).length !== rule.actions.length) fail();
      ids.add(rule.id);
      for (const action of rule.actions) {
        const gate = rule.gates[action];
        if (!['BLOCK', 'PRIVATE_NUDGE'].includes(action) || !gate || !sameModes(gate.modes, c.modes)
          || new Set(gate.modes).size !== gate.modes.length || gate.pSeverityMin !== 0 || gate.severityConfidenceMin !== 0) fail();
        const keys = Object.keys(gate.params || {}).sort().join(',');
        if (action === 'BLOCK' ? keys !== '' : keys !== 'cooldownSeconds') fail();
      }
      continue;
    }
    const pair = base.find(row => row[1] === rule.category && row[2] === rule.severity);
    const c = rule.conditions;
    if (!pair || !c || ids.has(rule.id) || new Set(c.modes).size !== c.modes.length ||
      c.maxPriorCount !== null && c.maxPriorCount < c.minPriorCount) fail();
    ids.add(rule.id);
    const expectedGroup = rule.category === 'SPAM_DISRUPTION' ? 'SPAM' : rule.category === 'ABUSE_BULLYING' ? 'ABUSE' : rule.category === 'PII_EXTERNAL' ? 'PII' : null;
    if (c.counterGroup !== null && c.counterGroup !== expectedGroup ||
      c.counterGroup === null && (c.minPriorCount !== 0 || c.maxPriorCount !== null)) fail();
    const allowed = new Set<JevPreviewAction>(pair[3]);
    if (rule.category === 'OFF_TOPIC' && rule.severity === 'MEDIUM') allowed.add('SLOW_MODE');
    if (expectedGroup && rule.severity === 'MEDIUM') {
      allowed.add('COUNT_STRIKE'); allowed.add('SLOW_MODE'); allowed.add('MUTE'); allowed.add('TEACHER_ALERT');
    }
    if (expectedGroup && rule.severity === 'HIGH') { allowed.add('MUTE'); allowed.add('SLOW_MODE'); }
    if (rule.actions.some(action => !allowed.has(action)) || new Set(rule.actions).size !== rule.actions.length ||
      Object.keys(rule.gates).length !== rule.actions.length || rule.actions.includes('MUTE') && rule.actions.includes('SLOW_MODE')) fail();
    if (rule.actions.includes('COUNT_STRIKE') && (!c.counterGroup || rule.category === 'PII_EXTERNAL' && c.minPriorCount === 0)) fail();
    if (rule.actions.some(action => action === 'SLOW_MODE' || action === 'MUTE') && !rule.actions.includes('BLOCK')) fail();
    if (rule.severity === 'MEDIUM' && expectedGroup && rule.actions.some(action => action === 'SLOW_MODE' || action === 'MUTE')
      && (!rule.actions.includes('COUNT_STRIKE') || c.minPriorCount === 0)) fail();
    for (const action of rule.actions) {
      const gate = rule.gates[action];
      if (!gate || !sameModes(gate.modes, c.modes) || new Set(gate.modes).size !== gate.modes.length ||
        gate.studentMessage !== undefined && action !== 'BLOCK' && action !== 'PRIVATE_NUDGE') fail();
      const params = gate.params || {};
      const keys = Object.keys(params).sort().join(',');
      if (action === 'SLOW_MODE') {
        if (keys !== 'durationSeconds,intervalSeconds' || params.intervalSeconds! > params.durationSeconds!) fail();
      } else if (action === 'MUTE') { if (keys !== 'durationSeconds') fail(); }
      else if (action === 'PRIVATE_NUDGE' || action === 'TEACHER_ALERT') {
        if (keys !== 'cooldownSeconds') fail();
      } else if (keys) fail();
      // COUNT phải có BLOCK trong cùng kế hoạch; preview kiểm riêng cả hai gate trước khi đề xuất tính lượt.
      if (action === 'COUNT_STRIKE' && !rule.actions.includes('BLOCK')) fail();
    }
  }
  // Một nhóm/mode chỉ có một rule bảo vệ; không dùng priority để che cấu hình chồng nhau.
  for (const category of ['SPAM_DISRUPTION', 'ABUSE_BULLYING', 'PII_EXTERNAL']) for (const mode of modes) {
    if (policy.rules.filter(r => r.severity === 'ANY' && r.category === category && r.conditions!.modes.includes(mode)).length > 1) fail();
  }
  // Bao phủ mọi mức hợp lệ × mode × số lượt. Không dùng priority để che rule chồng chéo.
  for (const [, category, severity] of base) {
    const pair = policy.rules.filter(rule => rule.category === category && rule.severity === severity);
    if (!pair.length || new Set(pair.map(rule => rule.conditions!.counterGroup)).size !== 1) fail();
    for (const mode of modes) {
      const ranges = pair.filter(rule => rule.conditions!.modes.includes(mode))
        .sort((a, b) => a.conditions!.minPriorCount - b.conditions!.minPriorCount);
      let next = 0;
      if (!ranges.length) fail();
      for (let i = 0; i < ranges.length; i++) {
        const c = ranges[i]!.conditions!;
        if (c.minPriorCount !== next || c.maxPriorCount === null && i !== ranges.length - 1) fail();
        next = c.maxPriorCount === null ? Infinity : c.maxPriorCount + 1;
      }
      if (next !== Infinity) fail();
    }
  }
}

/** Tạo kế hoạch thuần, không ghi bộ đếm, không emit socket và không thực hiện bất kỳ hình phạt nào. */
function previewSeverityDecisionMatrix(outcome: JevOutcome, state: JevState, policy: JevShadowPolicy,
  history?: JevDecisionHistory, groupBlock = false): JevPreview {
  const result = (status: JevPreview['status'], rule: JevShadowPolicy['rules'][number] | null = null,
    candidates: readonly JevPreviewAction[] = [], eligible: readonly JevPreviewAction[] = [],
    fallback: JevPreview['fallback'] = null, priorCount: number | null = null): JevPreview => {
    const group = rule?.conditions?.counterGroup;
    const wouldCount = eligible.includes('COUNT_STRIKE');
    // PII dùng số sự kiện đã bảo vệ, không biến lần đầu lộ thông tin thành lượt kỷ luật.
    const advanceCounter = group === 'PII' ? eligible.includes('BLOCK') : wouldCount;
    return freezeJevSnapshot({ status, policyVersion: policy.version, ruleId: rule?.id || null,
      candidateActions: candidates, eligibleActions: eligible, appliedActions: [] as never[], countStrike: false,
      wouldCountStrike: wouldCount, fallback,
      history: group && priorCount !== null ? { counterGroup: group, counterKind: group === 'PII' ? 'INCIDENT' as const : 'STRIKE' as const,
        priorCount, projectedCount: Math.min(1000000, priorCount + (advanceCounter ? 1 : 0)) } : null,
      actionPlan: eligible.map(action => ({ action, params: rule?.gates[action]?.params || {} })),
      studentNotices: eligible.flatMap(action => {
        if (!rule || action !== 'PRIVATE_NUDGE' && action !== 'BLOCK') return [];
        const configured = rule.gates[action]?.studentMessage;
        const text = configured ?? defaultJevStudentMessage(rule.category, action);
        return text ? [{ action, text, source: configured === undefined ? 'default' as const : 'policy' as const }] : [];
      }),
    });
  };
  const f = policy.fallbacks!;
  // Partial response chỉ được cứu tín hiệu Noul đã kiểm; chưa có đánh giá không được đi nhánh strike/mute.
  const safetySignals = readJevSafetySignals(outcome, policy.modelVersion, policy.rubricVersion);
  if (policy.safetySignalMin !== null && safetySignals &&
    ((safetySignals.threat ?? -1) >= policy.safetySignalMin || (safetySignals.distress ?? -1) >= policy.safetySignalMin)) {
    return result('SAFETY_REVIEW', null, [...((safetySignals.distress ?? -1) >= policy.safetySignalMin ? ['SAFETY_SUPPORT' as const] : []),
      ...((safetySignals.threat ?? -1) >= policy.safetySignalMin ? ['SAFETY_ALERT' as const] : [])], [], 'SAFETY_REVIEW');
  }
  if (outcome.status !== 'ASSESSED') return result('UNASSESSED', null, [], [], f.unassessed);
  if (outcome.modelVersion !== policy.modelVersion || outcome.rubricVersion !== policy.rubricVersion) return result('UNRESOLVED', null, [], [], f.unresolved);
  const { category, severity } = outcome.assessment;
  const pair = policy.rules.filter(rule => rule.category === category.choice && rule.severity === severity.choice);
  if (!pair.length) return result('UNRESOLVED', null, [], [], f.unresolved);
  // Không chấp nhận rule Admin biến giao lưu trước giờ học hoặc thiếu ngữ cảnh thành lỗi lạc đề.
  if (category.choice === 'OFF_TOPIC') {
    if (state.classroom.mode === 'LOBBY') return result('PREVIEW', null, ['ALLOW'], ['ALLOW']);
    if (state.classroom.mode !== 'LECTURE' || !state.classroom.contextKnown) return result('CONTEXT_REQUIRED', null, [], [], f.missingContext);
  }
  const group = pair[0]!.conditions!.counterGroup;
  const prior = group ? history?.[group] : 0;
  if (prior === undefined || !Number.isSafeInteger(prior) || prior < 0 || prior > 1000000) {
    return result('HISTORY_REQUIRED', null, [], [], f.missingHistory);
  }
  const matches = pair.filter(rule => rule.conditions!.modes.includes(state.classroom.mode) &&
    prior >= rule.conditions!.minPriorCount && (rule.conditions!.maxPriorCount === null || prior <= rule.conditions!.maxPriorCount));
  if (matches.length !== 1) return result('UNRESOLVED', null, [], [], f.unresolved);
  const rule = matches[0]!;
  const candidates = rule.actions.filter(action => rule.gates[action]!.enabled);
  if (!candidates.length) return result('PREVIEW', rule, [], [], 'NO_AUTOMATIC_ACTION', prior);
  if (policy.safetySignalMin === null) return result('PENDING_CALIBRATION', rule, candidates, [], 'NO_AUTOMATIC_ACTION', prior);
  let incomplete = false;
  let eligible = candidates.filter(action => {
    const gate = rule.gates[action]!;
    if ([gate.pCategoryMin, gate.categoryConfidenceMin, gate.pSeverityMin, gate.severityConfidenceMin].some(value => value === null)) {
      incomplete = true; return false;
    }
    return category.probabilities[category.choice] >= gate.pCategoryMin! && category.confidence >= gate.categoryConfidenceMin!
      && severity.probabilities[severity.choice] >= gate.pSeverityMin! && severity.confidence >= gate.severityConfidenceMin!;
  });
  // Đạt lượt không thay thế gate: không BLOCK thì không COUNT; MEDIUM không COUNT thì không leo thang.
  eligible = eligible.filter(action => action !== 'COUNT_STRIKE' || eligible.includes('BLOCK') || groupBlock);
  eligible = eligible.filter(action => action !== 'SLOW_MODE' && action !== 'MUTE' || (eligible.includes('BLOCK') || groupBlock) &&
    (severity.choice !== 'MEDIUM' || !group || eligible.includes('COUNT_STRIKE')));
  return result(incomplete ? 'PENDING_CALIBRATION' : 'PREVIEW', rule, candidates, eligible,
    eligible.length ? null : f.belowThreshold, prior);
}

/** Bảo vệ tin trước, xử phạt sau: độ chắc mức độ không được vô hiệu hóa một BLOCK theo nhóm. */
export function previewDecisionMatrix(outcome: JevOutcome, state: JevState, policy: JevShadowPolicy,
  history?: JevDecisionHistory): JevPreview {
  const baseline = previewSeverityDecisionMatrix(outcome, state, policy, history);
  if (baseline.status === 'SAFETY_REVIEW' || outcome.status !== 'ASSESSED'
    || outcome.modelVersion !== policy.modelVersion || outcome.rubricVersion !== policy.rubricVersion
    || policy.safetySignalMin === null) return baseline;
  const { category, severity } = outcome.assessment;
  // CRITICAL không hợp với nhóm thông thường: giữ riêng review, không biến tín hiệu nguy hiểm thành spam nhẹ.
  if (severity.choice === 'CRITICAL' || category.choice === 'SAFETY_THREAT' || category.choice === 'SAFETY_DISTRESSED') return baseline;
  const groupRule = policy.rules.find(r => r.severity === 'ANY' && r.category === category.choice && r.conditions!.modes.includes(state.classroom.mode));
  if (!groupRule) return baseline;
  const groupCandidates = groupRule.actions.filter(action => groupRule.gates[action]!.enabled);
  const groupEligible = groupCandidates.filter(action => {
    const gate = groupRule.gates[action]!;
    return gate.pCategoryMin !== null && gate.categoryConfidenceMin !== null
      && category.probabilities[category.choice] >= gate.pCategoryMin && category.confidence >= gate.categoryConfidenceMin;
  });
  const groupBlock = groupEligible.includes('BLOCK');
  const detail = groupBlock ? previewSeverityDecisionMatrix(outcome, state, policy, history, true) : baseline;
  const detailedRule = policy.rules.find(r => r.id === detail.ruleId);
  const eligible = [...new Set([...groupEligible, ...detail.eligibleActions])];
  const sources: Partial<Record<JevPreviewAction, string>> = {};
  // Gate mức độ được giữ nguyên. Có BLOCK không đồng nghĩa được COUNT/SLOW/MUTE.
  for (const action of groupEligible) sources[action] = groupRule.id;
  for (const action of detail.eligibleActions) if (detailedRule) sources[action] = detailedRule.id;
  const primary = detail.eligibleActions.some(a => ['BLOCK', 'COUNT_STRIKE', 'SLOW_MODE', 'MUTE'].includes(a))
    ? detailedRule : groupEligible.length ? groupRule : detailedRule;
  return freezeJevSnapshot({ ...detail,
    status: groupBlock ? 'PREVIEW' : detail.status,
    ruleId: primary?.id ?? null, groupRuleId: groupRule.id, severityRuleId: detail.ruleId, severityDecision: detail.status,
    actionSources: sources, candidateActions: [...new Set([...groupCandidates, ...detail.candidateActions])], eligibleActions: eligible,
    fallback: groupBlock ? null : detail.fallback,
    // Chặn theo nhóm không cần lịch sử và không tạo cả INCIDENT của PII nếu tầng mức độ chưa đủ điều kiện.
    history: primary?.severity === 'ANY' ? null : detail.history,
    wouldCountStrike: eligible.includes('COUNT_STRIKE'),
    actionPlan: eligible.map(action => ({ action, params: policy.rules.find(r => r.id === sources[action])?.gates[action]?.params || {} })),
    studentNotices: eligible.flatMap(action => {
      if (action !== 'BLOCK' && action !== 'PRIVATE_NUDGE') return [];
      const source = policy.rules.find(r => r.id === sources[action]);
      if (!source) return [];
      const configured = source.gates[action]?.studentMessage, text = configured ?? defaultJevStudentMessage(source.category, action);
      return text ? [{ action, text, source: configured === undefined ? 'default' as const : 'policy' as const }] : [];
    }),
  });
}
