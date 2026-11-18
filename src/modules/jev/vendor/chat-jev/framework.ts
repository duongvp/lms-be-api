import { createHash } from 'node:crypto';
import { z } from 'zod';
import { freezeJevSnapshot } from './types';

// Mã chỉ là định danh dữ liệu. Danh sách action/archetype là khả năng BE, không phải mã chạy từ DB.
export const JEV_ACTIONS = ['ALLOW', 'BLOCK', 'PRIVATE_NUDGE', 'TEACHER_ALERT', 'SAFETY_ALERT', 'SAFETY_SUPPORT', 'COUNT_STRIKE', 'SLOW_MODE', 'MUTE'] as const;
export const JEV_ARCHETYPES = ['VALID_SAFE', 'DISCIPLINARY_NORMAL', 'SAFETY_THREAT', 'SAFETY_DISTRESSED'] as const;
export const jevCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/);
const levelCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/);
const guide = z.string().trim().min(1).max(16000);
const category = z.object({ code: jevCode, label: guide.max(150), definition: guide,
  archetype: z.enum(JEV_ARCHETYPES), contextRequirement: z.enum(['ANY', 'LECTURE_KNOWN']),
  counterKey: jevCode.nullable(), safetySignal: z.enum(['threat', 'distress']).nullable() }).strict();
const level = z.object({ code: levelCode, label: guide.max(150), rank: z.number().int().min(0).max(255), instructions: guide }).strict();
const pair = z.object({ category: jevCode, severity: levelCode, applicable: z.boolean(), criterion: guide.nullable() }).strict();
const schema = z.object({ categories: z.array(category).min(1).max(16), levels: z.array(level).min(1).max(8),
  pairs: z.array(pair).min(1).max(128) }).strict();
export type JevFramework = Readonly<z.infer<typeof schema>>;
const trusted = new WeakSet<object>();
export const jevHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Kiểm cả tích Descartes vì category/severity được Jev chọn độc lập, không chỉ các ô "áp dụng". */
export function compileJevFramework(input: unknown): JevFramework {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw Error('INVALID_JEV_FRAMEWORK');
  const f = parsed.data;
  const fail = (): never => { throw Error('INVALID_JEV_FRAMEWORK'); };
  if (new Set(f.categories.map(c => c.code)).size !== f.categories.length
    || new Set(f.levels.map(l => l.code)).size !== f.levels.length
    || new Set(f.levels.map(l => l.rank)).size !== f.levels.length
    || f.pairs.length !== f.categories.length * f.levels.length) return fail();
  const pairs = new Set<string>();
  for (const p of f.pairs) {
    const key = p.category + ':' + p.severity;
    if (pairs.has(key) || !f.categories.some(c => c.code === p.category) || !f.levels.some(l => l.code === p.severity)
      || p.applicable && p.criterion === null || !p.applicable && p.criterion !== null) return fail();
    pairs.add(key);
  }
  for (const c of f.categories) {
    if (!f.pairs.some(p => p.category === c.code && p.applicable)
      || c.archetype !== 'DISCIPLINARY_NORMAL' && c.counterKey !== null
      || c.safetySignal !== null && c.archetype !== (c.safetySignal === 'threat' ? 'SAFETY_THREAT' : 'SAFETY_DISTRESSED')) return fail();
  }
  if (!f.categories.some(c => c.archetype === 'VALID_SAFE')) return fail();
  for (const signal of ['threat', 'distress'] as const) {
    if (f.categories.filter(c => c.safetySignal === signal).length !== 1) return fail();
  }
  const canonical = freezeJevSnapshot({ categories: [...f.categories].sort((a, b) => a.code.localeCompare(b.code)),
    levels: [...f.levels].sort((a, b) => a.rank - b.rank),
    pairs: [...f.pairs].sort((a, b) => (a.category + ':' + a.severity).localeCompare(b.category + ':' + b.severity)) });
  trusted.add(canonical); return canonical;
}
export const trustedJevFramework = (f: JevFramework) => !!f && trusted.has(f);

/** Đổi tên mã/ý nghĩa counter đang tồn tại không được âm thầm gộp hoặc xóa lịch sử. */
export function assertJevFrameworkCompatible(before: JevFramework, after: JevFramework) {
  for (const old of before.categories) {
    const next = after.categories.find(c => c.code === old.code);
    if (next && (old.archetype !== next.archetype || old.counterKey !== next.counterKey
      || old.contextRequirement !== next.contextRequirement || old.safetySignal !== next.safetySignal)) {
      throw Error('JEV_FRAMEWORK_IDENTITY_CONFLICT');
    }
  }
}
