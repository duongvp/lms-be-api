import { Prisma } from '@prisma/client';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { prisma, User, DB, check, scope, allSources, transaction, calendars, fresh, audit, lockPeriod } from './salary-common';
import { fail, id, numberId, integer, choice, day, text, json, hash, money, resolveRate, calculateAmount, stateAction, paginate } from './salary-domain';
export const listRates = async (u: User, q: any) => {
    const allowed = scope(u, 'salary.rate.manage');
    const rows = await prisma.salary_rates.findMany({ orderBy: { id: 'desc' }, take: 5001 });
    if (rows.length > 5000)
        fail('Quá nhiều phiên bản giá; cần lưu trữ kỳ giá cũ', 422);
    return paginate(json(rows.filter(r => allowed === null || ((r.dimensions as any).code && allowed.includes((r.dimensions as any).code)))), q, ['id', 'name', 'priority', 'valid_from'], 'id');
};
export const createRate = async (u: User, b: any) => transaction(async (tx) => {
    const dimensions: Record<string, any> = {};
    const source = b.dimensions;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        fail('Điều kiện đơn giá không hợp lệ');
    const supported = ['code', 'teacher_profile_id', 'role', 'subject', 'group_id', 'grade', 'system_type', 'calendar_source', 'session_kind', 'is_substitute'];
    if (Object.keys(source).some(k => !supported.includes(k)))
        fail('Điều kiện đơn giá chưa được hỗ trợ');
    for (const k of supported)
        if (source[k] !== undefined && source[k] !== null && source[k] !== '')
            dimensions[k] = source[k];
    if (dimensions.code) {
        dimensions.code = text(dimensions.code, 'Chương trình', 30);
        check(u, 'salary.rate.manage', [dimensions.code]);
    }
    else if (scope(u, 'salary.rate.manage') !== null)
        fail('Đơn giá không giới hạn chương trình cần phạm vi ALL', 403);
    if (dimensions.teacher_profile_id) {
        dimensions.teacher_profile_id = numberId(dimensions.teacher_profile_id);
        if (!await tx.teacher_profiles.findUnique({ where: { id: dimensions.teacher_profile_id } }))
            fail('Không tìm thấy nhân sự');
    }
    if (dimensions.role)
        choice(dimensions.role, ['teacher', 'assistant'], 'Vai trò');
    if (dimensions.subject)
        dimensions.subject = text(dimensions.subject, 'Môn', 100);
    if (dimensions.grade)
        dimensions.grade = integer(dimensions.grade, 'Khối', 1, 12);
    if (dimensions.group_id) {
        dimensions.group_id = numberId(dimensions.group_id);
        if (!dimensions.code)
            fail('Đơn giá nhóm bắt buộc có chương trình');
        const exists = await tx.$queryRaw<any[]> `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_groups'`;
        if (!exists.length)
            fail('Môi trường chưa tích hợp nhóm nhỏ');
        const groups = await tx.$queryRaw<any[]> `SELECT id FROM learning_groups WHERE id=${dimensions.group_id} AND code=${dimensions.code}`;
        if (!groups.length)
            fail('Nhóm không thuộc chương trình');
    }
    if (dimensions.system_type)
        choice(dimensions.system_type, ['topclass', 'topuni', 'event', 'phaken'], 'Hệ');
    if (dimensions.calendar_source)
        choice(dimensions.calendar_source, ['livestream', 'feed'], 'Nguồn');
    if (dimensions.session_kind)
        choice(dimensions.session_kind, ['regular', 'makeup', 'additional'], 'Loại buổi');
    if (dimensions.is_substitute !== undefined && typeof dimensions.is_substitute !== 'boolean')
        fail('Điều kiện dạy thay phải là boolean');
    const from = day(b.valid_from), to = day(b.valid_to);
    if (from >= to)
        fail('Khoảng hiệu lực không hợp lệ');
    // Lock matching rule scope to serialize overlapping rate creation.
    await tx.$queryRaw `SELECT id FROM salary_rates ORDER BY id FOR UPDATE`;
    if (b.previous_id) {
        const old = await tx.salary_rates.findUnique({ where: { id: id(b.previous_id) } });
        if (!old)
            return fail('Không tìm thấy phiên bản gốc', 404);
        const code = (old.dimensions as any).code;
        if (code)
            check(u, 'salary.rate.manage', [code]);
        else if (scope(u, 'salary.rate.manage') !== null)
            fail('Cần phạm vi ALL', 403);
        if (hash(old.dimensions) !== hash(dimensions) || from <= old.valid_from)
            fail('Phiên bản kế tiếp phải cùng điều kiện và có hiệu lực sau bản gốc');
        if (!old.valid_to || old.valid_to > from) {
            await tx.salary_rates.update({ where: { id: old.id }, data: { valid_to: from } });
            await audit(tx, u, 'rate', old.id, 'close_effective_window', old, { ...json(old), valid_to: from }, text(b.reason, 'Lý do'));
        }
    }
    const candidates = await tx.salary_rates.findMany({ where: { valid_from: { lt: to }, valid_to: { gt: from }, priority: integer(b.priority ?? 0, 'Ưu tiên', 0, 10000) } });
    if (candidates.some(r => hash(r.dimensions) === hash(dimensions)))
        fail('Đã có cấu hình cùng điều kiện/ưu tiên trong khoảng hiệu lực này', 409);
    const row = await tx.salary_rates.create({ data: { name: text(b.name, 'Tên đơn giá', 150), dimensions: json(dimensions), pay_basis: choice(b.pay_basis, ['session', 'hour'], 'Cách trả'),
            duration_basis: choice(b.duration_basis, ['scheduled', 'actual'], 'Nguồn thời lượng'), amount: money(b.amount), priority: integer(b.priority ?? 0, 'Ưu tiên', 0, 10000), valid_from: from, valid_to: to, created_by: u.username, created_at: new Date(), previous_id: b.previous_id ? id(b.previous_id) : null } });
    await audit(tx, u, 'rate', row.id, 'create', null, row, text(b.reason, 'Lý do'));
    return row;
});
export const createPeriod = async (u: User, b: any) => transaction(async (tx) => {
    const codes = Array.from(new Set<string>((Array.isArray(b.codes) ? b.codes : []).map((v: any) => text(v, 'Chương trình', 30)))).sort();
    if (!codes.length || codes.length > 100)
        fail('Chọn từ 1 đến 100 chương trình');
    check(u, 'salary.period.create', codes);
    const from = day(b.from), to = day(b.to);
    if (from >= to || +to - +from > 367 * 86400000)
        fail('Kỳ lương phải từ 1 ngày đến một năm');
    const known = await tx.$queryRaw<any[]>(Prisma.sql `SELECT DISTINCT code FROM calendar WHERE code IN (${Prisma.join(codes)}) AND deleted_at IS NULL`);
    if (codes.some(c => !known.some(k => k.code === c)))
        fail('Có chương trình chưa có lịch');
    const p = await tx.salary_periods.create({ data: { name: text(b.name, 'Tên kỳ', 150), from_date: from, to_date: to, scope: codes, snapshot: { issues: [], calculator_version: '1' }, created_by: u.username, created_at: new Date() } });
    await audit(tx, u, 'period', p.id, 'create', null, p, text(b.reason, 'Lý do'), p.id);
    return p;
});
export const listPeriods = async (u: User, q: any) => {
    const rows = await prisma.salary_periods.findMany({ orderBy: { id: 'desc' }, take: 5001 });
    if (rows.length > 5000)
        fail('Quá nhiều kỳ; cần bộ lọc lưu trữ', 422);
    return paginate(json(rows.filter(p => (p.scope as string[]).every(c => { const allowed = scope(u, 'salary.view'); return allowed === null || allowed.includes(c); }))), q, ['id', 'name', 'from_date', 'status'], 'id');
};
const periodDetails = async (tx: DB, p: any) => {
    const [items, adjustments, payments] = await Promise.all([tx.salary_items.findMany({ where: { period_id: p.id }, orderBy: { id: 'asc' } }), tx.salary_adjustments.findMany({ where: { period_id: p.id }, orderBy: { id: 'asc' } }), tx.salary_payments.findMany({ where: { period_id: p.id }, orderBy: { id: 'asc' } })]);
    const by = new Map<number, any>();
    const ensure = (key: number, name?: string) => { if (!by.has(key))
        by.set(key, { id: key, name: name ?? `Nhân sự #${key}`, base: new Prisma.Decimal(0), adjustment: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), sessions: 0 }); return by.get(key); };
    for (const i of items) {
        const t = ensure(i.teacher_profile_id, (i.snapshot as any).teacher?.name ?? (i.snapshot as any).teacher?.username);
        t.base = t.base.add(i.amount);
        t.sessions++;
    }
    for (const a of adjustments) {
        const t = ensure(a.teacher_profile_id);
        t.adjustment = t.adjustment.add(a.amount);
    }
    for (const pay of payments) {
        const t = ensure(pay.teacher_profile_id);
        t.paid = t.paid.add(pay.amount);
    }
    const teachers = [...by.values()].map(t => ({ ...t, total: t.base.add(t.adjustment), unpaid: t.base.add(t.adjustment).sub(t.paid) }));
    const total = teachers.reduce((sum, t) => sum.add(t.total), new Prisma.Decimal(0)), paid = teachers.reduce((sum, t) => sum.add(t.paid), new Prisma.Decimal(0));
    return { period: p, items, adjustments, payments, teachers, total, paid, unpaid: total.sub(paid) };
};
export const getPeriod = async (u: User, key: any) => transaction(async (tx) => periodDetails(tx, await lockPeriod(tx, key, u, 'salary.view')));
const calculate = async (tx: DB, p: any, u: User, permission = 'salary.period.calculate') => {
    const codes = p.scope as string[], records = await tx.teaching_records.findMany({ where: { service_date: { gte: p.from_date, lt: p.to_date }, billing_code: { in: codes }, status: 'confirmed' }, include: { sources: true, salary_item: true }, orderBy: { id: 'asc' } });
    const rates = await tx.salary_rates.findMany({ where: { valid_from: { lt: p.to_date }, valid_to: { gt: p.from_date } } });
    const issues: any[] = [], items: any[] = [];
    // Missing confirmations must be visible; never silently omit an ended assignment.
    const ended = await tx.$queryRaw<any[]>(Prisma.sql `SELECT id FROM calendar WHERE deleted_at IS NULL AND code IN (${Prisma.join(codes)}) AND start_time>=${p.from_date} AND start_time<${p.to_date} AND end_time<=${getVietnamWallClockDate()} AND COALESCE(lesson_status,0)<>1 ORDER BY id LIMIT 20001`);
    if (ended.length > 20000)
        fail('Kỳ vượt 20.000 lịch; thu hẹp khoảng', 422);
    for (const c of ended)
        if (!records.some(r => r.role === 'teacher' && r.sources.some(s => s.calendar_id === Number(c.id))))
            issues.push({ calendar_id: c.id, message: 'Buổi đã hết giờ chưa xác nhận công giáo viên' });
    for (const r of records) {
        if (r.outcome !== 'completed')
            continue;
        try {
            check(u, permission, allSources(r));
            if (allSources(r).some(c => !codes.includes(c)))
                fail('Kỳ chưa bao gồm mọi chương trình của công dạy chung', 422);
            if (r.salary_item && r.salary_item.period_id !== p.id)
                fail(`Công đã thuộc kỳ #${r.salary_item.period_id}`, 409);
            if (!r.teacher_profile_id)
                fail('Công chưa xác định người hưởng', 422);
            await fresh(tx, r);
            const snap = r.snapshot as any, primary = r.sources.find(s => (s.snapshot as any).code === r.billing_code)!.snapshot as any;
            const dimensions = { code: r.billing_code, teacher_profile_id: r.teacher_profile_id, role: r.role, subject: primary.subject, group_id: primary.group_id, grade: primary.grade,
                session_kind: r.session_kind, is_substitute: r.is_substitute, system_type: primary.system_type, calendar_source: /^feed-/i.test(r.billing_code) ? 'feed' : 'livestream' };
            const eligible = rates.filter(rate => rate.enabled && rate.valid_from <= r.service_date && (!rate.valid_to || rate.valid_to > r.service_date) && Object.entries(rate.dimensions as any).every(([k, v]) => v === (dimensions as any)[k]));
            const rate = resolveRate(eligible, dimensions, r.service_date), amount = calculateAmount(rate, r.actual_seconds, r.scheduled_seconds);
            items.push({ teaching_record_id: r.id, teacher_profile_id: r.teacher_profile_id!, rate_id: rate.id, amount,
                snapshot: json({ ...snap, record_id: r.id, record_version: r.version, service_date: r.service_date, role: r.role, session_kind: r.session_kind, is_substitute: r.is_substitute,
                    actual_seconds: r.actual_seconds, scheduled_seconds: r.scheduled_seconds, sources: r.sources.map(s => s.snapshot), source_hashes: r.sources.map(s => s.source_hash), rate, amount, calculator_version: '1', rounding: 'VND_HALF_UP_PER_ITEM' }) });
        }
        catch (e: any) {
            issues.push({ record_id: String(r.id), message: e.message });
        }
    }
    return { items, issues, total: items.reduce((s, i) => s.add(i.amount), new Prisma.Decimal(0)) };
};
export const previewPeriod = async (u: User, key: any) => transaction(async (tx) => { const p = await lockPeriod(tx, key, u, 'salary.period.calculate'); if (p.status !== 'draft')
    fail('Chỉ xem tính lại ở kỳ nháp', 409); return calculate(tx, p, u); });
