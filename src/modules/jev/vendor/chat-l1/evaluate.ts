import { inspectChatL1Input } from './input';
import { normalizeChatL1 } from './normalize';
import { collectChatL1Signals } from './rules';
import { matchChatL1Profanity } from './profanity';
import { isChatL1ShortSafe } from './short-safe';
import type { ChatL1Config, ChatL1Decision } from './types';

/** Hàm thuần trả đề xuất, không gọi AI/DB và không thay quyền chat của học sinh. */
export function evaluateChatL1(raw: unknown, config: ChatL1Config): ChatL1Decision {
  const input = inspectChatL1Input(raw);
  if (input.valid === false) {
    return Object.freeze({ policyVersion: config.policyVersion, ruleIds: Object.freeze([]),
      signals: Object.freeze([]), inputReason: input.reason, proposedAction: 'NONE', reviewRoute: 'INVALID', appliedAction: 'NONE' });
  }
  // Validation đầu vào độc lập mode; off không chuẩn hóa/so khớp nội dung.
  if (config.mode === 'off') return Object.freeze({ policyVersion: config.policyVersion,
    ruleIds: Object.freeze([]), signals: Object.freeze([]), inputReason: null,
    proposedAction: 'NONE', reviewRoute: 'DISABLED', appliedAction: 'NONE' });
  const normalized = normalizeChatL1(input);
  const observed = collectChatL1Signals(normalized);
  // Dùng đầy đủ tín hiệu an toàn khi xét ngoại lệ; công tắc nhãn không được
  // biến một câu cầu cứu thành quyết định chặn chỉ vì nó có kèm từ tục.
  const content = matchChatL1Profanity(normalized, observed, config.enabledContentRules);
  const signals = Object.freeze([...observed, ...(content.ruleIds.length ? ['possible_profanity' as const] : [])]
    .filter(signal => config.enabledSignals.includes(signal)));
  const proposedAction = signals.includes('possible_distress') ? 'PRIORITY_REVIEW'
    : content.proposedAction !== 'NONE' ? content.proposedAction : signals.length ? 'NEEDS_CONTEXT' : 'NONE';
  // Không có từ cấm KHÔNG đồng nghĩa an toàn. Chỉ câu khớp cả danh sách và không
  // có bất kỳ tín hiệu gốc nào mới được đề xuất bỏ L2; tắt label không nới ngoại lệ.
  // Admission vẫn phải chạy chống lặp/flood, receipt, kiểm quyền và cấm như cũ.
  const reviewRoute = proposedAction === 'BLOCK_MESSAGE' ? 'L1_BLOCK'
    : observed.length === 0 && content.ruleIds.length === 0 && isChatL1ShortSafe(input.raw) ? 'SHORT_SAFE' : 'L2_CANDIDATE';
  return Object.freeze({
    policyVersion: config.policyVersion,
    ruleIds: Object.freeze([...signals, ...content.ruleIds]),
    signals,
    inputReason: null,
    proposedAction,
    reviewRoute,
    appliedAction: 'NONE',
    ...(content.ruleIds.length ? { contentPolicyVersion: content.policyVersion } : {}),
  });
}
