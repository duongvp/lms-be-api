import { z } from 'zod';
import { freezeJevSnapshot } from './types';
import type { JevState } from './types';
import { JEV_ACTOR_PATTERN, JEV_CONTEXT_WINDOW_MS } from './actor';

export const JEV_CONTEXT_MAX_MESSAGES = 10;
// Chat thật giữ mặc định ổn định; Lab bật trần thử riêng qua tham số BE tin cậy.
export const JEV_CONTEXT_DEFAULT_MESSAGES = 5;
export const JEV_CONTEXT_MAX_BYTES = 16 * 1024;

const role = z.enum(['student', 'teacher']);
const actor = z.string().regex(JEV_ACTOR_PATTERN);
const ageMs = z.number().int().min(0).max(JEV_CONTEXT_WINDOW_MS);
const entryShape = z.object({ role, text: z.string().min(1).max(500), actor: actor.optional(), ageMs: ageMs.optional() });
const entry = entryShape.refine(value => (value.actor === undefined) === (value.ageMs === undefined));
const message = z.object({ text: z.string().min(1).max(500), role: role.optional(), actor: actor.optional(), ageMs: z.literal(0).optional() })
  .strict().refine(value => [value.role, value.actor, value.ageMs].every(item => item === undefined)
    || [value.role, value.actor, value.ageMs].every(item => item !== undefined));
const inputSchema = z.object({
  text: z.string().max(500).refine(text => text.trim().length > 0),
  mode: z.enum(['LOBBY', 'LECTURE', 'UNKNOWN']), topic: z.string().max(1000).nullable(),
  recentMessages: z.array(z.unknown()).max(100).optional(),
  role: role.optional(), actor: actor.optional(), ageMs: z.literal(0).optional(),
}).refine(value => [value.role, value.actor, value.ageMs].every(item => item === undefined)
  || [value.role, value.actor, value.ageMs].every(item => item !== undefined));
const secretPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bapikey_[A-Za-z0-9_-]{10,}/;
const stateSchema = z.object({
  message,
  classroom: z.object({ mode: z.enum(['LOBBY', 'LECTURE', 'UNKNOWN']), topic: z.string().max(1000).nullable(), contextKnown: z.boolean() }).strict(),
  recentMessages: z.array(entryShape.strict().refine(value => (value.actor === undefined) === (value.ageMs === undefined))).max(JEV_CONTEXT_MAX_MESSAGES),
  privacySignals: z.object({ contactRedacted: z.boolean(), externalUrl: z.enum(['NONE', 'PRESENT']) }).strict(),
}).strict();
export type JevContextResult = Readonly<{ status: 'READY'; state: JevState }>
  | Readonly<{ status: 'SKIPPED'; reason: 'INVALID_CONTEXT' }>;

/** Đây là giảm dữ liệu, không phải cam kết ẩn hết PII; dữ liệu thật vẫn cần duyệt riêng. */
function redact(text: string, signals: { contactRedacted: boolean; externalUrl: 'NONE' | 'PRESENT' }): string {
  return text
    .replace(/https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/gi, () => { signals.externalUrl = 'PRESENT'; return '[URL_REDACTED]'; })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => { signals.contactRedacted = true; return '[CONTACT_REDACTED]'; })
    .replace(/(?<![\p{L}\p{N}])(?:\+?84|0)[\d .()-]{8,17}\d(?![\p{L}\p{N}])/gu,
      () => { signals.contactRedacted = true; return '[CONTACT_REDACTED]'; });
}

