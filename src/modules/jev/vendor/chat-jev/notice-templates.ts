import { z } from 'zod';

/** Mẫu là text thuần; không chạy HTML, script hay nội suy tin gốc từ học sinh. */
const plain = z.string().min(1).max(512).refine(s => s.trim() === s && !/[<>{}\p{Cc}\p{Cf}]/u.test(s));
export const jevNoticeTemplateSchema = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  audience: z.enum(['student', 'teacher']), kind: z.enum(['NUDGE', 'ALERT', 'SAFETY']),
  body: plain, guidance: plain.optional() }).strict().refine(t => t.guidance === undefined || t.kind === 'SAFETY');
export type JevNoticeTemplate = Readonly<z.infer<typeof jevNoticeTemplateSchema>>;
