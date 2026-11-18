/** Kết quả phân loại không phải lệnh phạt; core không phụ thuộc Prisma/socket/ban service. */
export const CHAT_JEV_CATEGORIES = Object.freeze([
  'VALID', 'OFF_TOPIC', 'SPAM_DISRUPTION', 'ABUSE_BULLYING',
  'PII_EXTERNAL', 'SAFETY_THREAT', 'SAFETY_DISTRESSED',
] as const);
export const CHAT_JEV_SEVERITIES = Object.freeze(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const);
// V3 dùng mã động; ranh giới runtime vẫn kiểm membership theo snapshot đã tin cậy.
// Không dùng kiểu string này để nhận thẳng nhãn từ provider hoặc payload FE.
export type JevCategory = string;
export type JevSeverity = string;
export type JevMode = 'LOBBY' | 'LECTURE' | 'UNKNOWN';

/** Metadata tùy chọn để đọc được fixture cũ; runtime mới luôn cấp đủ từ danh tính/thời gian BE. */
export type JevMessage = Readonly<{ text: string; role?: 'student' | 'teacher'; actor?: string; ageMs?: number }>;

export type JevState = Readonly<{
  message: JevMessage;
  classroom: Readonly<{ mode: JevMode; topic: string | null; contextKnown: boolean }>;
  recentMessages: readonly (JevMessage & Readonly<{ role: 'student' | 'teacher' }>)[];
  privacySignals: Readonly<{ contactRedacted: boolean; externalUrl: 'NONE' | 'PRESENT' }>;
}>;
export type JevChoice<T extends string> = Readonly<{
  choice: T; confidence: number; probabilities: Readonly<Record<T, number>>;
}>;
export type JevAssessment = Readonly<{
  category: JevChoice<JevCategory>;
  severity: JevChoice<JevSeverity>;
  threat: number;
  distress: number;
}>;
export type JevFailureReason = 'INVALID_RESPONSE' | 'MODEL_MISMATCH' | 'INVALID_CONTEXT'
  | 'DISABLED' | 'NOT_APPROVED' | 'INVALID_REQUEST' | 'DEADLINE_EXCEEDED' | 'ABORTED'
  | 'TIMEOUT' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'OVERLOADED' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'QUOTA_SKIPPED' | 'CIRCUIT_OPEN';
/** Chỉ mã/path hữu hạn do BE sinh; tuyệt đối không chứa message/value/unknown key của provider. */
export type JevResponseDiagnostic = Readonly<{
  code: 'MISSING_FIELD' | 'INVALID_TYPE' | 'UNKNOWN_LABEL' | 'OUT_OF_RANGE' | 'INVALID_DISTRIBUTION'
    | 'UNEXPECTED_FIELD' | 'INVALID_VALUE' | 'MODEL_MISMATCH' | 'RESPONSE_TOO_LARGE' | 'UNSERIALIZABLE_RESPONSE';
  path: string;
}>;
/** Phần đã kiểm độc lập, không phải một assessment đầy đủ hay quyền xử phạt. */
export type JevIndependentSafety = Readonly<{ modelVersion: string; rubricVersion: string; threat?: number; distress?: number }>;
export type JevOutcome = Readonly<{
  status: 'ASSESSED'; modelVersion: string; rubricVersion: string;
  assessment: JevAssessment; usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}> | Readonly<{ status: 'UNASSESSED'; reason: JevFailureReason; retryAfterMs?: number;
  diagnostics?: readonly JevResponseDiagnostic[]; independentSafety?: JevIndependentSafety }>;

/** Chỉ nhận snapshot đã kiểm tra; không truyền thẳng object chứa identity/đáp án gold. */
export type JevRequest = Readonly<{
  model: string; state: JevState;
  questions: Readonly<{
    category: Readonly<{ type: 'choice'; instructions: string; criteria: Readonly<Record<JevCategory, string>> }>;
    severity: Readonly<{ type: 'choice'; instructions: string; criteria: Readonly<Record<JevSeverity, string>> }>;
    threat: Readonly<{ type: 'noul'; instructions: string }>;
    distress: Readonly<{ type: 'noul'; instructions: string }>;
  }>;
}>;

/** Đóng băng snapshot ngăn caller sửa policy trong lúc chờ; chỉ dùng với cây dữ liệu vừa validate. */
export function freezeJevSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeJevSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
