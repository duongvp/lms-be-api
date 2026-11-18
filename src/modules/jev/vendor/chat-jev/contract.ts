import { z } from 'zod';
import { CHAT_JEV_CATEGORIES, CHAT_JEV_SEVERITIES, freezeJevSnapshot } from './types';
import type { JevCategory, JevChoice, JevOutcome, JevSeverity, JevResponseDiagnostic } from './types';
import { trustedJevFramework, type JevFramework } from './framework';

const probability = z.number().finite().min(0).max(1);

function choiceSchema<T extends readonly [string, ...string[]]>(options: T) {
  const shape = Object.fromEntries(options.map(option => [option, probability]));
  return z.object({
    type: z.literal('choice'), choice: z.enum(options), confidence: probability,
    probabilities: z.object(shape).strict(),
  }).strict().superRefine((answer, ctx) => {
    const values = answer.probabilities as Record<string, number>;
    const selected = answer.choice;
    if (typeof selected !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_CHOICE' }); return;
    }
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    // Sai số chỉ dành cho phép cộng float; nhãn chọn vẫn phải thuộc cực đại, kể cả hòa điểm.
    if (Math.abs(total - 1) > 0.001 || values[selected] + 1e-9 < Math.max(...Object.values(values))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_DISTRIBUTION' });
    }
  });
}

const noul = z.object({ type: z.literal('noul'), noul: probability }).strict();
const responseSchema = z.object({
  model: z.string().min(1).max(100),
  answers: z.object({
    category: choiceSchema(CHAT_JEV_CATEGORIES), severity: choiceSchema(CHAT_JEV_SEVERITIES),
    threat: noul, distress: noul,
  }).strict(),
  usage: z.object({ input_tokens: z.number().int().nonnegative().safe(), output_tokens: z.number().int().nonnegative().safe() }),
});

const diagnosticCodes = ['MISSING_FIELD', 'INVALID_TYPE', 'UNKNOWN_LABEL', 'OUT_OF_RANGE',
  'INVALID_DISTRIBUTION', 'UNEXPECTED_FIELD', 'INVALID_VALUE', 'MODEL_MISMATCH', 'RESPONSE_TOO_LARGE', 'UNSERIALIZABLE_RESPONSE'] as const;
const diagnosticPaths = ['response', 'model', 'answers', 'usage', 'usage.input_tokens', 'usage.output_tokens',
  ...['category', 'severity'].flatMap(name => [`answers.${name}`, ...['type', 'choice', 'confidence', 'probabilities'].map(field => `answers.${name}.${field}`)]),
  ...['threat', 'distress'].flatMap(name => [`answers.${name}`, `answers.${name}.type`, `answers.${name}.noul`])];
const diagnosticSchema = z.object({ code: z.enum(diagnosticCodes),
  path: z.string().refine(value => diagnosticPaths.includes(value)) }).strict();

/** Chiếu lại tại ranh giới log: bỏ extras/giá trị lạ, chống biến diagnostics thành kênh ghi dữ liệu riêng tư. */
export function projectJevDiagnostics(input: unknown): readonly JevResponseDiagnostic[] {
  if (!Array.isArray(input)) return [];
  const result: JevResponseDiagnostic[] = [];
  for (const entry of input.slice(0, 32)) {
    const parsed = diagnosticSchema.safeParse(entry);
    if (parsed.success && !result.some(old => old.code === parsed.data.code && old.path === parsed.data.path)) {
      result.push({ code: parsed.data.code!, path: parsed.data.path! });
    }
    if (result.length === 8) break;
  }
  return result;
}

/** Không trả ZodIssue/message/expected/received: unknown key hoặc enum value có thể do provider nhét vào. */
function diagnosticsFromIssues(issues: readonly z.ZodIssue[]): readonly JevResponseDiagnostic[] {
  return projectJevDiagnostics(issues.slice(0, 32).map(issue => {
    const parts = issue.path.map(String);
    while (parts.length && !diagnosticPaths.includes(parts.join('.'))) parts.pop();
    const code: JevResponseDiagnostic['code'] = issue.code === 'invalid_type'
      ? issue.received === 'undefined' ? 'MISSING_FIELD' : 'INVALID_TYPE'
      : issue.code === 'unrecognized_keys' ? 'UNEXPECTED_FIELD'
      : issue.code === 'invalid_enum_value' ? 'UNKNOWN_LABEL'
      : issue.code === 'too_small' || issue.code === 'too_big' ? 'OUT_OF_RANGE'
      : issue.code === 'custom' && issue.message === 'INVALID_DISTRIBUTION' ? 'INVALID_DISTRIBUTION' : 'INVALID_VALUE';
    return { code, path: parts.join('.') || 'response' };
  }));
}