export const recalculatePeriod = async (u: User, key: any, b: any) => transaction(async (tx) => {
    const p = await lockPeriod(tx, key, u, 'salary.period.calculate', integer(b.expected_version, 'Phiên bản', 1));
    if (p.status !== 'draft')
        fail('Chỉ tính lại kỳ nháp', 409);
    const result = await calculate(tx, p, u), before = await periodDetails(tx, p);
    await tx.salary_items.deleteMany({ where: { period_id: p.id } });
    for (const i of result.items)
        await tx.salary_items.create({ data: { ...i, period_id: p.id } });
    const snapshot = json({ issues: result.issues, calculated_at: new Date(), calculator_version: '1', base_total: result.total });
    const after = await tx.salary_periods.update({ where: { id: p.id }, data: { revision: { increment: 1 }, calculation_hash: hash({ items: result.items, snapshot }), snapshot } });
    await audit(tx, u, 'period', p.id, 'recalculate', before, await periodDetails(tx, after), text(b.reason, 'Lý do'), p.id);
    return periodDetails(tx, after);
});
export const changePeriod = async (u: User, key: any, action: string, b: any) => transaction(async (tx) => {
    const permission: Record<string, string> = { submit: 'salary.review', return: 'salary.review', approve: 'salary.approve', reopen: 'salary.reopen' };
    if (!permission[action])
        fail('Thao tác không hợp lệ');
    const p = await lockPeriod(tx, key, u, permission[action], integer(b.expected_version, 'Phiên bản', 1)), before = await periodDetails(tx, p);
    const next = stateAction(p.status, action, before.payments.length > 0);
    if (action === 'submit' || action === 'approve') {
        check(u, 'salary.view', p.scope as string[]);
        if (!p.calculation_hash || ((p.snapshot as any).issues ?? []).length)
            fail('Kỳ chưa tính hoặc còn lỗi đối soát', 409);
        if (b.calculation_hash !== p.calculation_hash)
            fail('Bản tính khác với dữ liệu đã review; tải lại', 409);
        if (!before.items.length && !before.adjustments.length)
            fail('Kỳ chưa có công hoặc khoản điều chỉnh', 409);
        for (const i of before.items) {
            const r = await tx.teaching_records.findUniqueOrThrow({ where: { id: i.teaching_record_id }, include: { sources: true } });
            await fresh(tx, r);
            if (r.status !== 'confirmed' || r.outcome !== 'completed' || r.version !== (i.snapshot as any).record_version)
                fail('Công đã thay đổi từ lần tính trước', 409);
        }
        const latest = await calculate(tx, p, u, permission[action]);
        if (latest.issues.length)
            fail('Nguồn công chưa đủ điều kiện; trả kỳ về nháp để tính lại', 409);
        const digest = (items: any[]) => hash(items.map(i => ({ record: String(i.teaching_record_id), amount: String(i.amount), snapshot: i.snapshot })).sort((a, b) => a.record.localeCompare(b.record)));
        if (digest(latest.items) !== digest(before.items))
            fail('Đơn giá hoặc danh sách công đã thay đổi; cần tính lại và review', 409);
        if (before.teachers.some(t => t.total.isNegative()))
            fail('Có khoản phải thu âm; xử lý đối soát trước khi chốt', 409);
    }
    const snapshot = { ...(p.snapshot as any), ...(action === 'approve' ? { approved_at: new Date().toISOString(), approved_by: u.username, approved_revision: p.revision, approved_totals: json(before.teachers) } : {}) };
    const updated = await tx.salary_periods.update({ where: { id: p.id }, data: { status: next, revision: { increment: 1 }, ...(action === 'reopen' ? { calculation_hash: null } : {}), snapshot: json(snapshot) } });
    await audit(tx, u, 'period', p.id, action, before, await periodDetails(tx, updated), text(b.reason, 'Lý do'), p.id);
    return periodDetails(tx, updated);
});
export const adjustment = async (u: User, key: any, b: any) => transaction(async (tx) => {
    const p = await lockPeriod(tx, key, u, 'salary.adjust', integer(b.expected_version, 'Phiên bản', 1));
    if (p.status !== 'draft')
        fail('Điều chỉnh trong kỳ nháp; kỳ chốt cần khoản hồi tố ở kỳ mới', 409);
    const teacher = numberId(b.teacher_profile_id);
    if (!await tx.teacher_profiles.findUnique({ where: { id: teacher } }))
        fail('Nhân sự không tồn tại');
    const code = text(b.code, 'Chương trình', 30);
    if (!(p.scope as string[]).includes(code))
        fail('Chương trình không thuộc kỳ');
    const kind = choice(b.kind, ['allowance', 'bonus', 'penalty', 'correction'], 'Loại điều chỉnh');
    let amount = money(b.amount, kind === 'correction');
    if (amount.isZero() || !amount.isInteger())
        fail('Khoản điều chỉnh VND phải là số nguyên khác 0');
    if (kind === 'penalty')
        amount = amount.negated();
    const source = b.source_item_id ? id(b.source_item_id) : null;
    if (source) {
        const i = await tx.salary_items.findUnique({ where: { id: source }, include: { period: true, record: { include: { sources: true } } } });
        if (!i)
            return fail('Không tìm thấy dòng lương gốc', 404);
        check(u, 'salary.adjust', i.period.scope as string[]);
        check(u, 'salary.adjust', allSources(i.record));
        if (!['approved', 'paid'].includes(i.period.status))
            fail('Chỉ hồi tố từ kỳ đã chốt');
    }
    const row = await tx.salary_adjustments.create({ data: { period_id: p.id, teacher_profile_id: teacher, code, kind, amount, reason: text(b.reason, 'Lý do'), source_item_id: source, created_by: u.username, created_at: new Date() } });
    await tx.salary_periods.update({ where: { id: p.id }, data: { revision: { increment: 1 }, calculation_hash: null } });
    await audit(tx, u, 'adjustment', row.id, 'create', null, row, row.reason, p.id);
    return row;
});
export const payment = async (u: User, key: any, b: any) => transaction(async (tx) => {
    const p = await lockPeriod(tx, key, u, 'salary.pay');
    check(u, 'salary.view', p.scope as string[]);
    const request = text(b.idempotency_key, 'Mã yêu cầu', 100), teacher = numberId(b.teacher_profile_id), amount = money(b.amount);
    const previous = await tx.salary_payments.findUnique({ where: { idempotency_key: request } });
    if (previous) {
        if (previous.period_id !== p.id || previous.teacher_profile_id !== teacher || !previous.amount.equals(amount) || previous.reference !== text(b.reference, 'Chứng từ', 150))
            fail('Mã thanh toán đã dùng với nội dung khác', 409);
        return previous;
    }
    if (!amount.isInteger())
        fail('Số tiền thanh toán VND phải là số nguyên');
    if (p.revision !== integer(b.expected_version, 'Phiên bản', 1))
        fail('Kỳ đã thay đổi', 409);
    if (p.status !== 'approved')
        fail('Chỉ thanh toán kỳ đã chốt', 409);
    const before = await periodDetails(tx, p), balance = before.teachers.find(t => t.id === teacher);
    if (!balance || amount.lte(0) || amount.gt(balance.unpaid))
        fail('Số tiền vượt dư phải trả hoặc không hợp lệ', 409);
    const reference = text(b.reference, 'Chứng từ', 150);
    if (await tx.salary_payments.findFirst({ where: { period_id: p.id, teacher_profile_id: teacher, reference } }))
        fail('Chứng từ này đã được ghi nhận cho nhân sự trong kỳ', 409);
    const row = await tx.salary_payments.create({ data: { period_id: p.id, teacher_profile_id: teacher, amount, reference: text(b.reference, 'Chứng từ', 150), idempotency_key: request, created_by: u.username, created_at: new Date() } });
    const done = await periodDetails(tx, p);
    await tx.salary_periods.update({ where: { id: p.id }, data: { revision: { increment: 1 }, status: done.teachers.every(t => t.unpaid.isZero()) ? 'paid' : 'approved' } });
    await audit(tx, u, 'payment', row.id, 'pay', before, row, text(b.reason, 'Lý do'), p.id);
    return row;
});
export const releaseItem = async (u: User, key: any, item: any, b: any) => transaction(async (tx) => {
    const p = await lockPeriod(tx, key, u, 'salary.period.calculate', integer(b.expected_version, 'Phiên bản', 1));
    if (p.status !== 'draft')
        fail('Chỉ loại công khỏi kỳ nháp', 409);
    const row = await tx.salary_items.findFirst({ where: { id: id(item), period_id: p.id } });
    if (!row)
        return fail('Không tìm thấy dòng công', 404);
    await tx.salary_items.delete({ where: { id: row.id } });
    await tx.salary_periods.update({ where: { id: p.id }, data: { revision: { increment: 1 }, calculation_hash: null } });
    await audit(tx, u, 'item', row.id, 'release', row, null, text(b.reason, 'Lý do'), p.id);
    return row;
});
export const history = async (u: User, key: any, q: any) => {
    const p = await prisma.salary_periods.findUnique({ where: { id: id(key) } });
    if (!p)
        return fail('Không tìm thấy kỳ', 404);
    check(u, 'salary.audit.view', p.scope as string[]);
    check(u, 'salary.view', p.scope as string[]);
    const rows = await prisma.salary_audit_logs.findMany({ where: { period_id: p.id }, orderBy: { id: 'desc' }, take: 5001 });
    if (rows.length > 5000)
        fail('Lịch sử quá lớn; cần truy vấn lưu trữ', 422);
    return paginate(json(rows), q, ['id', 'created_at'], 'id');
};
// Whole-period totals only: a partial program scope never receives a grand total.
export const overview = async (u: User, q: any) => {
    const allowed = scope(u, 'salary.view');
    const periods = await prisma.salary_periods.findMany({ where: { ...(q.from ? { from_date: { gte: day(q.from) } } : {}), ...(q.to ? { to_date: { lte: day(q.to) } } : {}) }, take: 5001, orderBy: { id: 'desc' } });
    if (periods.length > 5000)
        fail('Thu hẹp khoảng kỳ lương', 422);
    const visible = periods.filter(p => (p.scope as string[]).every(c => allowed === null || allowed.includes(c)) && (!q.code || (p.scope as string[]).includes(String(q.code))));
    const keys = visible.map(p => p.id);
    const [base, extra, paid] = keys.length ? await Promise.all([
        prisma.salary_items.groupBy({ by: ['period_id', 'teacher_profile_id'], where: { period_id: { in: keys } }, _sum: { amount: true } }),
        prisma.salary_adjustments.groupBy({ by: ['period_id', 'teacher_profile_id'], where: { period_id: { in: keys } }, _sum: { amount: true } }),
        prisma.salary_payments.groupBy({ by: ['period_id', 'teacher_profile_id'], where: { period_id: { in: keys } }, _sum: { amount: true } }),
    ]) : [[], [], []];
    const sums = (rows: typeof base, key: bigint) => rows.filter(r => r.period_id === key).reduce((s, r) => s.add(r._sum.amount ?? 0), new Prisma.Decimal(0));
    let estimated = new Prisma.Decimal(0), confirmed = new Prisma.Decimal(0), unpaid = new Prisma.Decimal(0);
    const teachers = new Map<number, Prisma.Decimal>();
    const rows = visible.map(p => {
        const total = sums(base, p.id).add(sums(extra, p.id)), payments = sums(paid, p.id);
        if (['approved', 'paid'].includes(p.status)) {
            confirmed = confirmed.add(total);
            unpaid = unpaid.add(total.sub(payments));
        }
        else
            estimated = estimated.add(total);
        for (const r of [...base, ...extra].filter(r => r.period_id === p.id))
            teachers.set(r.teacher_profile_id, (teachers.get(r.teacher_profile_id) ?? new Prisma.Decimal(0)).add(r._sum.amount ?? 0));
        return { id: String(p.id), name: p.name, status: p.status, total, paid: payments, unpaid: total.sub(payments), teachers: new Set([...base, ...extra].filter(r => r.period_id === p.id).map(r => r.teacher_profile_id)).size };
    });
    const profiles = await prisma.teacher_profiles.findMany({ where: { id: { in: [...teachers.keys()] } }, select: { id: true, display_name: true, username: true } });
    return { estimated, confirmed, unpaid, pending_review: visible.filter(p => p.status === 'pending_review').length, periods: rows,
        teachers: [...teachers].map(([key, amount]) => ({ id: key, name: profiles.find(p => p.id === key)?.display_name ?? profiles.find(p => p.id === key)?.username ?? String(key), amount: Number(amount) })), basis: 'whole_period_snapshot', generated_at: new Date().toISOString() };
};
