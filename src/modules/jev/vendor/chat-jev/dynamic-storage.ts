import { z } from 'zod';
import { compileJevFramework, jevHash } from './framework';
import { createJevRuntimeRubric } from './runtime-rubric';
const instructions = z.string().trim().min(1).max(16000);
const definitionSchema = z.object({ model_version: z.string().regex(/^jev-\d+\.\d+\.\d+$/), common_instructions: z.string().max(16000),
    category_instructions: instructions, severity_instructions: instructions, threat_instructions: instructions,
    distress_instructions: instructions, framework: z.unknown() }).strict();
export type JevDynamicRubricDefinition = z.infer<typeof definitionSchema>;
const fail = (): never => { throw Error('INVALID_JEV_DYNAMIC_STORAGE'); };
/** Cùng khung tạo cả criteria provider và descriptor kiểm response; không đoán nhãn từ response. */
export function compileDynamicJevRubric(input: unknown) {
    const parsed = definitionSchema.safeParse(input);
    if (!parsed.success)
        return fail();
    const f = compileJevFramework(parsed.data.framework), d = { ...parsed.data, framework: f };
    const guide = (specific: string) => d.common_instructions ? d.common_instructions + '\n\n' + specific : specific;
    const questions = {
        category: { type: 'choice' as const, instructions: guide(d.category_instructions), criteria: Object.fromEntries(f.categories.map(c => [c.code,
                [c.definition, ...f.pairs.filter(p => p.category === c.code && p.applicable).map(p => p.severity + ': ' + p.criterion)].join('\n')])) },
        severity: { type: 'choice' as const, instructions: guide(d.severity_instructions), criteria: Object.fromEntries(f.levels.map(l => [l.code, l.instructions])) },
        threat: { type: 'noul' as const, instructions: guide(d.threat_instructions) },
        distress: { type: 'noul' as const, instructions: guide(d.distress_instructions) },
    };
    const runtime = createJevRuntimeRubric(d.model_version!, questions, f);
    return { definition: d, framework: f, questions, runtime, rubricVersion: runtime.rubricVersion, contentHash: jevHash(d), runtimeLabelsCompatible: true };
}
