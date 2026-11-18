import type { ChatL1Input } from './types';

// FE maxLength và sanitizer cũ đều đếm UTF-16 code unit, không phải grapheme.
export const CHAT_L1_MAX_CODE_UNITS = 500;
export const CHAT_L1_MAX_UTF8_BYTES = 2000;

/** Chỉ kiểm tra, không ép kiểu hoặc cắt/sửa câu học sinh trước khi đánh giá. */
export function inspectChatL1Input(value: unknown): ChatL1Input {
  if (typeof value !== 'string') return { valid: false, reason: 'INVALID_TYPE' };
  // Chặn kích thước trước trim, byteLength hoặc normalize để giới hạn CPU/RAM.
  if (value.length > CHAT_L1_MAX_CODE_UNITS) return { valid: false, reason: 'TOO_LONG' };
  if (!value.trim()) return { valid: false, reason: 'EMPTY' };
  const utf8Bytes = Buffer.byteLength(value, 'utf8');
  if (utf8Bytes > CHAT_L1_MAX_UTF8_BYTES) return { valid: false, reason: 'TOO_LONG' };
  return { valid: true, raw: value, codeUnitLength: value.length, utf8Bytes };
}
