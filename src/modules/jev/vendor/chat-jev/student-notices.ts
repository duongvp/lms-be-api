import type { JevCategory } from './types';

export type JevStudentNotice = Readonly<{ action: 'BLOCK' | 'PRIVATE_NUDGE'; text: string; source: 'policy' | 'default' }>;

/** Mẫu tĩnh của BE: không chèn lại tin gốc, tên học sinh hoặc nội dung do model sinh.
 * Null trong DB dùng mẫu này; không áp cho ALLOW, cảnh báo GV hoặc luồng an toàn. */
export function defaultJevStudentMessage(category: JevCategory, action: string): string | null {
  if (action !== 'BLOCK' && action !== 'PRIVATE_NUDGE') return null;
  switch (category) {
    case 'OFF_TOPIC': return action === 'PRIVATE_NUDGE'
      ? 'Em tập trung trao đổi nội dung bài học nhé.'
      : 'Tin nhắn chưa phù hợp với nội dung buổi học. Em chỉnh lại rồi gửi nhé.';
    case 'SPAM_DISRUPTION': return 'Em tránh gửi lặp hoặc liên tục để cả lớp dễ theo dõi nhé.';
    case 'ABUSE_BULLYING': return 'Em dùng lời nói tôn trọng và thân thiện khi trao đổi nhé.';
    case 'PII_EXTERNAL': return 'Em kiểm tra và bỏ thông tin riêng tư hoặc liên kết chưa được phép trước khi gửi nhé.';
    default: return null;
  }
}
