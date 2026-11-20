import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
// MySQL raw SQL conflicts use P2010 instead of Prisma's P2034.
export const retryableTransactionError = (e: any): boolean => e?.code === 'P2034' || (e?.code === 'P2010' && ['1213', '1205'].includes(String(e?.meta?.code)));
import ApiError from '../../utils/ApiError';
export const fail = (message: string, status = 400): never => { throw new ApiError(message, status); };
export const json = (v: any): any => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x));
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const hash = (v: any): string => createHash('sha256').update(JSON.stringify(canonical(json(v)))).digest('hex');
export const text = (v: unknown, label: string, max = 500): string => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
        return fail(`${label} không hợp lệ`);
    return v.trim();
};
export const id = (v: unknown): bigint => {
    if (!/^[1-9]\d{0,18}$/.test(String(v ?? '')))
        return fail('ID không hợp lệ');
    return BigInt(String(v));
};
export const numberId = (v: unknown): number => { const n = Number(id(v)); if (n > 4294967295)
    return fail('ID vượt giới hạn'); return n; };
export const integer = (v: unknown, label: string, min = 0, max = 100000): number => {
    const n = Number(v);
    if (v == null || v === '' || !Number.isInteger(n) || n < min || n > max)
        return fail(`${label} không hợp lệ`);
    return n;
};
export const choice = <T extends string>(v: unknown, values: readonly T[], label: string): T => values.includes(v as T) ? v as T : fail(`${label} không hợp lệ`);
export const day = (v: unknown): Date => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return fail('Ngày phải là YYYY-MM-DD');
    const d = new Date(v + 'T00:00:00.000Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== v)
        return fail('Ngày không hợp lệ');
    return d;
};
export const clock = (v: unknown): Date => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v))
        return fail('Thời gian phải là ISO theo giờ lưu lịch');
    const d = new Date(v);
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 19) !== v.slice(0, 19))
        return fail('Thời gian không hợp lệ');
    return d;
};
export const money = (v: unknown, allowNegative = false): Prisma.Decimal => {
    if (!/^-?\d{1,12}(?:\.\d{1,2})?$/.test(String(v ?? '')))
        return fail('Số tiền không hợp lệ');
    const d = new Prisma.Decimal(String(v));
    if (!allowNegative && d.isNegative())
        return fail('Số tiền không được âm');
    return d;
};
export const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const assistants = (v: unknown) => [...new Set(String(v ?? '').split(',').map(norm).filter(Boolean))];
export const dimensions = ['teacher_profile_id', 'group_id', 'subject', 'code', 'role', 'grade', 'system_type', 'calendar_source', 'teaching_model', 'session_kind', 'is_substitute'] as const;
export const normalizeDimensions = (input: any) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        return fail('Điều kiện đơn giá không hợp lệ');
    const d: any = {};
    for (const [k, v] of Object.entries(input)) {
        if (!dimensions.includes(k as any))
            return fail(`Điều kiện không hỗ trợ: ${k}`);
        if (v === undefined || v === null || v === '')
            continue;
        if (k === 'teacher_profile_id' || k === 'group_id')
            d[k] = numberId(v);
        else if (k === 'grade')
            d[k] = integer(v, k, 1, 12);
        else if (k === 'is_substitute') {
            if (typeof v !== 'boolean')
                return fail('Dạy thay phải là boolean');
            d[k] = v;
        }
        else
            d[k] = text(v, k, k === 'code' ? 30 : 150);
    }
    if (d.role)
        choice(d.role, ['teacher', 'assistant'], 'Vai trò');
    if (d.session_kind)
        choice(d.session_kind, ['regular', 'makeup', 'additional'], 'Loại buổi');
    if (d.calendar_source)
        choice(d.calendar_source, ['livestream', 'feed'], 'Nguồn');
    if (d.teaching_model)
        choice(d.teaching_model, ['large_class', 'small_group'], 'Mô hình');
    if (d.system_type)
        choice(d.system_type, ['topclass', 'topuni', 'event', 'phaken'], 'Hệ');
    return d;
};
export const resolveRate = (rates: any[], context: any, date: Date) => {
    const candidates = rates.filter(r => new Date(r.valid_from) <= date && (!r.valid_to || new Date(r.valid_to) > date)
        && Object.entries(r.dimensions).every(([k, v]) => context[k] === v));
    const score = (r: any) => dimensions.map(k => r.dimensions[k] === undefined ? '0' : '1').join('');
    candidates.sort((a, b) => b.priority - a.priority || score(b).localeCompare(score(a)));
    if (!candidates.length)
        return fail('Thiếu đơn giá phù hợp', 422);
    if (candidates[1] && candidates[0].priority === candidates[1].priority && score(candidates[0]) === score(candidates[1]))
        return fail('Có nhiều đơn giá cùng ưu tiên', 422);
    return candidates[0];
};
export const calculateAmount = (rate: any, actual: number, scheduled: number) => {
    const seconds = rate.duration_basis === 'actual' ? actual : scheduled;
    if (rate.pay_basis === 'hour' && seconds <= 0)
        return fail('Thiếu thời lượng được xác nhận', 422);
    return new Prisma.Decimal(rate.amount).mul(rate.pay_basis === 'hour' ? new Prisma.Decimal(seconds).div(3600) : 1).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
};
export const sourceShape = (c: any) => json({ id: c.id, key: c.key, code: c.code, group_id: c.group_id ?? null, session_id: c.session_id,
    learn_number: c.learn_number, lesson_count: c.lesson_count, subject: c.subject, lesson_name: c.lesson_name, grade: c.grade ?? null,
    system_type: c.system_type, teacher: c.teacher, assistant_teacher: c.assistant_teacher, start_time: c.start_time, end_time: c.end_time,
    lesson_status: c.lesson_status, deleted_at: c.deleted_at });
export const stateAction = (state: string, action: string, paid: boolean) => {
    const transitions: Record<string, Record<string, string>> = { submit: { draft: 'pending_review' }, return: { pending_review: 'draft' }, approve: { pending_review: 'approved' }, reopen: { approved: 'draft' } };
    if (action === 'reopen' && paid)
        return fail('Kỳ đã có thanh toán; hãy tạo điều chỉnh ở kỳ mới', 409);
    return transitions[action]?.[state] ?? fail('Thao tác không hợp lệ với trạng thái kỳ lương', 409);
};
export const page = (q: any) => ({ page: integer(q.page ?? 1, 'Trang', 1, 100000), limit: integer(q.limit ?? 25, 'Số dòng', 1, 100) });
export const paginate = (rows: any[], q: any, allowed: string[], fallback: string) => {
    const p = page(q), sort = choice(q.sort ?? fallback, allowed, 'Cột sắp xếp'), order = choice(q.order ?? 'asc', ['asc', 'desc'], 'Thứ tự');
    rows.sort((a, b) => { const x = a[sort], y = b[sort]; const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'vi', { numeric: true }); return (order === 'asc' ? n : -n) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); });
    return { rows: rows.slice((p.page - 1) * p.limit, p.page * p.limit), pagination: { ...p, total: rows.length } };
};
