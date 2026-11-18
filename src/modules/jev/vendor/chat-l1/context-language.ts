// Nhóm B chỉ tạo tín hiệu NEEDS_CONTEXT; không whitelist tin hoặc đánh giá mức vi phạm.
export const CHAT_L1_CONTEXT_TERMS = Object.freeze([
  'lon', 'buoi', 'dit', 'du', 'cu', 'con lon', 'du ma', 'oc cho',
  'ngu', 'dốt', 'ngv', 'béo', 'chó', 'bò', 'lợn', 'óc chó', 'súc vật',
  'bố mày', 'mẹ mày', 'câm mồm', 'ngu như bò', 'ngu như lợn', 'ngu vãi', 'ngu vl',
  'vãi chưởng', 'vãi nồi', 'vãi cả', 'lú vãi', 'củ chuối', 'ảo ma',
  'vcc', 'vch', 'chết', 'giết', 'tự tử', 'sinh dục',
  'thụ tinh', 'máu', 'rạch tay', 'đánh nhau', 'ngộp thở', 'đau ngực', 'chóng mặt',
  'muốn xỉu', 'ngất', 'fuck', 'f*ck', 'bitch', 'c*c', 'đ m', 'n-g-u', 'n.g.u',
]);
const escapeLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contextPattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${CHAT_L1_CONTEXT_TERMS
  .map(escapeLiteral).join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'u');

/** Danh mục literal hữu hạn, không nhận regex từ cấu hình người dùng hoặc gọi Jev. */
export const hasContextLanguage = (text: string): boolean => contextPattern.test(text);
