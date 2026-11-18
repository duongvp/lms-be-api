import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { CHAT_L1_PROFANITY_POLICY, type ChatL1ProfanityRuleId } from './profanity-policy';
import { CHAT_L1_SHORT_SAFE_POLICY, setActiveShortSafePhrases } from './short-safe';
import { compileRulePatterns, setActiveProfanityPatterns, type CompiledPattern } from './profanity-patterns';
import { setActiveProfanityPolicyVersion } from './profanity';
import { CHAT_L1_SIGNAL_IDS, type ChatL1Config, type ChatL1Mode } from './types';
import { parseChatL1Config } from './config';
import { minimumModerationMode } from '../moderation-mode';

export const CHAT_L1_POLICY_RELOAD_CHANNEL = 'chat:l1:policy_reload';
const MAX_ROWS = 4096;
const MAX_RULES = 128;
export type LoadedPolicySource = 'database' | 'fallback';
export interface ChatL1LoadedPolicy {
  source: LoadedPolicySource; mode: ChatL1Mode; revision: number;
  configuredMode: ChatL1Mode;
  policyVersion: string; contentPolicyVersion: string;
  blacklistCount: number; whitelistCount: number; loadedAt: string;
}
export type PolicyLoadResult = Readonly<{
  policy: Readonly<ChatL1LoadedPolicy>; compiledPatterns: readonly CompiledPattern[];
  shortSafeSet: ReadonlySet<string>; ruleIds: readonly ChatL1ProfanityRuleId[];
}>;
export type ChatL1PolicyDatabase = Pick<PrismaClient, '$transaction'>;
type Publisher = {
  set: (key: string, value: string, expiryMode: 'EX', seconds: number) => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<unknown>;
};
export interface ReloadOptions { broadcast?: boolean }
type Activation = (snapshot: PolicyLoadResult, config: ChatL1Config) => void;
class PolicyValidationError extends Error {
  constructor() { super('INVALID_CHAT_L1_DATABASE_POLICY'); }
}
const invalid = (): never => { throw new PolicyValidationError(); };

/** DB chỉ được thu hẹp trần ENV. Mode DB sai vẫn từ chối cả snapshot. */
export function resolveMode(dbMode?: string | null, envMode: ChatL1Mode = parseChatL1Config(process.env).mode): ChatL1Mode {
  if (dbMode == null) return envMode;
  const mode = dbMode.trim().toLowerCase();
  if (mode !== 'off' && mode !== 'shadow' && mode !== 'enforce') return invalid();
  return minimumModerationMode(envMode, mode);
}

/** Chỉ mẫu ngắn mới được sinh lặp chữ; escape regex không thay thế giới hạn này. */
export function sanitizeBlacklistToken(raw: string, mode: 'bounded' | 'separated' | 'literal'): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.normalize('NFC').toLowerCase().trim();
  if (mode === 'bounded') return /^[\p{L}\p{M}]{2,5}$/u.test(token) && /\p{L}/u.test(token) ? token : null;
  return /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}!]{0,30}[\p{L}\p{M}\p{N}]$/u.test(token)
    && /\p{L}/u.test(token) ? token : null;
}

/** Dùng cùng chuẩn hóa với matcher nguyên câu; dữ liệu bất thường không được miễn L2. */
export function sanitizeWhitelistPhrase(raw: string): string | null {
  if (typeof raw !== 'string' || /[\p{Cc}\p{Cf}]/u.test(raw)) return null;
  const phrase = raw.normalize('NFC').toLowerCase().trim().replace(/ {2,}/gu, ' ');
  return phrase && phrase.length <= 64 && !/[.!]$/u.test(phrase) ? phrase : null;
}

function fallback(env: ChatL1Config): PolicyLoadResult {
  return {
    policy: Object.freeze({ source: 'fallback', mode: env.mode, configuredMode: env.mode, revision: 0,
      policyVersion: env.policyVersion, contentPolicyVersion: CHAT_L1_PROFANITY_POLICY.version,
      blacklistCount: CHAT_L1_PROFANITY_POLICY.rules.reduce((n, rule) => n + rule.tokens.length, 0),
      whitelistCount: CHAT_L1_SHORT_SAFE_POLICY.phrases.length, loadedAt: new Date().toISOString() }),
    compiledPatterns: Object.freeze(compileRulePatterns(CHAT_L1_PROFANITY_POLICY.rules)),
    shortSafeSet: new Set(CHAT_L1_SHORT_SAFE_POLICY.phrases),
    ruleIds: Object.freeze(CHAT_L1_PROFANITY_POLICY.rules.map(rule => rule.id)),
  };
}

/** Hai SELECT cùng transaction RepeatableRead: revision và từ điển thuộc cùng một bản DB.
 * Admin phải commit thay đổi từ điển + tăng revision GLOBAL trong cùng transaction. */
