import { Prisma, type PrismaClient, type chat_jev_bindings } from '@prisma/client';
import { compileJevSettings, defaultJevSettings, type JevSettings } from './config';
/** Revision thuộc hàng GLOBAL; hai form Admin dùng chung CAS để không ghi đè nhau. */
export function projectJevSettings(row: Pick<chat_jev_bindings, 'scope_type' | 'scope_key' | 'runtime_json' | 'revision'>): JevSettings {
    if (row.scope_type !== 'GLOBAL' || row.scope_key !== '*' || !row.runtime_json || typeof row.runtime_json !== 'object'
        || Array.isArray(row.runtime_json) || Object.hasOwn(row.runtime_json, 'revision'))
        throw Error('INVALID_JEV_RUNTIME_SETTINGS');
    return compileJevSettings({ ...row.runtime_json, revision: row.revision });
}
export function jevRuntimeJson(settings: JevSettings): Prisma.InputJsonObject {
    const { revision: _revision, ...value } = compileJevSettings(settings);
    return JSON.parse(JSON.stringify(value));
}
/** Chỉ bootstrap thiếu: không đổi mode/cap/revision đã được vận hành lưu. */
export async function seedJevRuntimeSettings(db: Pick<PrismaClient, '$transaction'>) {
    return db.$transaction(async (tx) => {
        await tx.chat_jev_bindings.createMany({ data: [{ scope_type: 'GLOBAL', scope_key: '*', mode: 'off',
                    runtime_json: jevRuntimeJson(defaultJevSettings()), updated_by: 'system_seed:chat-jev' }], skipDuplicates: true });
        const row = await tx.chat_jev_bindings.findUniqueOrThrow({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } });
        if (row.runtime_json !== null)
            return row;
        // Backfill CAS trường NULL, tránh ghi đè cấu hình vừa được Admin cập nhật.
        await tx.$executeRaw `UPDATE chat_jev_bindings SET runtime_json=${JSON.stringify(jevRuntimeJson(defaultJevSettings()))},
      revision=revision+1,updated_at=CURRENT_TIMESTAMP(3) WHERE id=${row.id} AND revision=${row.revision} AND runtime_json IS NULL`;
        return tx.chat_jev_bindings.findUniqueOrThrow({ where: { id: row.id } });
    }, { maxWait: 1000, timeout: 5000 });
}
/** Sửa runtime giữ nguyên policy của GLOBAL; cùng revision với thao tác bind. */
export async function updateJevRuntimeSettings(db: Pick<PrismaClient, '$transaction'>, input: {
    expectedRevision: number;
    actor: string;
    settings: JevSettings;
}) {
    const settings = compileJevSettings(input.settings);
    if (!input.actor.trim() || input.actor.length > 100 || !Number.isSafeInteger(input.expectedRevision)
        || input.expectedRevision < 1 || input.expectedRevision >= 4294967295 || settings.revision !== input.expectedRevision + 1)
        throw Error('INVALID_JEV_RUNTIME_SETTINGS');
    return db.$transaction(async (tx) => {
        const changed = await tx.$executeRaw `UPDATE chat_jev_bindings SET runtime_json=${JSON.stringify(jevRuntimeJson(settings))},
      revision=revision+1,updated_by=${input.actor},updated_at=CURRENT_TIMESTAMP(3)
      WHERE scope_type='GLOBAL' AND scope_key='*' AND revision=${input.expectedRevision}`;
        if (changed !== 1)
            throw Error('JEV_SETTINGS_REVISION_CONFLICT');
        return projectJevSettings(await tx.chat_jev_bindings.findUniqueOrThrow({ where: { scope_type_scope_key: { scope_type: 'GLOBAL', scope_key: '*' } } }));
    }, { maxWait: 1000, timeout: 3000 });
}
