import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { isProgramAllowed, getProgramScopeFilter } from '../../services/authorization.service';
import { fail, hash, id, json, sourceShape, text, retryableTransactionError } from './salary-domain';
export { prisma };
export type User = {
    userId: number;
    username: string;
    permissions?: string[];
    roles?: string[];
    programScope?: any;
};
export type DB = Prisma.TransactionClient;
export const has = (u: User, p: string) => u.permissions?.includes('*') || u.roles?.includes('admin') || u.permissions?.includes(p);
export const check = (u: User, p: string, codes: string[]) => {
    if (!codes.length || codes.some(c => !isProgramAllowed(u, p, c)))
        fail('Không có quyền trên toàn bộ chương trình liên quan', 403);
};
export const scope = (u: User, p: string) => getProgramScopeFilter(u, p);
export const allSources = (r: any) => [...new Set<string>([r.billing_code, ...(r.sources ?? []).map((s: any) => s.snapshot.code)])];
export const audit = async (tx: DB, u: User, type: string, entity: any, action: string, before: any, after: any, reason: string, period?: bigint) => {
    await tx.salary_audit_logs.create({ data: { entity_type: type, entity_id: String(entity), period_id: period, action,
            created_at: new Date(), actor_id: u.userId, actor_username: u.username, reason: text(reason, 'Lý do'), before_data: json(before), after_data: json(after) } });
};
export const calendars = async (tx: DB, ids: number[], lock = false) => {
    if (lock)
        await tx.$queryRaw(Prisma.sql `SELECT id FROM calendar WHERE id IN (${Prisma.join([...ids].sort((a, b) => a - b))}) ORDER BY id FOR UPDATE`);
    const rows = await tx.$queryRaw<any[]>(Prisma.sql `SELECT c.*, l.grade FROM calendar c LEFT JOIN lessons l ON l.id=c.session_id WHERE c.id IN (${Prisma.join(ids)}) ORDER BY c.id`);
    return rows.map(c => ({ ...c, id: Number(c.id), group_id: c.group_id == null ? null : Number(c.group_id), grade: c.grade == null ? null : Number(c.grade) }));
};
export const fresh = async (tx: DB, r: any) => {
    const snap = r.snapshot as any;
    if (snap.replaces_calendar_id) {
        const original = (await calendars(tx, [Number(snap.replaces_calendar_id)], true))[0];
        if (!original || hash(sourceShape(original)) !== snap.replaced_source_hash)
            fail('Lịch nghỉ gốc đã thay đổi; cần đối soát học bù', 409);
    }
    const rows = await calendars(tx, r.sources.map((s: any) => s.calendar_id), true);
    if (rows.length !== r.sources.length || r.sources.some((s: any) => { const c = rows.find(c => c.id === s.calendar_id); return !c || hash(sourceShape(c)) !== s.source_hash; }))
        fail('Lịch nguồn đã thay đổi; cần xác nhận lại công', 409);
};
export const lockPeriod = async (tx: DB, raw: any, u: User, permission: string, expected?: unknown) => {
    const key = id(raw);
    await tx.$queryRaw `SELECT id FROM salary_periods WHERE id=${key} FOR UPDATE`;
    const p = await tx.salary_periods.findUnique({ where: { id: key } });
    if (!p)
        return fail('Không tìm thấy kỳ lương', 404);
    check(u, permission, p.scope as string[]);
    if (expected !== undefined && Number(expected) !== p.revision)
        fail('Kỳ đã thay đổi; vui lòng tải lại', 409);
    return p;
};
export const transaction = async <T>(work: (tx: DB) => Promise<T>): Promise<T> => {
    for (let attempt = 0;; attempt++) {
        try {
            return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 60000 });
        }
        catch (e: any) {
            if (!retryableTransactionError(e) || attempt >= 2)
                throw e;
        }
    }
};