async function readSnapshot(db: ChatL1PolicyDatabase, env: ChatL1Config): Promise<PolicyLoadResult> {
  return db.$transaction(async tx => {
    const settings = await tx.chat_l1_settings.findFirst({ where: { scope_type: 'GLOBAL', scope_key: '*' } });
    const rows = await tx.chat_l1_lexicon.findMany({ where: { is_active: 1 }, take: MAX_ROWS + 1,
      orderBy: { id: 'asc' }, select: { list_type: true, match_mode: true, pattern: true } });
    if (!settings) {
      if (rows.length) return invalid();
      return fallback(env);
    }
    if (rows.length > MAX_ROWS || !Number.isSafeInteger(settings.revision) || settings.revision < 1) return invalid();
    const mode = resolveMode(settings.mode, env.mode);
    const groups = { bounded: new Set<string>(), separated: new Set<string>(), literal: new Set<string>() };
    const safe = new Set<string>();
    for (const row of rows) {
      if (row.list_type === 'BLACKLIST') {
        const matchMode = row.match_mode.toUpperCase();
        const kind = matchMode === 'BOUNDED' ? 'bounded' : matchMode === 'SEPARATED' ? 'separated'
          : matchMode === 'LITERAL' || matchMode === 'EXACT' ? 'literal' : invalid();
        const token = sanitizeBlacklistToken(row.pattern, kind);
        if (!token) return invalid();
        groups[kind].add(token);
      } else if (row.list_type === 'WHITELIST' && row.match_mode === 'EXACT_PHRASE') {
        const phrase = sanitizeWhitelistPhrase(row.pattern);
        if (!phrase) return invalid();
        safe.add(phrase);
      } else return invalid();
    }
    const rules: { id: ChatL1ProfanityRuleId; matchMode: 'bounded' | 'separated' | 'literal'; tokens: string[] }[] = [];
    // Thứ tự ổn định, không đổi rule ID chỉ vì SQL trả dòng theo thứ tự khác.
    for (const kind of ['bounded', 'separated', 'literal'] as const) {
      const tokens = [...groups[kind]].sort();
      for (let i = 0; i < tokens.length; i += 16) {
        if (rules.length >= MAX_RULES) return invalid();
        rules.push({ id: ('VI-PROF-' + String(rules.length + 1).padStart(3, '0')) as ChatL1ProfanityRuleId,
          matchMode: kind, tokens: tokens.slice(i, i + 16) });
      }
    }
    return {
      policy: Object.freeze({ source: 'database', mode, configuredMode: resolveMode(settings.mode, 'enforce'), revision: settings.revision,
        policyVersion: 'short-safe-db-r' + settings.revision,
        contentPolicyVersion: 'vi-profanity-db-r' + settings.revision,
        blacklistCount: Object.values(groups).reduce((n, group) => n + group.size, 0),
        whitelistCount: safe.size, loadedAt: new Date().toISOString() }),
      compiledPatterns: Object.freeze(compileRulePatterns(rules)), shortSafeSet: safe,
      ruleIds: Object.freeze(rules.map(rule => rule.id)),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 5000 });
}

function fingerprint(value: PolicyLoadResult): string {
  return createHash('sha256').update(JSON.stringify([value.policy.configuredMode,
    value.compiledPatterns.map(pattern => [pattern.token, pattern.ruleId, pattern.regex.source]),
    [...value.shortSafeSet].sort()])).digest('hex');
}
function configFor(value: PolicyLoadResult): ChatL1Config {
  return Object.freeze({ mode: value.policy.mode, policyVersion: value.policy.policyVersion,
    contentPolicyVersion: value.policy.contentPolicyVersion, enforcementReady: true,
    enabledSignals: CHAT_L1_SIGNAL_IDS,
    enabledEnforcementRules: Object.freeze(['flood', 'repeat', 'profanity'] as const),
    enabledContentRules: value.ruleIds });
}

/** Factory tách trạng thái từng process/test; không đọc DB ở đường gửi từng tin. */
export function createChatL1PolicyManager(options: {
  env: Readonly<Record<string, string | undefined>>; activate?: Activation; channel?: string; metadataKey?: string;
}) {
  const env = parseChatL1Config(options.env);
  let current = fallback(env), config: ChatL1Config = env;
  let inFlight: Promise<Readonly<ChatL1LoadedPolicy>> | undefined;
  let pending = false, broadcast = false;
  let pendingPublisher: Publisher | undefined;
  const listeners = new Set<(value: Readonly<ChatL1LoadedPolicy>) => void>();
  const channel = options.channel ?? CHAT_L1_POLICY_RELOAD_CHANNEL;
  let environmentValue = options.env.CHAT_L1_MODE, environmentConfig = env;
  const readEnvironment = () => {
    if (environmentValue === options.env.CHAT_L1_MODE) return environmentConfig;
    environmentValue = options.env.CHAT_L1_MODE;
    try { environmentConfig = parseChatL1Config(options.env); }
    catch { environmentConfig = Object.freeze({ ...env, mode: 'off' as const }); }
    return environmentConfig;
  };
  const activate = (candidate: PolicyLoadResult) => {
    const ceiling = readEnvironment().mode;
    const configuredMode = candidate.policy.source === 'fallback' ? ceiling : candidate.policy.configuredMode;
    const next = { ...candidate, policy: Object.freeze({ ...candidate.policy, configuredMode,
      mode: minimumModerationMode(ceiling, configuredMode) }) };
    const nextConfig = configFor(next);
    options.activate?.(next, nextConfig);
    current = next; config = nextConfig;
    for (const listener of listeners) {
      try { listener(current.policy); } catch { /* Consumer lỗi không đảo snapshot. */ }
    }
  };
  const refreshCeiling = () => {
    const ceiling = readEnvironment().mode;
    const configured = current.policy.source === 'fallback' ? ceiling : current.policy.configuredMode;
    if (current.policy.mode !== minimumModerationMode(ceiling, configured) || current.policy.configuredMode !== configured) activate(current);
  };
  const notifyRedis = async (publisher: Publisher | undefined, shouldBroadcast: boolean) => {
    if (!publisher || !shouldBroadcast || current.policy.source !== 'database') return;
    // Redis không sẵn sàng không được treo reload vô hạn hoặc làm mất policy RAM.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const payload = JSON.stringify(current.policy);
    const event = JSON.stringify({ senderPid: process.pid, revision: current.policy.revision });
    try {
      await Promise.race([
        Promise.all([publisher.set(options.metadataKey ?? 'chat:l1:active_policy:global', payload, 'EX', 86400),
          publisher.publish(channel, event)]),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('POLICY_NOTIFY_TIMEOUT')), 1000); }),
      ]);
    } catch { console.warn('[ChatL1Policy] Redis notification unavailable; workers will reconcile.'); }
    finally { if (timer) clearTimeout(timer); }
  };
  return {
    metadata: () => { refreshCeiling(); return current.policy; },
    config: () => { refreshCeiling(); return config; },
    snapshot: () => { refreshCeiling(); return current; },
    subscribe(listener: (value: Readonly<ChatL1LoadedPolicy>) => void) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    /** Đọc để kiểm tra, không thay trạng thái. Lỗi cấu hình/DB phải hiện rõ cho caller. */
    load: (db: ChatL1PolicyDatabase) => readSnapshot(db, readEnvironment()),
    reload(db: ChatL1PolicyDatabase, publisher?: Publisher, reloadOptions: ReloadOptions = {}) {
      // Trần off có hiệu lực ngay cả khi DB reload sau đó thất bại.
      refreshCeiling();
      // Gộp yêu cầu đồng thời thành tối đa một lượt đọc kế tiếp, không tích hàng nghìn Promise/DB job.
      pending = true; broadcast ||= reloadOptions.broadcast !== false;
      if (publisher) pendingPublisher = publisher;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        do {
          pending = false;
          const shouldBroadcast = broadcast; broadcast = false;
          const notifyClient = pendingPublisher; pendingPublisher = undefined;
          let candidate: PolicyLoadResult;
          try { candidate = await readSnapshot(db, readEnvironment()); }
          catch (error) {
            // Không ghi raw SQL/token vào response. RAM hiện tại luôn được giữ nguyên.
            if (error instanceof PolicyValidationError) throw error;
            throw new Error('CHAT_L1_POLICY_UNAVAILABLE');
          }
          if (current.policy.source === 'database') {
            if (candidate.policy.source !== 'database' || candidate.policy.revision < current.policy.revision) {
              throw new Error('STALE_CHAT_L1_POLICY');
            }
            if (candidate.policy.revision === current.policy.revision && fingerprint(candidate) !== fingerprint(current)) {
              throw new Error('CHAT_L1_POLICY_REVISION_NOT_ADVANCED');
            }
          }
          const changed = candidate.policy.source !== current.policy.source
            || candidate.policy.revision !== current.policy.revision || candidate.policy.mode !== current.policy.mode || fingerprint(candidate) !== fingerprint(current);
          if (changed) {
            activate(candidate);
          }
          // Webhook có thể gộp sau lượt đối soát đã nạp cùng revision: vẫn phải báo worker khác.
          await notifyRedis(notifyClient, shouldBroadcast);
        } while (pending);
        return current.policy;
      })().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}

// Khởi tạo lười sau dotenv/bootstrap, không chụp process.env trong lúc import ESM.
let manager: ReturnType<typeof createChatL1PolicyManager> | undefined;
function activeManager() {
  return manager ??= createChatL1PolicyManager({ env: process.env, activate: value => {
    setActiveProfanityPatterns(value.compiledPatterns);
    setActiveProfanityPolicyVersion(value.policy.contentPolicyVersion);
    setActiveShortSafePhrases(value.shortSafeSet);
  } });
}
export const getActivePolicyMetadata = () => activeManager().metadata();
export const getActiveChatL1Config = () => activeManager().config();
export const subscribeChatL1Policy = (listener: (value: Readonly<ChatL1LoadedPolicy>) => void) => activeManager().subscribe(listener);
export const loadChatL1PolicyFromDatabase = (db: ChatL1PolicyDatabase) => activeManager().load(db);
export const reloadChatL1Policy = (db: ChatL1PolicyDatabase, publisher?: Publisher, options?: ReloadOptions) =>
  activeManager().reload(db, publisher, options);
