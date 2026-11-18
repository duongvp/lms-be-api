import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import ApiError from '../../utils/ApiError';
import { createChatL1PolicyManager, sanitizeBlacklistToken, sanitizeWhitelistPhrase } from './vendor/chat-l1/policy-loader';
import { evaluateChatL1 } from './vendor/chat-l1/evaluate';
import { getActiveProfanityPatterns, setActiveProfanityPatterns } from './vendor/chat-l1/profanity-patterns';
import { getActiveProfanityPolicyVersion, setActiveProfanityPolicyVersion } from './vendor/chat-l1/profanity';
import { getActiveShortSafePhrases, setActiveShortSafePhrases } from './vendor/chat-l1/short-safe';
import { CHAT_L1_SIGNAL_IDS } from './vendor/chat-l1/types';

export const l1Revision = z.number().int().min(1).max(4294967294);
export const l1Mode = z.enum(['off', 'shadow', 'enforce']);
export const lexiconInput = z.object({
  listType: z.enum(['BLACKLIST', 'WHITELIST']),
  matchMode: z.enum(['BOUNDED', 'SEPARATED', 'LITERAL', 'EXACT_PHRASE']),
  pattern: z.string().min(1).max(150),
  isActive: z.boolean(), category: z.string().trim().max(50).nullable().default(null),
  note: z.string().trim().max(255).nullable().default(null),
}).strict();

export function normalizeLexicon(input: z.infer<typeof lexiconInput>) {
  const { listType, matchMode } = input;
  if ((listType === 'WHITELIST') !== (matchMode === 'EXACT_PHRASE')) {
    throw new ApiError('Whitelist phải khớp toàn câu; blacklist dùng cách khớp từ khóa.', 422);
  }
  const pattern = listType === 'WHITELIST' ? sanitizeWhitelistPhrase(input.pattern)
    : sanitizeBlacklistToken(input.pattern, matchMode.toLowerCase() as 'bounded' | 'separated' | 'literal');
  if (!pattern) throw new ApiError(listType === 'WHITELIST'
    ? 'Câu whitelist tối đa 64 ký tự, không có ký tự ẩn hoặc dấu chấm/chấm than cuối câu.'
    : 'Từ khóa không hợp lệ: BOUNDED dùng 2–5 chữ; các cách khớp khác dùng 2–32 ký tự và không chứa khoảng trắng.', 422);
  return { list_type: listType, match_mode: matchMode, pattern, is_active: input.isActive ? 1 : 0,
    category: listType === 'BLACKLIST' ? 'PROFANITY' : 'SHORT_SAFE', note: input.note || null };
}

// This manager only compiles/reads. It never activates a runtime or calls a provider.
const validator = () => createChatL1PolicyManager({ env: { CHAT_L1_MODE: 'enforce' } });
type Tx = Prisma.TransactionClient;
export function validateL1Transaction(tx: Tx) {
  const view = { $transaction: async (read: (client: Tx) => unknown) => read(tx) };
  return validator().load(view as unknown as Pick<PrismaClient, '$transaction'>);
}

export async function mutateL1<T>(db: PrismaClient, expectedRevision: number, actor: string,
  change: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: number; revision: number }[]>`
      SELECT id, revision FROM chat_l1_settings WHERE scope_type='GLOBAL' AND scope_key='*' FOR UPDATE`;
    const current = rows[0];
    if (!current) throw new ApiError('Chưa khởi tạo cấu hình L1 GLOBAL.', 422);
    if (current.revision !== expectedRevision) throw new ApiError('Cấu hình L1 đã thay đổi. Tải lại trước khi lưu.', 409);
    const data = await change(tx);
    const settings = await tx.chat_l1_settings.update({ where: { id: current.id },
      data: { revision: { increment: 1 }, updated_by: actor } });
    await validateL1Transaction(tx); // Invalid entire snapshots roll back both entry and revision.
    return { data, revision: settings.revision };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 10000 });
}

export async function previewL1(db: PrismaClient, text: string, mode: 'off' | 'shadow' | 'enforce') {
  const snapshot = await validator().load(db);
  const oldPatterns = getActiveProfanityPatterns(), oldPhrases = getActiveShortSafePhrases();
  const oldVersion = getActiveProfanityPolicyVersion();
  // Synchronous section: no await between installing and restoring the isolated Admin matcher.
  try {
    setActiveProfanityPatterns(snapshot.compiledPatterns);
    setActiveShortSafePhrases(snapshot.shortSafeSet);
    setActiveProfanityPolicyVersion(snapshot.policy.contentPolicyVersion);
    return { synthetic: true, externalCalls: 0, revision: snapshot.policy.revision, simulatedMode: mode,
      configuredMode: snapshot.policy.configuredMode,
      decision: evaluateChatL1(text, { mode, policyVersion: snapshot.policy.policyVersion,
        contentPolicyVersion: snapshot.policy.contentPolicyVersion, enabledSignals: CHAT_L1_SIGNAL_IDS,
        enabledContentRules: snapshot.ruleIds, enabledEnforcementRules: ['flood', 'repeat', 'profanity'], enforcementReady: true }),
      disclaimer: 'Chỉ giả lập nội dung L1; không kiểm tra quyền, mute/ban, flood/lặp và không thực thi chế tài.' };
  } finally {
    setActiveProfanityPatterns(oldPatterns); setActiveShortSafePhrases(oldPhrases); setActiveProfanityPolicyVersion(oldVersion);
  }
}