/** Caller chịu trách nhiệm scope/role xác thực; hàm thuần chỉ chiếu whitelist field và giới hạn context. */
export function buildJevContext(input: unknown, options: Readonly<{ maxMessages?: 5 | 10 }> = {}): JevContextResult {
  // Tham số chỉ do BE/công cụ thử truyền, không đọc giới hạn từ payload học sinh.
  const maxMessages = options.maxMessages ?? JEV_CONTEXT_DEFAULT_MESSAGES;
  if (maxMessages !== 5 && maxMessages !== 10) return { status: 'SKIPPED', reason: 'INVALID_CONTEXT' };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: 'SKIPPED', reason: 'INVALID_CONTEXT' };
  const source = parsed.data;
  if (secretPattern.test(source.text) || source.topic && secretPattern.test(source.topic)) {
    return { status: 'SKIPPED', reason: 'INVALID_CONTEXT' };
  }
  const candidates: Array<z.infer<typeof entry>> = [];
  for (const candidate of source.recentMessages ?? []) {
    const checked = entry.safeParse(candidate);
    if (!checked.success || !checked.data.text.trim() || secretPattern.test(checked.data.text)) continue;
    candidates.push(checked.data);
  }
  // Sắp trước khi chọn tin mới nhất; fixture thiếu thời gian giữ thứ tự đầu vào, không đoán tuổi tin.
  if (candidates.every(item => item.ageMs !== undefined)) candidates.sort((a, b) => b.ageMs! - a.ageMs!);
  const selected = candidates.slice(-maxMessages);
  for (;;) {
    // Dựng lại tín hiệu theo các tin thực sự được giữ: tin đã bỏ không tạo cờ PII hoặc contextKnown giả.
    const signals = { contactRedacted: false, externalUrl: 'NONE' as 'NONE' | 'PRESENT' };
    const topic = source.topic?.trim() ? redact(source.topic.trim(), signals) : null;
    const current = redact(source.text, signals);
    const recentMessages = selected.map(candidate => ({ role: candidate.role, text: redact(candidate.text, signals),
      ...(candidate.actor !== undefined ? { actor: candidate.actor, ageMs: candidate.ageMs } : {}) }));
    const state: JevState = { message: { text: current,
      ...(source.actor !== undefined ? { actor: source.actor, role: source.role, ageMs: 0 } : {}) },
      // Hội thoại HS không tự xác lập hoạt động chính thức; chỉ xét topic BE và tin GV còn trong snapshot.
      classroom: { mode: source.mode, topic, contextKnown: topic !== null || recentMessages.some(item => item.role === 'teacher') },
      recentMessages, privacySignals: signals };
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') <= JEV_CONTEXT_MAX_BYTES) {
      return { status: 'READY', state: freezeJevSnapshot(state) };
    }
    // Bỏ nguyên tin cũ nhất, không cắt chữ làm mất phủ định/trích dẫn và không sửa tin hiện tại.
    if (!selected.length) return { status: 'SKIPPED', reason: 'INVALID_CONTEXT' };
    selected.shift();
  }
}

/** Kiểm tra lại tại biên HTTP: type TS không ngăn caller JS truyền thêm token/identity vào state. */
export function sanitizeJevState(input: unknown): JevState | null {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return null;
  const source = parsed.data;
  const rebuilt = buildJevContext({ text: source.message.text, mode: source.classroom.mode,
    topic: source.classroom.topic, recentMessages: source.recentMessages,
    ...(source.message.actor !== undefined ? { actor: source.message.actor, role: source.message.role, ageMs: 0 } : {}) },
    // Biên HTTP kiểm snapshot đã chốt; không âm thầm cắt bản 10 tin của Lab về mặc định 5.
    { maxMessages: JEV_CONTEXT_MAX_MESSAGES });
  if (rebuilt.status !== 'READY') return null;
  // ContextKnown từ caller chỉ có thể thu hẹp: không biến một snapshot thiếu context thành đủ căn cứ.
  return freezeJevSnapshot({ ...rebuilt.state,
    classroom: { ...rebuilt.state.classroom, contextKnown: rebuilt.state.classroom.contextKnown && source.classroom.contextKnown },
    privacySignals: { contactRedacted: rebuilt.state.privacySignals.contactRedacted || source.privacySignals.contactRedacted,
      externalUrl: rebuilt.state.privacySignals.externalUrl === 'PRESENT' || source.privacySignals.externalUrl === 'PRESENT' ? 'PRESENT' : 'NONE' } });
}

/** Thay đúng phần lịch sử bằng snapshot chung; giữ tin hiện tại/actor và hướng dẫn đã ghim.
 * Dùng text gốc từ BE để chạy lại cùng bộ giảm dữ liệu, không lấy text hiện tại từ cache. */
export function withJevRecentMessages(state: JevState, text: unknown, recentMessages: readonly JevRecentInput[]): JevState | null {
  const result = buildJevContext({ text, mode: state.classroom.mode, topic: state.classroom.topic,
    role: state.message.role, actor: state.message.actor, ageMs: state.message.ageMs, recentMessages });
  if (result.status !== 'READY' || result.state.message.text !== state.message.text) return null;
  return freezeJevSnapshot({ ...result.state, privacySignals: {
    contactRedacted: result.state.privacySignals.contactRedacted || state.privacySignals.contactRedacted,
    externalUrl: result.state.privacySignals.externalUrl === 'PRESENT' || state.privacySignals.externalUrl === 'PRESENT' ? 'PRESENT' : 'NONE',
  } });
}
type JevRecentInput = { role: 'student' | 'teacher'; text: string; actor: string; ageMs: number };
