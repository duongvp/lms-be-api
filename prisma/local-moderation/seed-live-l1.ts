import { PrismaClient } from '@prisma/client';
import { CHAT_L1_PROFANITY_POLICY } from '../../src/modules/jev/vendor/chat-l1/profanity-policy';
import { CHAT_L1_SHORT_SAFE_POLICY } from '../../src/modules/jev/vendor/chat-l1/short-safe';
import { parseChatL1Config } from '../../src/modules/jev/vendor/chat-l1/config';

/** Seed bù mục thiếu, không bật lại mục admin đã tắt và không reset mode/revision.
 * Unique key binary trong migration giữ riêng các token khác dấu tiếng Việt. */
export async function seedChatL1(prisma: PrismaClient) {
  const data = [
    ...CHAT_L1_PROFANITY_POLICY.rules.flatMap(rule => rule.tokens.map(pattern => ({
      list_type: 'BLACKLIST', match_mode: rule.matchMode === 'bounded' ? 'BOUNDED'
        : rule.matchMode === 'separated' ? 'SEPARATED' : 'LITERAL',
      pattern: pattern.normalize('NFC').toLowerCase().trim(), category: 'PROFANITY',
      note: 'Seed rule ' + rule.id, created_by: 'system_seed', is_active: 1,
    }))),
    ...CHAT_L1_SHORT_SAFE_POLICY.phrases.map(pattern => ({ list_type: 'WHITELIST', match_mode: 'EXACT_PHRASE',
      pattern: pattern.normalize('NFC').toLowerCase().trim(), category: 'SHORT_SAFE',
      note: 'Classroom acknowledgement', created_by: 'system_seed', is_active: 1 })),
  ];
  return prisma.$transaction(async tx => {
    await tx.chat_l1_settings.upsert({
      where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } },
      create: { scope_type: 'GLOBAL', scope_key: '*', mode: parseChatL1Config(process.env).mode,
        revision: 1, updated_by: 'system_seed' }, update: {},
    });
    const inserted = await tx.chat_l1_lexicon.createMany({ data, skipDuplicates: true });
    // Cùng transaction để worker không đọc revision mới với từ điển seed còn dở.
    if (inserted.count) await tx.chat_l1_settings.update({
      where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } },
      data: { revision: { increment: 1 }, updated_by: 'system_seed' },
    });
    return inserted.count;
  });
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedChatL1(prisma).then(count => console.log('Chat L1: thêm ' + count + ' mục còn thiếu.'))
    .catch(() => { console.error('Seed thất bại; kiểm tra migration/DB trước khi thử lại.'); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
