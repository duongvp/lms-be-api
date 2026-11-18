import type { ChatL1ProfanityRuleId } from './profanity-policy';

/** Tín hiệu quan sát tách biệt với quyết định thực thi và không tự tăng lượt phạt. */
export const CHAT_L1_SIGNAL_IDS = Object.freeze([
  'repeated_character',
  'possible_contact',
  'possible_external_url',
  'possible_distress',
  'ambiguous_abbreviation',
  'possible_profanity',
  'contextual_language',
] as const);

export type ChatL1SignalId = typeof CHAT_L1_SIGNAL_IDS[number];
export type ChatL1Mode = 'off' | 'shadow' | 'enforce';
export type ChatL1Proposal = 'NONE' | 'NEEDS_CONTEXT' | 'PRIORITY_REVIEW' | 'BLOCK_MESSAGE';
export type ChatL1InputReason = 'INVALID_TYPE' | 'EMPTY' | 'TOO_LONG';
// Nhãn định tuyến nội dung, không phải kết quả gửi tin hoặc quyền bỏ qua các guard.
export type ChatL1ReviewRoute = 'DISABLED' | 'INVALID' | 'L1_BLOCK' | 'SHORT_SAFE' | 'L2_CANDIDATE';

export type ChatL1Config = Readonly<{
  mode: ChatL1Mode;
  policyVersion: string;
  enforcementReady: boolean;
  enabledSignals: readonly ChatL1SignalId[];
  enabledEnforcementRules: readonly ('flood' | 'repeat' | 'profanity')[];
  enabledContentRules: readonly ChatL1ProfanityRuleId[];
  contentPolicyVersion: string;
}>;

export type ChatL1ValidInput = Readonly<{
  valid: true;
  raw: string;
  codeUnitLength: number;
  utf8Bytes: number;
}>;

export type ChatL1Input = ChatL1ValidInput | Readonly<{
  valid: false;
  reason: ChatL1InputReason;
}>;

/** Pure evaluator chỉ đề xuất; appliedAction không được giả là tin đã bị BE chặn. */
export type ChatL1Decision = Readonly<{
  policyVersion: string;
  ruleIds: readonly (ChatL1SignalId | ChatL1ProfanityRuleId)[];
  signals: readonly ChatL1SignalId[];
  inputReason: ChatL1InputReason | null;
  proposedAction: ChatL1Proposal;
  reviewRoute: ChatL1ReviewRoute;
  appliedAction: 'NONE';
  contentPolicyVersion?: string;
}>;
