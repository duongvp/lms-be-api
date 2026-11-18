import { createHash } from 'node:crypto';
import { CHAT_JEV_MODEL, buildJevRequest } from './rubric';
import { CHAT_JEV_CATEGORIES, CHAT_JEV_SEVERITIES, freezeJevSnapshot, type JevRequest } from './types';
import { trustedJevFramework, type JevFramework } from './framework';

/** Snapshot nội bộ đã kiểm tra một lần khi reload; không nhận hướng dẫn từ payload chat. */
export type JevRuntimeRubric = Readonly<{ modelVersion: string; rubricVersion: string; questions: JevRequest['questions']; framework?: JevFramework }>;
const trusted = new WeakSet<object>();
const exact = (input: object, keys: readonly string[]) => Object.keys(input).sort().join('|') === [...keys].sort().join('|');
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 196608;

export function createJevRuntimeRubric(modelVersion: string, input: unknown, framework?: JevFramework): JevRuntimeRubric {
  const fail = (): never => { throw Error('INVALID_JEV_RUNTIME_RUBRIC'); };
  if (modelVersion !== CHAT_JEV_MODEL || !input || typeof input !== 'object' || framework && !trustedJevFramework(framework)) return fail();
  const q = JSON.parse(JSON.stringify(input)) as JevRequest['questions'];
  // Body provider tối đa 64KiB; chừa 16KiB cho context và 1KiB cho khung request.
  if (!exact(q, ['category', 'severity', 'threat', 'distress']) || Buffer.byteLength(JSON.stringify(q), 'utf8') > 47 * 1024) return fail();
  for (const [name, labels] of [['category', framework ? framework.categories.map(c => c.code) : CHAT_JEV_CATEGORIES],
    ['severity', framework ? framework.levels.map(l => l.code) : CHAT_JEV_SEVERITIES]] as const) {
    const item = q[name];
    if (!item || !exact(item, ['type', 'instructions', 'criteria']) || item.type !== 'choice' || !text(item.instructions)
      || !item.criteria || !exact(item.criteria, labels) || !Object.values(item.criteria).every(text)) return fail();
  }
  for (const name of ['threat', 'distress'] as const) {
    const item = q[name];
    if (!item || !exact(item, ['type', 'instructions']) || item.type !== 'noul' || !text(item.instructions)) return fail();
  }
  const snapshot = freezeJevSnapshot({ modelVersion, rubricVersion: 'jev-classroom-v1:'
    + createHash('sha256').update(JSON.stringify(framework ? [q, framework] : q)).digest('hex'), questions: q,
    ...(framework ? { framework } : {}) });
  trusted.add(snapshot); return snapshot;
}

// Tương thích policy cũ chưa có khóa rubric_version_id; không đọc DB hoặc tạo request HTTP.
export const BASELINE_RUNTIME_RUBRIC = createJevRuntimeRubric(CHAT_JEV_MODEL, buildJevRequest({
  message: { text: 'Khởi tạo hướng dẫn' }, classroom: { mode: 'UNKNOWN', topic: null, contextKnown: false },
  recentMessages: [], privacySignals: { contactRedacted: false, externalUrl: 'NONE' },
}).questions);

export function validJevRuntimeRubric(input: JevRuntimeRubric): boolean { return !!input && trusted.has(input); }
