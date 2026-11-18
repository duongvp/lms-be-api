import { compileJevFramework } from './vendor/chat-jev/framework';
import { createJevRuntimeRubric } from './vendor/chat-jev/runtime-rubric';
import { CHAT_JEV_CATEGORIES, CHAT_JEV_SEVERITIES } from './vendor/chat-jev/types';

/** A guide edit needs a matching rubric hash. Drafts may remain incomplete. */
export function prepareJevDraft(input: unknown, policyKey: string, revision: number) {
  const value = JSON.parse(JSON.stringify(input)) as any;
  if (!value || typeof value !== 'object' || !value.policy || typeof value.policy !== 'object') return input;
  value.policy.version = `${policyKey}:r${revision}`;
  try {
    const framework = value.rubric.framework === undefined ? undefined : compileJevFramework(value.rubric.framework);
    const q = value.rubric.questions;
    const orderedChoice = (item: any, labels: readonly string[]) => {
      if (Object.keys(item).sort().join() !== 'criteria,instructions,type' || Object.keys(item.criteria).sort().join() !== [...labels].sort().join()) throw Error();
      return { type: item.type, instructions: item.instructions, criteria: Object.fromEntries(labels.map(k => [k, item.criteria[k]])) };
    };
    const questions = { category: orderedChoice(q.category, framework?.categories.map(c => c.code) ?? CHAT_JEV_CATEGORIES),
      severity: orderedChoice(q.severity, framework?.levels.map(l => l.code) ?? CHAT_JEV_SEVERITIES), threat: { type: q.threat?.type, instructions: q.threat?.instructions }, distress: { type: q.distress?.type, instructions: q.distress?.instructions } };
    const rubric = createJevRuntimeRubric(value.rubric.modelVersion, questions, framework);
    value.policy.rubricVersion = rubric.rubricVersion;
  } catch { /* Keep an incomplete guide in DRAFT; the compiler must reject it at validation/publish. */ }
  return value;
}
