import type { PrismaClient } from '@prisma/client';
import { JEV_CLASSROOM_C2_SEED } from './deployment-seed-data';
import { compileDynamicJevRubric } from './dynamic-storage';
import { compileJevShadowPolicy } from './shadow-policy';
import { createJevCompactBundle } from './compact-contract';
import { createJevPolicyDraft } from './compact-policy-store';
import { seedJevRuntimeSettings } from './runtime-settings';
export function compileJevDeploymentSeed() {
    const data = JEV_CLASSROOM_C2_SEED, rubric = compileDynamicJevRubric(data.rubric);
    const policy = compileJevShadowPolicy({ ...data.policy, schemaVersion: 3,
        version: data.policyKey + ':r' + data.revision, executionMode: 'shadow',
        modelVersion: rubric.runtime.modelVersion, rubricVersion: rubric.rubricVersion, framework: rubric.framework });
    return { data, rubric, policy };
}
/** Chỉ seed DRAFT và GLOBAL off khi thiếu; không sửa nội dung/mode/lượt đang chạy. */
export async function seedChatJevDeployment(db: PrismaClient) {
    const { data, policy, rubric } = compileJevDeploymentSeed();
    await seedJevRuntimeSettings(db);
    const identity = { policy_key: data.policyKey, revision: data.revision };
    let row = await db.chat_jev_policy_versions.findUnique({ where: { policy_key_revision: identity } }), created = false;
    if (!row) {
        try {
            row = await createJevPolicyDraft(db, { policyKey: data.policyKey, revision: data.revision, actor: 'system_seed:chat-jev-c2', config: createJevCompactBundle(policy, rubric.runtime).config });
            created = true;
        }
        catch (e) {
            if ((e as {
                code?: string;
            })?.code !== 'P2002')
                throw e;
            row = await db.chat_jev_policy_versions.findUniqueOrThrow({ where: { policy_key_revision: identity } });
        }
    }
    return { created, policyId: row.id, status: row.status, policy: policy.version, activated: false as const };
}
/** Staging thường chạy NODE_ENV=production trong container; yêu cầu flag thao tác rõ ràng.
 * Không tự đọc file .env hoặc nhận flag activate; workflow staging chủ động gọi sau migration. */
export function jevDeploymentSeedAllowed(args: readonly string[], databaseUrl: string | undefined) {
    if (args.length !== 1 || args[0] !== '--staging')
        return false;
    try {
        const url = new URL(databaseUrl || '');
        return url.protocol === 'mysql:' && !!url.hostname && url.pathname.length > 1;
    }
    catch {
        return false;
    }
}
