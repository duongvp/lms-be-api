import { CHAT_L1_SIGNAL_IDS, type ChatL1Config, type ChatL1Mode } from './types';
import { CHAT_L1_PROFANITY_POLICY, validateChatL1ProfanityPolicy } from './profanity-policy';

export const CHAT_L1_POLICY_VERSION = 'l1-local-v8';
const ADMISSION_RULES = Object.freeze(['flood', 'repeat', 'profanity'] as const);
const CONTENT_RULES = Object.freeze(CHAT_L1_PROFANITY_POLICY.rules.map(rule => rule.id));

/**
 * Nhận env từ bootstrap sau dotenv; import module không tự đọc cấu hình máy.
 * Readiness là khả năng của code, không phải duyệt rollout. Flood/lặp/từ tục chỉ
 * thực thi khi mode enforce. Từ tục chỉ từ chối tin mới, không tăng N/mute.
 */
export function parseChatL1Config(env: Readonly<Record<string, string | undefined>>): ChatL1Config {
  const value = env.CHAT_L1_MODE;
  if (value !== undefined && typeof value !== 'string') throw new Error('INVALID_CHAT_L1_MODE');
  const mode = value?.trim().toLowerCase() || 'off';
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'enforce') {
    // Không đưa giá trị env sai (có thể chứa dữ liệu nhạy cảm) vào thông báo lỗi.
    throw new Error('INVALID_CHAT_L1_MODE');
  }
  validateChatL1ProfanityPolicy(CHAT_L1_PROFANITY_POLICY);
  return Object.freeze({
    mode: mode as ChatL1Mode,
    policyVersion: CHAT_L1_POLICY_VERSION,
    enforcementReady: true,
    enabledSignals: CHAT_L1_SIGNAL_IDS,
    enabledEnforcementRules: ADMISSION_RULES,
    enabledContentRules: CONTENT_RULES,
    contentPolicyVersion: CHAT_L1_PROFANITY_POLICY.version,
  });
}
