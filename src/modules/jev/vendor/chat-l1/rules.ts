import type { ChatL1Normalized } from './normalize';
import type { ChatL1SignalId } from './types';
import { hasContextLanguage } from './context-language';

/** Ngưỡng/mẫu thử có version trong config, không phải danh mục xử phạt production. */
export const CHAT_L1_REPEATED_RUN = 8;

// Ranh giới Unicode tránh coi chữ nằm trong một từ tiếng Việt là viết tắt/số liên hệ.
const CONTACT = /(?:^|[^\p{L}\p{M}\p{N}_])[0-9]{9,11}(?=$|[^\p{L}\p{M}\p{N}_])/u;
const ABBREVIATION = /(?:^|[^\p{L}\p{M}\p{N}_])(?:vl|cl|dm|đm|cc)(?=$|[^\p{L}\p{M}\p{N}_])/u;
const URL_CANDIDATE = /(?:^|[^\p{L}\p{M}\p{N}_])(?:https?:\/\/|www\.)\S+/u;
const DISTRESS = /(?:^|[^\p{L}\p{M}\p{N}_])(?:khó thở|không thở được|khong tho duoc|không thở nổi|khong tho noi|cứu em với|cuu em voi|muốn tự làm hại|muon tu lam hai|muốn chết)(?=$|[^\p{L}\p{M}\p{N}_])/u;

/** Thu tất cả cờ: một link/hotline hay từ tục không được che mất tín hiệu cầu cứu. */
export function collectChatL1Signals(value: ChatL1Normalized): ChatL1SignalId[] {
  const signals: ChatL1SignalId[] = [];
  if (value.features.maxRepeatedRun >= CHAT_L1_REPEATED_RUN) signals.push('repeated_character');
  if (CONTACT.test(value.matchText)) signals.push('possible_contact');
  // Chỉ đánh dấu URL, không fetch hoặc coi domain là được phép/chắc chắn lừa đảo.
  if (URL_CANDIDATE.test(value.matchText)) signals.push('possible_external_url');
  if (DISTRESS.test(value.matchText)) signals.push('possible_distress');
  if (ABBREVIATION.test(value.matchText)) signals.push('ambiguous_abbreviation');
  if (hasContextLanguage(value.matchText)) signals.push('contextual_language');
  return signals;
}
