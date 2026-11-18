import { randomUUID } from 'node:crypto';
import type { JevOutcome } from './types';

export type JevBreakerSettings = Readonly<{ enabled: boolean; failureThreshold: number; cooldownMs: number }>;
export const DEFAULT_JEV_BREAKER: JevBreakerSettings = Object.freeze({ enabled: true, failureThreshold: 3, cooldownMs: 180000 });
type Lease = Readonly<{ token: string; epoch: number; probe: boolean; revision: number; disabled?: boolean }>;
type RedisLike = { status: string; eval(script: string, count: number, ...args: string[]): Promise<unknown> };

const ACQUIRE = `-- jev-circuit-acquire-v1
local kind=redis.call('TYPE',KEYS[1]).ok
if kind~='none' and kind~='hash' then return {'UNAVAILABLE'} end
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local epoch=tonumber(redis.call('HGET',KEYS[1],'epoch') or '0')
local untilAt=tonumber(redis.call('HGET',KEYS[1],'openUntil') or '0')
local probeUntil=tonumber(redis.call('HGET',KEYS[1],'probeUntil') or '0')
if not epoch or not untilAt or not probeUntil then return {'UNAVAILABLE'} end
local storedRevision=tonumber(redis.call('HGET',KEYS[1],'settingsRevision') or '0')
local profile=redis.call('HGET',KEYS[1],'settingsProfile')
local incomingRevision=tonumber(ARGV[3])
if not storedRevision or incomingRevision<storedRevision or (profile and profile~=ARGV[4] and incomingRevision<=storedRevision) then return {'UNAVAILABLE'} end
if not profile or incomingRevision>storedRevision then
 local openedAt=tonumber(redis.call('HGET',KEYS[1],'openedAt') or '0')
 if not openedAt then return {'UNAVAILABLE'} end
 if untilAt>0 and openedAt>0 then
  untilAt=openedAt+tonumber(ARGV[2])
  redis.call('HSET',KEYS[1],'openUntil',untilAt)
 end
 redis.call('HSET',KEYS[1],'settingsRevision',incomingRevision,'settingsProfile',ARGV[4])
end
if untilAt>0 then redis.call('PERSIST',KEYS[1]) else redis.call('PEXPIRE',KEYS[1],86400000) end
if untilAt>now then return {'OPEN',tostring(untilAt)} end
if untilAt>0 then
 if probeUntil>now then return {'OPEN',tostring(probeUntil)} end
 redis.call('HSET',KEYS[1],'probeToken',ARGV[1],'probeUntil',now+5000)
 redis.call('PERSIST',KEYS[1])
 return {'ALLOW',tostring(epoch),'1'}
end
return {'ALLOW',tostring(epoch),'0'}
`;
const COMPLETE = `-- jev-circuit-complete-v1
local kind=redis.call('TYPE',KEYS[1]).ok
if kind~='none' and kind~='hash' then return {'UNAVAILABLE'} end
local epoch=tonumber(redis.call('HGET',KEYS[1],'epoch') or '0')
if not epoch or epoch~=tonumber(ARGV[2]) then return {'STALE'} end
local storedRevision=tonumber(redis.call('HGET',KEYS[1],'settingsRevision') or '0')
if not storedRevision or storedRevision~=tonumber(ARGV[8]) then return {'STALE'} end
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
if ARGV[3]=='1' then
 if redis.call('HGET',KEYS[1],'probeToken')~=ARGV[1] or tonumber(redis.call('HGET',KEYS[1],'probeUntil') or '0')<=now then return {'STALE'} end
 redis.call('HDEL',KEYS[1],'probeToken','probeUntil')
end
if ARGV[4]=='NEUTRAL' then return {'UNCHANGED'} end
local failures=tonumber(redis.call('HGET',KEYS[1],'failures') or '0')
if not failures or failures<0 then return {'UNAVAILABLE'} end
if ARGV[4]=='SUCCESS' then
 redis.call('HSET',KEYS[1],'failures',0,'openUntil',0,'lastSuccessAt',now,'epoch',epoch+(ARGV[3]=='1' and 1 or 0))
else
 failures=math.min(100,failures+1)
 redis.call('HSET',KEYS[1],'failures',failures,'lastFailureAt',now,'lastReason',ARGV[7])
 if ARGV[3]=='1' or failures>=tonumber(ARGV[5]) then
  redis.call('HSET',KEYS[1],'openUntil',now+tonumber(ARGV[6]),'openedAt',now,'epoch',epoch+1)
 end
end
if tonumber(redis.call('HGET',KEYS[1],'openUntil') or '0')>0 then
 redis.call('PERSIST',KEYS[1])
else
 redis.call('PEXPIRE',KEYS[1],86400000)
end
return {'RECORDED'}
`;
const failures = new Set(['TIMEOUT', 'NETWORK_ERROR', 'HTTP_ERROR', 'AUTH_FAILED', 'INVALID_RESPONSE', 'MODEL_MISMATCH', 'OVERLOADED']);

