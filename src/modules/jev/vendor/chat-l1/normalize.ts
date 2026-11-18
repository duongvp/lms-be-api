import type { ChatL1ValidInput } from './types';

export type ChatL1Normalized = Readonly<{
  raw: string;
  nfc: string;
  matchText: string;
  repeatText: string;
  features: Readonly<{
    maxRepeatedRun: number;
    lineCount: number;
    letterCount: number;
    digitCount: number;
  }>;
}>;

/** Chỉ gọi sau input inspection; raw và các bản phụ không thay câu phát ra. */
export function normalizeChatL1(input: ChatL1ValidInput): ChatL1Normalized {
  const raw = input.raw;
  let maxRepeatedRun = 0, currentRun = 0, previous = '';
  let letterCount = 0, digitCount = 0;
  // Đo trên raw trước thu gọn; dùng code point để không tách đôi emoji surrogate.
  for (const character of raw) {
    currentRun = character === previous ? currentRun + 1 : 1;
    maxRepeatedRun = Math.max(maxRepeatedRun, currentRun);
    previous = character;
    if (/\p{L}/u.test(character)) letterCount++;
    if (/\p{Nd}/u.test(character)) digitCount++;
  }
  const nfc = raw.normalize('NFC');
  return Object.freeze({
    raw,
    nfc,
    // Chỉ gỡ ký tự ẩn đã duyệt và đổi ASCII full-width trên bản so khớp.
    // Không NFKC toàn câu/bỏ dấu; giữ ZWJ/ZWNJ và bản gốc để không phá emoji/học liệu.
    matchText: nfc.replace(/[\u00AD\u200B\u2060\uFEFF]/gu, '')
      .replace(/[\uFF01-\uFF5E]/gu, character => String.fromCharCode(character.charCodeAt(0) - 0xFEE0)).toLowerCase(),
    // Bản so lặp giữ hoa/thường và dấu; không dùng bản bỏ dấu để gộp hai câu.
    repeatText: nfc.trim().replace(/\s+/gu, ' '),
    features: Object.freeze({ maxRepeatedRun, lineCount: 1 + (raw.match(/\r\n|\r|\n/g) || []).length,
      letterCount, digitCount }),
  });
}