const independentSafetySchema = z.object({ modelVersion: z.string(), rubricVersion: z.string(),
  threat: probability.optional(), distress: probability.optional() }).strict()
  .refine(value => value.threat !== undefined || value.distress !== undefined);

/** Chỉ cứu tín hiệu từ response INVALID_RESPONSE đã gắn đúng model/rubric; timeout/mismatch không được tái dùng số cũ. */
export function readJevSafetySignals(outcome: JevOutcome, expectedModel: string, rubricVersion: string) {
  const input = outcome.status === 'ASSESSED'
    ? { modelVersion: outcome.modelVersion, rubricVersion: outcome.rubricVersion,
      threat: outcome.assessment.threat, distress: outcome.assessment.distress }
    : outcome.reason === 'INVALID_RESPONSE' ? outcome.independentSafety : undefined;
  const parsed = independentSafetySchema.safeParse(input);
  if (!parsed.success || parsed.data.modelVersion !== expectedModel || parsed.data.rubricVersion !== rubricVersion) return null;
  return { modelVersion: expectedModel, rubricVersion,
    ...(parsed.data.threat !== undefined ? { threat: parsed.data.threat } : {}),
    ...(parsed.data.distress !== undefined ? { distress: parsed.data.distress } : {}) };
}

/** Chỉ đọc envelope/model và từng câu Noul đúng schema; category/usage hỏng không làm mất câu an toàn còn hợp lệ. */
function extractIndependentSafety(raw: unknown, expectedModel: string, rubricVersion: string) {
  const envelope = z.object({ model: z.literal(expectedModel), answers: z.object({}).passthrough() }).safeParse(raw);
  if (!envelope.success) return undefined;
  const threat = noul.safeParse(envelope.data.answers.threat), distress = noul.safeParse(envelope.data.answers.distress);
  if (!threat.success && !distress.success) return undefined;
  return { modelVersion: expectedModel, rubricVersion,
    ...(threat.success ? { threat: threat.data.noul } : {}), ...(distress.success ? { distress: distress.data.noul } : {}) };
}

/** Chỉ metadata lỗi hữu hạn thoát ra ngoài; không ném ZodError chứa nội dung provider vào log. */
export function parseJevResponse(raw: unknown, expectedModel: string, rubricVersion: string, framework?: JevFramework): JevOutcome {
  // Chỉ snapshot do compiler tạo mới được định nghĩa tập nhãn; payload provider không tự khai báo schema.
  if (framework && !trustedJevFramework(framework)) return { status: 'UNASSESSED', reason: 'INVALID_REQUEST' };
  const activeSchema = framework ? responseSchema.extend({ answers: z.object({
    category: choiceSchema(framework.categories.map(c => c.code) as [string, ...string[]]),
    severity: choiceSchema(framework.levels.map(l => l.code) as [string, ...string[]]), threat: noul, distress: noul }).strict() }) : responseSchema;
  const parsed = activeSchema.safeParse(raw);
  if (!parsed.success) {
    const independentSafety = extractIndependentSafety(raw, expectedModel, rubricVersion);
    return freezeJevSnapshot({ status: 'UNASSESSED', reason: 'INVALID_RESPONSE', diagnostics: diagnosticsFromIssues(parsed.error.issues),
      ...(independentSafety ? { independentSafety } : {}) });
  }
  const body = parsed.data;
  if (body.model !== expectedModel) return freezeJevSnapshot({ status: 'UNASSESSED', reason: 'MODEL_MISMATCH',
    diagnostics: [{ code: 'MODEL_MISMATCH', path: 'model' }] });
  const category = body.answers.category;
  const severity = body.answers.severity;
  // Shape được kiểm đầy đủ ở schema; Record cast bù việc z.object động không giữ literal key trong TS.
  const categoryResult: JevChoice<JevCategory> = { choice: category.choice, confidence: category.confidence,
    probabilities: category.probabilities as Record<JevCategory, number> };
  const severityResult: JevChoice<JevSeverity> = { choice: severity.choice, confidence: severity.confidence,
    probabilities: severity.probabilities as Record<JevSeverity, number> };
  return freezeJevSnapshot({ status: 'ASSESSED' as const, modelVersion: body.model, rubricVersion,
    assessment: { category: categoryResult, severity: severityResult,
      threat: body.answers.threat.noul, distress: body.answers.distress.noul },
    usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens } });
}
