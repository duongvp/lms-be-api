import { createHmac } from 'node:crypto';

/** Mã giả danh theo buổi, không phải danh tính thật hoặc số lần bị phạt. */
export function jevActor(secret: string, calendarId: number, role: 'student' | 'teacher', senderId: string): string {
  return 'a_' + createHmac('sha256', secret)
    .update(JSON.stringify(['jev-actor-v1', calendarId, role, senderId])).digest('hex').slice(0, 32);
}

// Cửa sổ ngữ cảnh hữu hạn; ageMs là tuổi tin so với tin đang đánh giá, không phải giờ máy học sinh.
export const JEV_CONTEXT_WINDOW_MS = 5 * 60 * 1000;
export const JEV_ACTOR_PATTERN = /^a_[a-f0-9]{32}$/;
