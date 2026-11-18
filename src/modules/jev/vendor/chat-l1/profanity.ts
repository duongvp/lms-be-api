import type { ChatL1Normalized } from './normalize';
import { CHAT_L1_PROFANITY_POLICY, type ChatL1ProfanityRuleId } from './profanity-policy';
import type { ChatL1Proposal, ChatL1SignalId } from './types';
import { findProfanityCandidates } from './profanity-patterns';

type ExceptionId = 'VI-CTX-REPORT' | 'VI-CTX-DEFINITION' | 'VI-CTX-ACADEMIC' | 'VI-CTX-REFERENCE' | 'VI-CTX-DISTRESS'
  | 'VI-CTX-SPACED' | 'VI-CTX-CODE';
export type ChatL1ProfanityMatch = Readonly<{
  policyVersion: string;
  ruleIds: readonly ChatL1ProfanityRuleId[];
  exceptionIds: readonly ExceptionId[];
  proposedAction: ChatL1Proposal;
}>;

const REFERENCES = /(?:https?:\/\/|www\.)\S+/gu;

// Khung ngữ cảnh phải ở sát token trong cùng mệnh đề; chỉ dấu ngoặc kép không đủ.
const REPORT_BEFORE = /(?:^|[^\p{L}\p{M}\p{N}_])(?:(?:bạn(?: ấy| đó)?|nó|họ|có người|một bạn|bạn cùng lớp)\s+(?:(?:vừa|đã|cứ)\s+)?(?:chửi|mắng|gọi|nói với)\s+(?:em|mình|tôi|tớ)|(?:em|mình|tôi|tớ)\s+bị\s+(?:chửi|mắng))\s*(?:(?:là|rằng|bằng từ)\s*)?[:\s“”"'‘’(]*$/u;
// Tin được báo lại có chủ thể gửi và người nhận; không miễn chỉ vì gặp chữ “nhắn”.
const SENT_BEFORE = /(?:^|[^\p{L}\p{M}\p{N}_])(?:bạn(?: ấy| đó)?|nó|họ|một bạn)\s+(?:(?:vừa|đã)\s+)?(?:nhắn|gửi)\s*[:\s“”"'‘’(]*$/u;
const SENT_AFTER = /^[\s“”"'‘’)]*(?:cho|với)\s+(?:em|mình|tớ|tôi)(?=$|[^\p{L}\p{M}\p{N}_])/u;
const DEFINITION_AFTER = /^[\s“”"'‘’)]*(?:có\s+)?nghĩa\s+là\s+gì(?:$|[^\p{L}\p{M}\p{N}_])/u;
const ACADEMIC_BEFORE = /(?:trong bài (?:văn|học)|trích dẫn|nhân vật (?:nói|viết))[^.!?;\r\n]{0,48}$/u;
const QUOTED_ACADEMIC_BEFORE = /(?:trích dẫn|nhân vật (?:nói|viết))[^.!?;\r\n]{0,48}$/u;
// DMM còn là viết tắt của đồng hồ đo điện. Ngoại lệ kỹ thuật này không áp cho mọi từ tục.
const METER_BEFORE = /đồng hồ(?: đo)?[^.!?;\r\n]{0,48}$/u;
const METER_AFTER = /^[\s“”"'‘’)]*(?:là\s+)?đồng hồ(?:$|[^\p{L}\p{M}\p{N}_])/u;
// Chỉ giữ dm nguyên dạng khi có khung đơn vị độ dài rõ ngay trước nó.
// Không dùng ngoại lệ này cho đm, dạng lách hoặc dm đứng riêng.
const LENGTH_UNIT_BEFORE = /(?:đơn vị\s+(?:(?:cm|mm|m)\s+và\s+)?|(?:mét|centimét|milimét|xentimét)[^.!?;\r\n]{0,40}bao nhiêu\s+)$/u;
// Alias hoặc dạng phân cách trông giống tên biến/mã. Có khung kỹ thuật thì để L2 xét.
const CODE_BEFORE = /(?:mã|biến|ký hiệu|tham số|biểu thức|phép tính|tích)\s*[:=“”"'‘’(]*\s*$/u;
const CODE_AFTER = /^\s*(?:=|:=|[+*/])/u;

let activeProfanityPolicyVersion: string = CHAT_L1_PROFANITY_POLICY.version;

export function setActiveProfanityPolicyVersion(version?: string | null): void {
  activeProfanityPolicyVersion = version || CHAT_L1_PROFANITY_POLICY.version;
}

export function getActiveProfanityPolicyVersion(): string {
  return activeProfanityPolicyVersion;
}

/**
 * Nhận bản đã validate/chuẩn hóa, chỉ trả đề xuất và ID hữu hạn, không giữ raw.
 * Ngoại lệ là nghi vấn cần ngữ cảnh, KHÔNG có nghĩa đã báo tới GV/Jev hay được miễn cấm.
 */
export function matchChatL1Profanity(value: ChatL1Normalized, signals: readonly ChatL1SignalId[],
  enabledRules: readonly ChatL1ProfanityRuleId[]): ChatL1ProfanityMatch {
  const ruleIds = new Set<ChatL1ProfanityRuleId>(), exceptionIds = new Set<ExceptionId>();
  const references = [...value.matchText.matchAll(REFERENCES)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
  let unprotected = false, previousTokenEnd = 0;
  // Xét từng vị trí khớp, không miễn cả câu vì chỉ một từ đang được trích dẫn.
  // Những nhánh NEEDS_CONTEXT chỉ cho L1 chưa kết luận; chưa có nghĩa Jev đã duyệt.
  for (const match of findProfanityCandidates(value.matchText, enabledRules)) {
    ruleIds.add(match.ruleId);
    const { start, end } = match;
    // Không kéo khung học thuật/báo cáo qua một token đã xét rồi để miễn cả chuỗi.
    const before = value.matchText.slice(Math.max(previousTokenEnd, start - 96), start);
    const after = value.matchText.slice(end, end + 96);
    previousTokenEnd = end;
    if (references.some(range => start >= range.start && end <= range.end)) exceptionIds.add('VI-CTX-REFERENCE');
    else if (match.ambiguousSeparation) exceptionIds.add('VI-CTX-SPACED');
    else if ((match.literalAlias || match.obfuscated) && (CODE_BEFORE.test(before) || CODE_AFTER.test(after))) exceptionIds.add('VI-CTX-CODE');
    else if (REPORT_BEFORE.test(before) || SENT_BEFORE.test(before) && SENT_AFTER.test(after)) exceptionIds.add('VI-CTX-REPORT');
    else if (DEFINITION_AFTER.test(after)) exceptionIds.add('VI-CTX-DEFINITION');
    // Không miễn VL chỉ vì xuất hiện trong bài học; trích dẫn/báo cáo thật vẫn được xét.
    else if (ACADEMIC_BEFORE.test(before) && (match.token !== 'vl' || QUOTED_ACADEMIC_BEFORE.test(before))
      || match.token === 'dmm' && (METER_BEFORE.test(before) || METER_AFTER.test(after))
      || match.token === 'dm' && !match.obfuscated && LENGTH_UNIT_BEFORE.test(before)) exceptionIds.add('VI-CTX-ACADEMIC');
    else unprotected = true;
  }
  // Tín hiệu an toàn được xét trên toàn câu, kể cả khi caller tắt nhãn telemetry.
  // Không dùng ngoại lệ của một token để miễn một token khác đang dùng trực tiếp.
  const distress = ruleIds.size > 0 && signals.includes('possible_distress');
  if (distress) exceptionIds.add('VI-CTX-DISTRESS');
  return Object.freeze({ policyVersion: activeProfanityPolicyVersion,
    ruleIds: Object.freeze([...ruleIds]), exceptionIds: Object.freeze([...exceptionIds]),
    proposedAction: !ruleIds.size ? 'NONE' : distress ? 'PRIORITY_REVIEW'
      : unprotected ? 'BLOCK_MESSAGE' : 'NEEDS_CONTEXT' });
}
