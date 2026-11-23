import { Prisma } from '@prisma/client';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { prisma, User, check, scope, allSources, transaction, calendars, audit } from './salary-common';
import { fail, id, numberId, integer, text, day, clock, choice, hash, json, sourceShape, paginate } from './salary-domain';
const matches = (u: User, p: string, codes: string[]) => { try {
    check(u, p, codes);
    return true;
}
catch {
    return false;
} };
export const resolveProfile = (profiles: any[], value: any) => {
    const key = String(value ?? '').trim().toLowerCase();
    if (!key)
        return null;
    const exact = profiles.filter(p => p.username.toLowerCase() === key);
    if (exact.length === 1)
        return exact[0];
    const names = profiles.filter(p => p.display_name?.trim().toLowerCase() === key);
    return names.length === 1 ? names[0] : null;
};
export const reportData = async (u: User, q: any) => {
    const from = day(q.from), to = day(q.to);
    if (from >= to || +to - +from > 367 * 86400000)
        fail('Chọn khoảng tối đa một năm, ngày kết thúc không bao gồm');
    const allowed = scope(u, 'teaching_report.view');
    const requestedRole=q.role?choice(q.role,['teacher','assistant'],'Vai trò'):undefined;
    const parts: Prisma.Sql[] = [Prisma.sql `c.deleted_at IS NULL AND c.start_time>=${from} AND c.start_time<${to}`];
    if (allowed !== null)
        parts.push(allowed.length ? Prisma.sql `c.code IN (${Prisma.join(allowed)})` : Prisma.sql `1=0`);
    if (q.code) {
        check(u, 'teaching_report.view', [text(q.code, 'Chương trình', 30)]);
        parts.push(Prisma.sql `c.code=${q.code}`);
    }
    if (q.subject)
        parts.push(Prisma.sql `c.subject=${text(q.subject, 'Môn', 100)}`);
    if (q.grade)
        parts.push(Prisma.sql `l.grade=${integer(q.grade, 'Khối', 1, 12)}`);
    if (q.system_type)
        parts.push(Prisma.sql `c.system_type=${choice(q.system_type, ['topclass', 'topuni', 'event', 'phaken'], 'Hệ')}`);
    if (q.source)
        parts.push(q.source === 'feed' ? Prisma.sql `c.code LIKE 'feed-%'` : q.source === 'livestream' ? Prisma.sql `c.code NOT LIKE 'feed-%'` : fail('Nguồn không hợp lệ'));
    const rawRows = await prisma.$queryRaw<any[]>(Prisma.sql `SELECT c.*,l.grade FROM calendar c LEFT JOIN lessons l ON l.id=c.session_id WHERE ${Prisma.join(parts, ' AND ')} ORDER BY c.start_time,c.id LIMIT 20001`);
    const rows = rawRows.map(c => ({ ...c, id: Number(c.id), group_id: c.group_id == null ? null : Number(c.group_id), grade: c.grade == null ? null : Number(c.grade) }));
    if (rows.length > 20000)
        fail('Báo cáo vượt 20.000 lịch; thu hẹp bộ lọc', 422);
    const groupIds = [...new Set<number>(rows.map(c => c.group_id).filter((v): v is number => v != null))];
    const groupRows = groupIds.length ? await prisma.$queryRaw<any[]>(Prisma.sql `SELECT id,group_code,name FROM learning_groups WHERE id IN (${Prisma.join(groupIds)})`) : [];
    const profiles = await prisma.teacher_profiles.findMany({ select: { id: true, username: true, display_name: true, can_view_stream_key: true, status: true } });
    const ids = rows.map(c => c.id);
    const records = ids.length ? await prisma.teaching_records.findMany({ where: { sources: { some: { calendar_id: { in: ids } } } }, include: { sources: true, salary_item: { include: { period: true } } } }) : [];
    const logs = ids.length ? await prisma.calendar_change_logs.findMany({ where: { code: { in: [...new Set<string>(rows.map(c => c.code))] }, action: { in: ['makeup', 'makeup_after_cancel'] } }, select: { id: true, after_data: true }, orderBy: { id: 'desc' }, take: 20001 }) : [];
    if (logs.length > 20000)
        fail('Lịch sử đối soát quá lớn; thu hẹp bộ lọc', 422);
    const makeup = new Set(logs.map(l => Number((l.after_data as any)?.created_session?.id)).filter(Boolean));
    const now = getVietnamWallClockDate();
    const recordsByCalendar = new Map<number, typeof records>();
    for (const record of records) {
        if (!matches(u, 'teaching_report.view', allSources(record)))
            continue;
        for (const source of record.sources) {
            const list = recordsByCalendar.get(source.calendar_id) ?? [];
            list.push(record);
            recordsByCalendar.set(source.calendar_id, list);
        }
    }
    let sessions = rows.map(c => {
        const assigned = resolveProfile(profiles, c.teacher);
        const assistants = Array.from(new Set(String(c.assistant_teacher ?? '').split(',').map((s: string) => s.trim()).filter(Boolean))).map(s => resolveProfile(profiles, s));
        const related = recordsByCalendar.get(c.id) ?? [];
        const progress = Number(c.lesson_status) === 1 ? 'cancelled' : c.start_time > now ? 'upcoming' : c.end_time > now ? 'ongoing' : 'ended';
        const issues: string[] = [];
        if (!assigned)
            issues.push('Chưa xác định duy nhất giáo viên');
        if (assistants.some(p => !p))
            issues.push('Trợ giảng cần đối soát');
        for (const r of related) {
            const s = r.sources.find(s => s.calendar_id === c.id)!;
            if (s.source_hash !== hash(sourceShape(c)))
                issues.push(`Công ${r.id} khác dữ liệu lịch hiện tại`);
        }
        return { id: c.id, calendar_id: c.id, code: c.code, group_id: c.group_id ?? null, group_label: c.group_id ? `${groupRows.find(g => Number(g.id) === c.group_id)?.group_code ?? ''} · ${groupRows.find(g => Number(g.id) === c.group_id)?.name ?? 'Nhóm học'}` : 'Chương trình 1–n', grade: c.grade,
            subject: c.subject, lesson_name: c.lesson_name, learn_number: c.learn_number, lesson_count: c.lesson_count, start_time: c.start_time, end_time: c.end_time,
            source_hash: hash(sourceShape(c)), scheduled_seconds: Math.max(0, (+c.end_time - +c.start_time) / 1000), teacher_profile_id: assigned?.id ?? null, teacher: assigned?.display_name ?? c.teacher,
            teacher_username: assigned?.username ?? null, assistant_ids: assistants.filter(Boolean).map(p => p.id), assistant_teacher: c.assistant_teacher,
            progress, session_kind: related[0]?.session_kind ?? (makeup.has(c.id) ? 'makeup' : 'unknown'), confirmation_status: related.some(r => r.role === 'teacher' && r.status === 'confirmed') ? 'confirmed' : 'unconfirmed',
            issues, record_ids: related.filter(r => r.role === 'teacher').map(r => String(r.id)), shared_candidate_ids: [] as number[] };
    });
    // Shared-schedule candidates are warnings, never automatic payroll merges.
    const byPerson = new Map<number, typeof sessions>();
    for (const row of sessions)
        if (row.teacher_profile_id) {
            const list = byPerson.get(row.teacher_profile_id) ?? [];
            list.push(row);
            byPerson.set(row.teacher_profile_id, list);
        }
    for (const list of byPerson.values())
        for (const row of list)
            row.shared_candidate_ids = list.filter(t => t.id !== row.id && +t.start_time < +row.end_time && +t.end_time > +row.start_time).map(t => t.id);
    if (q.teacher_id) {
        const key = numberId(q.teacher_id);
        sessions = sessions.filter(s => s.teacher_profile_id === key || records.some(r => r.teacher_profile_id === key && s.record_ids.includes(String(r.id))));
    }
    if (q.person_id) {
        const key = numberId(q.person_id);
        sessions = sessions.filter(s => s.teacher_profile_id === key || s.assistant_ids.includes(key) || (recordsByCalendar.get(s.id) ?? []).some(r => r.teacher_profile_id === key));
    }
    if (q.assistant_id)
        sessions = sessions.filter(s => s.assistant_ids.includes(numberId(q.assistant_id)));
    if (q.group_id)
        sessions = sessions.filter(s => s.group_id === numberId(q.group_id));
    if (q.progress)
        sessions = sessions.filter(s => s.progress === choice(q.progress, ['upcoming', 'ongoing', 'ended', 'cancelled'], 'Tiến độ'));
    if (q.session_kind)
        sessions = sessions.filter(s => s.session_kind === choice(q.session_kind, ['regular', 'makeup', 'additional', 'unknown'], 'Loại buổi'));
    if (q.confirmation_status)
        sessions = sessions.filter(s => s.confirmation_status === choice(q.confirmation_status, ['confirmed', 'unconfirmed'], 'Xác nhận'));
    const selected = new Set(sessions.map(s => s.id));
    let visible = records.filter(r => r.sources.some(s => selected.has(s.calendar_id)) && matches(u, 'teaching_report.view', allSources(r)));
    if (q.person_id || q.teacher_id)
        visible = visible.filter(r => r.teacher_profile_id === numberId(q.person_id ?? q.teacher_id));
    if (q.role)
        visible = visible.filter(r => r.role === choice(q.role, ['teacher', 'assistant'], 'Vai trò'));
    const recordRows = visible.map(r => {
        const snap = r.snapshot as any, stale = r.sources.some(s => { const row = rows.find(c => c.id === s.calendar_id); return row && s.source_hash !== hash(sourceShape(row)); });
        const safe = { ...json(r), sources: r.sources.map(s => ({ calendar_id: s.calendar_id, code: (s.snapshot as any).code })), salary_item: undefined, stale };
        delete safe.salary_item;
        // salary fields are never included in the teaching-only payload.
        return { ...safe, teacher: snap.teacher, eligible: r.status === 'confirmed' && r.outcome === 'completed' && !stale };
    });
    const completed = recordRows.filter(r => r.eligible);
    const teachers = profiles.filter(p => !q.person_id || p.id === numberId(q.person_id)).filter(p => sessions.some(s => s.teacher_profile_id === p.id || s.assistant_ids.includes(p.id)) || visible.some(r => r.teacher_profile_id === p.id)).map(p => {
        const assigned = sessions.filter(s => requestedRole==='teacher'?s.teacher_profile_id===p.id:requestedRole==='assistant'?s.assistant_ids.includes(p.id):s.teacher_profile_id === p.id || s.assistant_ids.includes(p.id)), taught = completed.filter(r => r.teacher_profile_id === p.id);
        return { id: p.id, username: p.username, name: p.display_name ?? p.username, assigned: assigned.length, completed: taught.length,
            actual_hours: taught.reduce((n, r) => n + r.actual_seconds / 3600, 0), scheduled_hours: assigned.reduce((n, s) => n + s.scheduled_seconds / 3600, 0),
            substitute: taught.filter(r => r.is_substitute).length, makeup: taught.filter(r => r.session_kind === 'makeup').length,
            groups: new Set(assigned.map(s => s.group_id ? `g${s.group_id}` : `c${s.code}`)).size, subjects: new Set(assigned.map(s => s.subject)).size };
    });
    return { sessions, records: recordRows, teachers:teachers.filter(t=>t.assigned||t.completed), summary: { assigned: sessions.length, completed: completed.length, upcoming: sessions.filter(s => s.progress === 'upcoming').length,
            ongoing: sessions.filter(s => s.progress === 'ongoing').length, cancelled: sessions.filter(s => s.progress === 'cancelled').length,
            needs_confirmation: sessions.filter(s => s.progress === 'ended' && (!s.record_ids.length || s.issues.length)).length,
            teacher_absent: visible.filter(r => r.outcome === 'teacher_absent' || (r.snapshot as any).planned_teacher_absent).length, substitute: completed.filter(r => r.is_substitute).length, makeup: completed.filter(r => r.session_kind === 'makeup').length,
            actual_hours: completed.reduce((n, r) => n + r.actual_seconds / 3600, 0), scheduled_hours: sessions.reduce((n, s) => n + s.scheduled_seconds / 3600, 0) },
        metadata: { from: q.from, to_exclusive: q.to, timezone: 'Asia/Ho_Chi_Minh', generated_at: new Date().toISOString(), limit: 20000, completion_basis: 'confirmed_teaching_record' } };
};
export const report = async (u: User, q: any) => {
    const data = await reportData(u, q);
    const collection = choice(q.collection ?? 'sessions', ['sessions', 'teachers', 'records'], 'Bảng');
    const sorts = collection === 'teachers' ? ['name', 'assigned', 'completed', 'actual_hours'] : collection === 'sessions' ? ['start_time', 'teacher', 'code', 'progress'] : ['id', 'service_date', 'teacher_profile_id'];
    const { summary, metadata } = data;
    const daily = Object.values(data.sessions.reduce((out: Record<string, any>, s) => { const date = s.start_time.toISOString().slice(0, 10); out[date] ??= { date, assigned: 0 }; out[date].assigned++; return out; }, {}));
    return { summary, metadata, charts: { daily }, collection, ...paginate(data[collection], q, sorts, sorts[0]) };
};
export const confirmTeaching = async (u: User, input: any, rawRecord?: unknown) => transaction(async (tx) => {
    const reason = text(input.reason, 'Lý do xác nhận'), ids = Array.from(new Set<number>((Array.isArray(input.calendar_ids) ? input.calendar_ids : []).map(numberId))).sort((a, b) => a - b);
    if (!ids.length || ids.length > 30)
        fail('Chọn từ 1 đến 30 lịch nguồn');
    const rows = await calendars(tx, ids, true);
    if (rows.length !== ids.length)
        fail('Có lịch không tồn tại', 404);
    const codes = [...new Set<string>(rows.map(c => c.code))];
    check(u, rawRecord ? 'teaching_record.revise' : 'teaching_record.confirm', codes);
    const role = choice(input.role, ['teacher', 'assistant'], 'Vai trò'), outcome = choice(input.outcome, ['completed', 'teacher_absent', 'not_held', 'cancelled'], 'Kết quả');
    const kind = choice(input.session_kind, ['regular', 'makeup', 'additional', 'unknown'], 'Loại buổi');
    const now = getVietnamWallClockDate();
    if (rows.some(c => c.deleted_at || c.end_time > now))
        fail('Chỉ xác nhận lịch chưa xóa và đã kết thúc', 409);
    if (outcome === 'completed' && rows.some(c => Number(c.lesson_status) === 1))
        fail('Lịch đã nghỉ/hủy không được xác nhận đã dạy', 409);
    if (outcome === 'completed' && kind === 'unknown')
        fail('Cần đối soát loại buổi trước khi xác nhận');
    const profiles = await tx.teacher_profiles.findMany();
    const teacher = input.teacher_profile_id ? profiles.find(p => p.id === numberId(input.teacher_profile_id)) : null;
    if (outcome === 'completed' && !teacher)
        fail('Chọn người dạy thực tế');
    if (teacher)
        await tx.$queryRaw `SELECT id FROM teacher_profiles WHERE id=${teacher.id} FOR UPDATE`;
    const planned = rows.map(c => resolveProfile(profiles, c.teacher));
    if (role === 'teacher' && planned.some(p => !p) && !input.identity_resolution)
        fail('Thiếu danh tính phân công; nhập căn cứ đối soát');
    if (role === 'assistant' && !teacher)
        fail('Cần chọn trợ giảng thực tế');
    const actualStart = outcome === 'completed' ? clock(input.actual_start_time) : null, actualEnd = outcome === 'completed' ? clock(input.actual_end_time) : null;
    if (actualStart && actualEnd && (actualEnd <= actualStart || actualEnd > now || +actualEnd - +actualStart > 12 * 3600000))
        fail('Khoảng thực dạy không hợp lệ (tối đa 12 giờ, đã kết thúc)');
    if (actualStart && actualEnd && rows.some(c => +actualStart >= +c.end_time || +actualEnd <= +c.start_time))
        fail('Khoảng thực dạy phải giao với khung lịch nguồn');
    if (rows.length > 1 && (!input.shared_confirmed || rows.some(c => +c.start_time !== +rows[0].start_time || +c.end_time !== +rows[0].end_time)))
        fail('Chỉ gộp lịch cùng khung giờ sau khi xác nhận dạy chung');
    const billing = text(input.billing_code ?? rows[0].code, 'Chương trình chịu chi phí', 30);
    if (!codes.includes(billing))
        fail('Chương trình chịu chi phí phải thuộc lịch nguồn');
    let before: any = null;
    if (rawRecord) {
        before = await tx.teaching_records.findUnique({ where: { id: id(rawRecord) }, include: { sources: true, salary_item: true } });
        if (!before)
            fail('Không tìm thấy công', 404);
        check(u, 'teaching_record.revise', allSources(before));
        if (before.salary_item)
            fail('Công đã thuộc kỳ lương; loại dòng khỏi kỳ nháp hoặc tạo điều chỉnh sau chốt', 409);
        if (before.version !== integer(input.expected_version, 'Phiên bản', 1))
            fail('Công đã thay đổi', 409);
    }
    const participant = role === 'teacher' ? 'primary' : `assistant:${teacher!.id}`;
    const links = await tx.teaching_record_sources.findMany({ where: { calendar_id: { in: ids }, participant_key: participant } });
    if (links.some(s => s.teaching_record_id !== before?.id))
        fail('Phân công đã có bản ghi công; sửa công hiện tại thay vì tạo trùng', 409);
    if (input.source_hashes && rows.some(c => input.source_hashes[String(c.id)] !== hash(sourceShape(c))))
        fail('Lịch đã thay đổi từ khi mở xác nhận', 409);
    // A person cannot receive two simultaneous services unless they are in this shared record.
    if (teacher && actualStart && actualEnd) {
        const others = await tx.teaching_records.findMany({ where: { teacher_profile_id: teacher.id, status: 'confirmed', outcome: 'completed', ...(before ? { id: { not: before.id } } : {}) } });
        if (others.some(r => { const s = r.snapshot as any; return s.actual_start_time < actualEnd.toISOString() && s.actual_end_time > actualStart.toISOString(); }))
            fail('Người dạy đã có công trùng giờ; đối soát dạy chung trước', 409);
    }
    let replaced: any = null;
    if (kind === 'makeup') {
        const logs = await tx.calendar_change_logs.findMany({ where: { code: { in: codes }, action: { in: ['makeup', 'makeup_after_cancel'] } }, orderBy: { id: 'desc' }, take: 20001 });
        const linked = logs.find(l => ids.includes(Number((l.after_data as any)?.created_session?.id)));
        const original = input.replaces_calendar_id ? numberId(input.replaces_calendar_id) : linked?.calendar_id;
        if (!original || ids.includes(Number(original)))
            fail('Buổi bù cần chỉ rõ lịch nghỉ gốc để tránh trả trùng');
        replaced = (await calendars(tx, [Number(original)], true))[0];
        if (!replaced || replaced.code !== billing || replaced.group_id !== rows[0].group_id || Number(replaced.lesson_status) !== 1)
            fail('Lịch gốc học bù phải là lịch nghỉ thuộc cùng chương trình/nhóm');
        check(u, rawRecord ? 'teaching_record.revise' : 'teaching_record.confirm', [replaced.code]);
        const paidOriginal = await tx.teaching_records.findFirst({ where: { outcome: 'completed', status: 'confirmed', sources: { some: { calendar_id: replaced.id } } } });
        if (paidOriginal)
            fail('Buổi gốc đã có công hoàn thành; cần đối soát trước khi xác nhận buổi thay thế', 409);
    }
    const primary = rows.find(c => c.code === billing)!;
    const snapshot = json({ teacher: teacher ? { id: teacher.id, username: teacher.username, name: teacher.display_name } : null, planned: planned.map(p => p ? { id: p.id, username: p.username, name: p.display_name } : null),
        actual_start_time: actualStart, actual_end_time: actualEnd, evidence: text(input.evidence, 'Căn cứ xác nhận', 2000), identity_resolution: input.identity_resolution ? text(input.identity_resolution, 'Căn cứ danh tính') : null,
        replaces_calendar_id: replaced?.id ?? null, replaced_source: replaced ? sourceShape(replaced) : null, replaced_source_hash: replaced ? hash(sourceShape(replaced)) : null, planned_teacher_absent: input.planned_teacher_absent === true, reason, shared_confirmed: rows.length > 1, source_ids: ids,
        code: billing, subject: primary.subject, grade: primary.grade, group_id: primary.group_id ?? null, system_type: primary.system_type, calendar_source: /^feed-/i.test(billing) ? 'feed' : 'livestream', lesson_name: primary.lesson_name });
    const data = { teacher_profile_id: teacher?.id ?? null, role, service_date: day((actualStart ?? primary.start_time).toISOString().slice(0, 10)), billing_code: billing, status: 'confirmed', outcome, session_kind: kind,
        is_substitute: role === 'teacher' && !!teacher && planned.some(p => p && p.id !== teacher.id), actual_seconds: actualStart && actualEnd ? Math.floor((+actualEnd - +actualStart) / 1000) : 0,
        scheduled_seconds: Math.floor((+primary.end_time - +primary.start_time) / 1000), snapshot, created_by: before?.created_by ?? u.username };
    const saved = before ? await tx.teaching_records.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 } } }) : await tx.teaching_records.create({ data });
    if (before)
        await tx.teaching_record_sources.deleteMany({ where: { teaching_record_id: saved.id } });
    for (const c of rows)
        await tx.teaching_record_sources.create({ data: { teaching_record_id: saved.id, calendar_id: c.id, participant_key: participant, source_hash: hash(sourceShape(c)), snapshot: sourceShape(c) } });
    await audit(tx, u, 'teaching_record', saved.id, before ? 'revise' : 'confirm', before, saved, reason);
    return saved;
});