/** Trạng thái dùng chung theo credential/model. Epoch chặn kết quả cũ đóng nhầm công tắc;
 * sau cooldown chỉ một probe toàn cụm, kể cả phòng lâu không có tin mới. State OPEN
 * giữ tới khi probe hồi phục; state CLOSED tự hết hạn sau24h. Không retry tin cũ. */
export function createJevCircuitBreaker(redis: RedisLike, key: string, settings: JevBreakerSettings = DEFAULT_JEV_BREAKER, revision = 0) {
  if (!/^chat-jev:\{chat-jev\}:[a-zA-Z0-9:_-]{1,160}$/.test(key)
    || typeof settings.enabled !== 'boolean' || !Number.isSafeInteger(settings.failureThreshold) || settings.failureThreshold < 1 || settings.failureThreshold > 100
    || !Number.isSafeInteger(settings.cooldownMs) || settings.cooldownMs < 1000 || settings.cooldownMs > 86400000
    || !Number.isSafeInteger(revision) || revision < 0 || revision > 4294967295) throw Error('INVALID_JEV_BREAKER');
  const options = Object.freeze({ ...settings });
  const profile = JSON.stringify([options.enabled, options.failureThreshold, options.cooldownMs]);
  // Chỉ là quan sát tại worker này; không giả làm trạng thái hiện tại của toàn cụm.
  const metrics = { acquired: 0, skipped: 0, unavailable: 0, recorded: 0, lastObservedOpenUntil: 0 };
  let physicalInFlight = 0;
  const run = async (script: string, args: string[]) => {
    if (redis.status !== 'ready' || physicalInFlight >= 64) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    physicalInFlight++;
    const physical = Promise.resolve().then(() => redis.eval(script, 1, key, ...args)).finally(() => { physicalInFlight--; });
    // Timeout ngừng chờ, không nhả slot khi lệnh Redis thực còn treo.
    try { return await Promise.race([physical,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 250); })]); }
    catch { return null; } finally { if (timer) clearTimeout(timer); }
  };
  return {
    async acquire(): Promise<Lease | null> {
      if (!options.enabled) return { token: '', epoch: 0, probe: false, revision, disabled: true };
      const token = randomUUID(), result = await run(ACQUIRE, [token, String(options.cooldownMs), String(revision), profile]);
      if (Array.isArray(result) && result[0] === 'ALLOW' && Number.isSafeInteger(Number(result[1])) && ['0', '1'].includes(String(result[2]))) {
        metrics.acquired++; return { token, epoch: Number(result[1]), probe: String(result[2]) === '1', revision };
      }
      if (Array.isArray(result) && result[0] === 'OPEN') { metrics.skipped++; metrics.lastObservedOpenUntil = Number(result[1]) || 0; }
      else metrics.unavailable++;
      return null;
    },
    async complete(lease: Lease, outcome?: JevOutcome) {
      if (lease.disabled) return;
      const kind = outcome?.status === 'ASSESSED' ? 'SUCCESS'
        : outcome?.status === 'UNASSESSED' && failures.has(outcome.reason) ? 'FAILURE' : 'NEUTRAL';
      const result = await run(COMPLETE, [lease.token, String(lease.epoch), lease.probe ? '1' : '0', kind,
        String(options.failureThreshold), String(options.cooldownMs), outcome?.status === 'UNASSESSED' ? outcome.reason : '', String(lease.revision)]);
      if (Array.isArray(result) && result[0] === 'RECORDED') metrics.recorded++;
    },
    snapshot: () => ({ ...metrics, physicalInFlight, settings: options }),
  };
}
export type JevCircuitBreaker = ReturnType<typeof createJevCircuitBreaker>;
