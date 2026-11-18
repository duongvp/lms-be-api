import { z } from 'zod';
import { compileJevShadowPolicy, type JevShadowPolicy } from './shadow-policy';
import { createJevRuntimeRubric, type JevRuntimeRubric } from './runtime-rubric';
import { compileJevFramework, jevHash } from './framework';
import { CHAT_JEV_CATEGORIES, CHAT_JEV_SEVERITIES, freezeJevSnapshot, type JevRequest } from './types';

const guide = z.object({ modelVersion: z.string(), questions: z.unknown(), framework: z.unknown().optional() }).strict();
const bundle = z.object({ schemaVersion: z.literal(1), policy: z.unknown(), rubric: guide,
  // Metadata chỉ để đối soát chuyển đổi; không bao giờ đưa vào request provider.
  migration: z.object({ sourcePolicyId: z.number().int().positive().optional(), sourceRubricId: z.number().int().positive().optional(),
    guideOnly: z.boolean().optional(), legacySource: z.unknown().optional() }).strict().optional() }).strict();
export type JevCompactBundle = z.infer<typeof bundle>;
const hashes = new WeakMap<object, string>();
export const jevBundleHash = (policy: JevShadowPolicy) => hashes.get(policy) ?? null;

/** JSON chỉ là dữ liệu đầu vào: luôn compile lại để tạo trusted framework/snapshot nội bộ. */
export function compileJevCompactBundle(input: unknown) {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > 640 * 1024) throw Error('JEV_BUNDLE_TOO_LARGE');
  const value = bundle.parse(input);
  if (value.migration?.guideOnly || value.migration?.legacySource !== undefined) throw Error('JEV_INCOMPLETE_MIGRATED_DRAFT');
  const framework = value.rubric.framework === undefined ? undefined : compileJevFramework(value.rubric.framework);
  // MySQL JSON không giữ thứ tự key. Dựng lại đúng thứ tự request nguồn trước khi hash.
  const q = value.rubric.questions as JevRequest['questions'];
  const orderedChoice = (item: JevRequest['questions']['category'], labels: readonly string[]) => {
    if (!item || Object.keys(item).sort().join() !== 'criteria,instructions,type'
      || !item.criteria || Object.keys(item.criteria).sort().join() !== [...labels].sort().join()) throw Error('INVALID_JEV_RUNTIME_RUBRIC');
    return { type: item.type, instructions: item.instructions, criteria: Object.fromEntries(labels.map(k => [k, item.criteria[k]])) };
  };
  if (!q || Object.keys(q).sort().join() !== 'category,distress,severity,threat') throw Error('INVALID_JEV_RUNTIME_RUBRIC');
  const rubric = createJevRuntimeRubric(value.rubric.modelVersion, {
    category: orderedChoice(q.category, framework?.categories.map(c => c.code) ?? CHAT_JEV_CATEGORIES),
    severity: orderedChoice(q.severity, framework?.levels.map(l => l.code) ?? CHAT_JEV_SEVERITIES),
    threat: { type: q.threat?.type, instructions: q.threat?.instructions }, distress: { type: q.distress?.type, instructions: q.distress?.instructions },
  }, framework);
  for (const key of ['threat', 'distress'] as const) if (!q[key] || Object.keys(q[key]).sort().join() !== 'instructions,type') throw Error('INVALID_JEV_RUNTIME_RUBRIC');
  const raw = value.policy as JevShadowPolicy;
  const policy = compileJevShadowPolicy(raw?.schemaVersion === 3 ? raw : { ...raw,
    rules: raw?.rules?.map(r => ({ ...r, gates: Object.fromEntries(Object.entries(r.gates).sort(([a], [b]) => a.localeCompare(b))) })) });
  if (policy.modelVersion !== rubric.modelVersion || policy.rubricVersion !== rubric.rubricVersion
    || jevHash(policy.framework ?? null) !== jevHash(framework ?? null)) throw Error('JEV_BUNDLE_RUBRIC_MISMATCH');
  const config = freezeJevSnapshot({ schemaVersion: 1 as const, policy,
    rubric: { modelVersion: rubric.modelVersion, questions: rubric.questions, ...(framework ? { framework } : {}) },
    ...(value.migration ? { migration: value.migration } : {}) });
  const bundleHash = jevHash(config); hashes.set(policy, bundleHash);
  return Object.freeze({ config, policy, rubric, hash: jevHash(policy), rubricHash: rubric.rubricVersion, bundleHash });
}

export function createJevCompactBundle(policy: JevShadowPolicy, rubric: JevRuntimeRubric) {
  return compileJevCompactBundle({ schemaVersion: 1, policy,
    rubric: { modelVersion: rubric.modelVersion, questions: rubric.questions,
      ...(rubric.framework ? { framework: rubric.framework } : {}) } });
}

/** Draft cho phép đang soạn dở; publish/bind chỉ nhận compileJevCompactBundle thành công. */
export function validateJevCompactDraft(input: unknown) {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > 640 * 1024) throw Error('JEV_BUNDLE_TOO_LARGE');
  return bundle.parse(input);
}
