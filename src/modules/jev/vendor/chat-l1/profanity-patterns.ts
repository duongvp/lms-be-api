import { CHAT_L1_PROFANITY_POLICY, type ChatL1ProfanityRuleId, type ChatL1ProfanityPolicy } from './profanity-policy';

export type ProfanityCandidate = Readonly<{
  start: number; end: number; token: string; ruleId: ChatL1ProfanityRuleId;
  ambiguousSeparation: boolean; obfuscated: boolean; literalAlias: boolean;
}>;

// Giới hạn nhỏ, cố định: không ghép qua xuống dòng hoặc nhiều tin nhắn.
export const CHAT_L1_EVASION_LIMITS = Object.freeze({ repeatedLetter: 8, separatorRun: 3 });
const separator = '[ ._,*·\u200C\u200D-]';
const strongSeparator = /[._,*·-]|\u200C|\u200D/u;
// Join-control ở rìa còn có thể nối vào tên/mã khác, không bắt một mảnh của mã đó.
const boundary = String.raw`[\p{L}\p{M}\p{N}_\u200C\u200D]`;
const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function makePatternBody(token: string, mode: ChatL1ProfanityPolicy['rules'][number]['matchMode']): string {
  // Registry không phải regex: escape từng ký tự, chỉ sinh phép lặp nhỏ ở nhóm ngắn.
  const pieces = [...token].map(letter => mode === 'bounded'
    ? `${escapeLiteral(letter)}{1,${CHAT_L1_EVASION_LIMITS.repeatedLetter}}` : escapeLiteral(letter));
  return mode === 'literal' ? escapeLiteral(token)
    : pieces.join(`${separator}{0,${CHAT_L1_EVASION_LIMITS.separatorRun}}`);
}

export type CompiledPattern = Readonly<{
  token: string;
  ruleId: ChatL1ProfanityRuleId;
  literalAlias: boolean;
  regex: RegExp;
}>;

export function compileRulePatterns(
  rules: readonly Readonly<{ id: string; matchMode: 'bounded' | 'separated' | 'literal'; tokens: readonly string[] }>[]
): CompiledPattern[] {
  return rules.flatMap(rule => rule.tokens.map(token => {
    const body = makePatternBody(token, rule.matchMode);
    // Mẫu hai chữ không được ăn một phần của tên nối dấu như d.m.m_lab.
    // Nếu cả d.m.m là từ riêng thì mẫu dmm dài hơn vẫn nhận diện bình thường.
    const shortSuffix = token === 'dm' || token === 'đm' ? String.raw`(?![._-]{1,3}[\p{L}\p{M}\p{N}_])` : '';
    return {
      token,
      ruleId: rule.id as ChatL1ProfanityRuleId,
      literalAlias: rule.matchMode !== 'bounded',
      // Nhận _từ_, _từ hoặc từ_ độc lập, không nới ranh giới foo_từ hoặc từ_lab.
      // Capture lõi để dấu bọc không che ngoại lệ khoảng trắng/phép nhân.
      regex: new RegExp(`(?<!${boundary})_{0,3}(${body})_{0,3}(?!${boundary})${shortSuffix}`, 'gu'),
    };
  }));
}

const defaultPatterns = Object.freeze(compileRulePatterns(CHAT_L1_PROFANITY_POLICY.rules));
let activePatterns: readonly CompiledPattern[] = defaultPatterns;

export function setActiveProfanityPatterns(custom?: readonly CompiledPattern[] | null): void {
  activePatterns = custom == null ? defaultPatterns : Object.freeze([...custom]);
}

export function getActiveProfanityPatterns(): readonly CompiledPattern[] {
  return activePatterns;
}

/** Chỉ tìm vị trí trên bản so khớp; không sửa raw, không giữ lịch sử của người dùng. */
export function findProfanityCandidates(
  text: string,
  enabled: readonly ChatL1ProfanityRuleId[],
  patternsOverride?: readonly CompiledPattern[]
): ProfanityCandidate[] {
  const targetPatterns = patternsOverride ?? activePatterns;
  const found: ProfanityCandidate[] = [];
  for (const pattern of targetPatterns) {
    if (!enabled.includes(pattern.ruleId)) continue;
    // matchAll tạo iterator riêng: các request không dùng chung con trỏ lastIndex.
    for (const match of text.matchAll(pattern.regex)) {
      const core = match[1];
      found.push({
        start: match.index!,
        end: match.index! + match[0].length,
        token: pattern.token,
        ruleId: pattern.ruleId,
        obfuscated: match[0] !== pattern.token,
        literalAlias: pattern.literalAlias,
        // Khoảng trắng hoặc dấu nhân có thể là ký hiệu/phép tính, không tự chặn.
        ambiguousSeparation: pattern.token !== 'vl' && core.includes(' ') && !strongSeparator.test(core) || /[*·]/u.test(core),
      });
    }
  }
  // Token nguyên vẹn và mẫu lách có thể cùng khớp: xét một lần, ưu tiên span dài nhất.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const unique: ProfanityCandidate[] = [];
  let coveredUntil = -1;
  for (const item of found) {
    if (item.start < coveredUntil) continue;
    unique.push(item);
    coveredUntil = item.end;
  }
  return unique;
}
