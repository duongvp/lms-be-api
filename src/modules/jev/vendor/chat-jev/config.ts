import { z } from 'zod';
import { freezeJevSnapshot } from './types';
import { CHAT_JEV_MODEL } from './rubric';
import { DEFAULT_JEV_BREAKER } from './circuit-breaker';
import { minimumModerationMode } from '../moderation-mode';

export const jevModeSchema = z.enum(['off', 'shadow', 'enforce']);
export type JevMode = z.infer<typeof jevModeSchema>;

export const MIN_JEV_ACTOR_SECRET_BYTES = 16;
type JevDependencyFailure = 'MISSING_ACTOR_SECRET' | 'ACTOR_SECRET_TOO_SHORT' | 'MISSING_REDIS_URL' | 'INVALID_REDIS_URL';
/** Tương thích khóa ký phòng đang có; HMAC không bắt buộc 32 ký tự.
 * 16 byte chỉ là mức tối thiểu kiểm cấu hình, không đo entropy. Khóa mới vẫn nên
 * tạo từ 32 byte ngẫu nhiên. Không dùng khóa dự phòng của luồng đăng nhập. */
export function readJevRuntimeDependencies(env: Readonly<Record<string, string | undefined>>):
  { ready: true; actorSecret: string; redisUrl: string } | { ready: false; reason: JevDependencyFailure } {
  const actorSecret = env.ROOM_TOKEN_SECRET?.trim();
  if (!actorSecret) return { ready: false, reason: 'MISSING_ACTOR_SECRET' };
  if (Buffer.byteLength(actorSecret, 'utf8') < MIN_JEV_ACTOR_SECRET_BYTES) return { ready: false, reason: 'ACTOR_SECRET_TOO_SHORT' };
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) return { ready: false, reason: 'MISSING_REDIS_URL' };
  try {
    const url = new URL(redisUrl);
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || /[\r\n]/.test(redisUrl)) throw Error('INVALID_URL');
    // ioredis nhận diện TLS bằng prefix lowercase; URL hợp lệ viết REDISS cũng
    // phải giữ TLS, không truyền lại chuỗi scheme gốc chưa chuẩn hóa.
    return { ready: true, actorSecret, redisUrl: url.toString() };
  } catch { return { ready: false, reason: 'INVALID_REDIS_URL' }; }
}
/** Default tham khảo để seed; vận hành phải đo tải và lưu giới hạn phù hợp trong DB. */
export const DEFAULT_JEV_LIMITS = Object.freeze({ maxInFlight: 30, maxQueue: 500, maxPerRoom: 50,
  deadlineMs: 10000, httpTimeoutMs: 1500, requestsPerSecond: 30, maxDailyAttempts: 50000, reservedInputTokens: 64000 });
const positive = z.number().int().positive().safe();
export const jevSettingsSchema = z.object({ mode: jevModeSchema, revision: positive.max(4294967295),
  circuitBreaker: z.object({ enabled: z.boolean(), failureThreshold: positive.max(100), cooldownMs: positive.min(1000).max(86400000) }).strict().optional(),
  modelVersion: z.literal(CHAT_JEV_MODEL), maxSpendMicroUsd: positive.min(2688).max(1e12),
  limits: z.object({ maxInFlight: positive.max(256), maxQueue: positive.max(5000), maxPerRoom: positive.max(1000),
    deadlineMs: positive.max(60000), httpTimeoutMs: positive.max(3000), requestsPerSecond: positive.max(1000),
    maxDailyAttempts: positive.max(1000000), reservedInputTokens: z.literal(64000) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.limits.httpTimeoutMs > value.limits.deadlineMs || value.limits.maxPerRoom > value.limits.maxQueue) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INVALID_JEV_LIMITS' });
  }
});
export type JevSettings = Readonly<z.infer<typeof jevSettingsSchema>>;
export function compileJevSettings(input: unknown): JevSettings {
  const parsed = jevSettingsSchema.safeParse(input);
  if (!parsed.success) throw Error('INVALID_JEV_RUNTIME_SETTINGS');
  return freezeJevSnapshot(parsed.data);
}
/** ENV là trần vận hành. Thiếu/rỗng là off; DB và scope con chỉ được hạ mode. */
export function resolveJevMode(env: Readonly<Record<string, string | undefined>>, dbMode?: JevMode): JevMode {
  const ceiling = jevModeSchema.safeParse(env.CHAT_JEV_MODE?.trim().toLowerCase() || 'off');
  if (!ceiling.success) return 'off';
  return minimumModerationMode(ceiling.data, dbMode ?? ceiling.data);
}

/** Giá trị mặc định để bootstrap/seed; effective mode luôn phải qua resolveJevMode. */
export function defaultJevSettings(env: Readonly<Record<string, string | undefined>> = {}): JevSettings {
  const mode = jevModeSchema.safeParse(env.CHAT_JEV_MODE?.trim().toLowerCase() || 'off');
  if (!mode.success) throw Error('INVALID_CHAT_JEV_MODE');
  return compileJevSettings({ mode: mode.data, revision: 1, modelVersion: CHAT_JEV_MODEL,
    maxSpendMicroUsd: 10000000, limits: DEFAULT_JEV_LIMITS, circuitBreaker: DEFAULT_JEV_BREAKER });
}
export type JevRuntimeConfig = Readonly<{ mode: 'off'; reason: 'OFF' | 'MISSING_KEY' | 'INVALID_CONFIG' }>
  | Readonly<{ mode: 'shadow' | 'enforce'; apiKey: string; settings: JevSettings }>;
/** Không đọc file hoặc truy vấn DB. Caller cung cấp snapshot đã nạp RAM; key chỉ nằm ở ENV backend. */
export function resolveJevRuntimeConfig(env: Record<string, string | undefined>, settings?: JevSettings | null): JevRuntimeConfig {
  let value: JevSettings;
  try { value = settings ? compileJevSettings(settings) : defaultJevSettings(env); }
  catch { return { mode: 'off', reason: 'INVALID_CONFIG' }; }
  const mode = resolveJevMode(env, value.mode);
  if (mode === 'off') return { mode: 'off', reason: 'OFF' };
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key || /[\r\n]/.test(key)) return { mode: 'off', reason: 'MISSING_KEY' };
  return { mode, apiKey: key, settings: value };
}
