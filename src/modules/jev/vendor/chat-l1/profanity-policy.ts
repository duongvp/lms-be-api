/**
 * Danh mục từ tục rõ cho thử local, KHÔNG phải từ điển tiếng Việt đầy đủ.
 * Giữ dấu và ranh giới Unicode; chỉ bóc dạng lách hữu hạn, không suy diễn từ đa nghĩa.
 * Mỗi token có test chặn/ngoại lệ; không nhận regex hay quyết định từ học sinh.
 */
export const CHAT_L1_PROFANITY_POLICY = Object.freeze({
  version: 'vi-profanity-local-v7',
  rules: Object.freeze([
    Object.freeze({
      id: 'VI-PROF-001' as const,
      matchMode: 'bounded' as const,
      tokens: Object.freeze([
        'dmm',
        'đmm',
        'dcm',
        'đcm',
        'vcl',
        'vkl',
        'địt',
        'đụ',
        'lồn',
        'cặc',
        'buồi',
        'đéo',
        'đkm',
        'dkm',
        'clm',
        'vl', // Quy tắc lớp học: muốn nói Vật lý thì viết đầy đủ, không miễn VL đứng lẻ.
      ]),
    }),
    // Alias tĩnh, không đổi mọi chữ số/ký tự trong câu thành chữ tiếng Việt.
    Object.freeze({ id: 'VI-PROF-002' as const, matchMode: 'separated' as const,
      tokens: Object.freeze(['djt', 'đjt', 'd3o', 'đ3o', 'c4c', 'l0n']) }),
    // Họ từ bổ sung có chọn lọc từ Vietnamese Offensive Words (MIT), xem THIRD_PARTY_NOTICES.md.
    Object.freeze({ id: 'VI-PROF-003' as const, matchMode: 'bounded' as const,
      tokens: Object.freeze(['bòi', 'cặk', 'cứt', 'cứk', 'đếch', 'đếk', 'đách', 'đel',
        'đél', 'đĩ', 'điếm', 'chịch', 'nứng', 'xoạc', 'đệt', 'đệch']) }),
    // Cụm xác định rõ: nhận dấu xen giữa nhưng không bỏ dấu hoặc ghép các từ tùy ý.
    Object.freeze({ id: 'VI-PROF-004' as const, matchMode: 'separated' as const,
      tokens: Object.freeze(['concak', 'bucak', 'caiconcac', 'caiconcak', 'disme', 'dismje',
        'dismia', 'ditmemay', 'ditmemayconcho', 'ditmeconcho', 'dmconcho', 'condime',
        'condimay', 'condimemay', 'caidaubuoi', 'nhucaidaubuoi']) }),
    // Viết tắt tục dùng trực tiếp cũng bị từ chối, không đợi L2 mới xét.
    Object.freeze({ id: 'VI-PROF-005' as const, matchMode: 'bounded' as const,
      tokens: Object.freeze(['dm', 'đm']) }),
    // Biến thể được duyệt riêng, không thay mọi c/k hay mọi dấu thanh trong câu.
    Object.freeze({ id: 'VI-PROF-006' as const, matchMode: 'bounded' as const,
      tokens: Object.freeze(['cẹc', 'cẹk', 'kặc', 'kặk', 'kẹc', 'kẹk', 'lìn', 'lồz',
        'loz', 'đis', 'điz', 'clgt', 'clmm', 'cmn', 'cmnl', 'đcl']) }),
    // Cụm không dấu rõ hơn từ đơn: vẫn để lon/buoi/dit và lời công kích đa nghĩa cho L2.
    Object.freeze({ id: 'VI-PROF-007' as const, matchMode: 'separated' as const,
      tokens: Object.freeze(['daubuoi', 'dauboi', 'caidauboi', 'ditmecondi', 'ditmecondicho',
        'ditmethangoccho', 'dimemay', 'condicho', 'matlon', 'cailon', 'matloz',
        'thangmatlon', 'sapmatlon', 'sapmatloz', 'vlon', 'vloz']) }),
    // Chỉ alias số/ký hiệu hữu hạn; không đổi !/1/4/0 trong nội dung học tập.
    Object.freeze({ id: 'VI-PROF-008' as const, matchMode: 'separated' as const,
      tokens: Object.freeze(['c4k', 'k4c', 'k4k', 'l0z', 'd!t', 'đ!t', 'd1t', 'đ1t']) }),
  ]),
});

export type ChatL1ProfanityRuleId = typeof CHAT_L1_PROFANITY_POLICY.rules[number]['id'];
export type ChatL1ProfanityPolicy = Readonly<{
  version: string;
  rules: readonly Readonly<{ id: string; matchMode: 'bounded' | 'separated' | 'literal'; tokens: readonly string[] }>[];
}>;

/** Validate một lần tại bootstrap; giá trị lỗi không được đưa nguyên vào log. */
export function validateChatL1ProfanityPolicy(policy: ChatL1ProfanityPolicy): void {
  const invalid = () => { throw new Error('INVALID_CHAT_L1_PROFANITY_POLICY'); };
  if (!policy || typeof policy.version !== 'string' || !/^[a-z0-9-]{1,64}$/.test(policy.version)
    || !Array.isArray(policy.rules) || !policy.rules.length || policy.rules.length > 128) invalid();
  const ids = new Set<string>(), tokens = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule || typeof rule.id !== 'string' || !/^VI-PROF-[0-9]{3}$/.test(rule.id)
      || ids.has(rule.id) || !['bounded', 'separated', 'literal'].includes(rule.matchMode)
      || !Array.isArray(rule.tokens) || !rule.tokens.length || rule.tokens.length > 16) invalid();
    ids.add(rule.id);
    for (const token of rule.tokens) {
      if (typeof token !== 'string' || !/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}!]{0,30}[\p{L}\p{M}\p{N}]$/u.test(token) || !/\p{L}/u.test(token)
        || token !== token.normalize('NFC').toLowerCase() || tokens.has(token)) invalid();
      // Chỉ mẫu ngắn sinh lặp chữ; separated chỉ xen dấu, không lặp mỗi chữ của cụm dài.
      if (rule.matchMode === 'bounded' && !/^[\p{L}\p{M}]{2,5}$/u.test(token)) invalid();
      tokens.add(token);
    }
  }
}
