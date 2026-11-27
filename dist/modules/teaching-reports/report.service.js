"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.report = exports.reportData = exports.reportOptions = exports.resolveProfile = exports.resolveIdentity = void 0;
const client_1 = require("@prisma/client");
const lesson_repository_1 = require("../lessons/lesson.repository");
const dateTime_1 = require("../../utils/dateTime");
const report_common_1 = require("./report-common");
const report_domain_1 = require("./report-domain");
const report_domain_2 = require("./report-domain");
const identityKey = (value) => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const resolveIdentity = (profiles, value) => {
    const key = identityKey(value);
    if (!key)
        return { profile: null, status: 'missing' };
    const exact = profiles.filter(p => identityKey(p.username) === key);
    if (exact.length)
        return { profile: exact.length === 1 ? exact[0] : null, status: exact.length === 1 ? 'matched' : 'ambiguous' };
    const names = profiles.filter(p => identityKey(p.display_name) === key);
    if (names.length)
        return { profile: names.length === 1 ? names[0] : null, status: names.length === 1 ? 'matched' : 'ambiguous' };
    // Historical account names are a fallback; they must not override a current profile name.
    const aliases = profiles.filter(p => p.aliases?.some((name) => identityKey(name) === key));
    return { profile: aliases.length === 1 ? aliases[0] : null, status: aliases.length === 1 ? 'matched' : aliases.length ? 'ambiguous' : 'missing' };
};
exports.resolveIdentity = resolveIdentity;
const resolveProfile = (profiles, value) => (0, exports.resolveIdentity)(profiles, value).profile;
exports.resolveProfile = resolveProfile;
const loadProfiles = async () => {
    const profiles = await report_common_1.prisma.teacher_profiles.findMany({ select: { id: true, username: true, display_name: true, status: true }, orderBy: { display_name: 'asc' } });
    // Legacy calendars store full names while profiles often use display names such as “Cô Linh”.
    // Read aliases only from user accounts with the exact registered staff username.
    const accounts = profiles.length ? await report_common_1.prisma.$queryRaw(client_1.Prisma.sql `SELECT DISTINCT username,name FROM users WHERE username IN (${client_1.Prisma.join(profiles.map(p => p.username))}) AND name IS NOT NULL LIMIT 50001`) : [];
    if (accounts.length > 50000)
        (0, report_domain_1.fail)('Quá nhiều tên nhân sự lịch sử; cần thu hẹp dữ liệu đối chiếu', 422);
    const aliases = new Map();
    for (const account of accounts) {
        const key = identityKey(account.username), name = account.name.replace(/^(?:\s*\d+\s*-\s*)+/, '').trim();
        if (name) {
            const set = aliases.get(key) ?? new Set();
            set.add(name);
            aliases.set(key, set);
        }
    }
    return profiles.map(p => ({ ...p, aliases: [...(aliases.get(identityKey(p.username)) ?? [])] }));
};
const publicProfile = ({ aliases, ...profile }) => profile;
// Distinct assignment links keep filter choices independent of report pagination.
const reportOptions = async (u, q) => {
    const from = (0, report_domain_1.day)(q.from), to = (0, report_domain_1.day)(q.to);
    if (from >= to || +to - +from > 367 * 86400000)
        (0, report_domain_1.fail)('Chọn khoảng tối đa một năm, ngày kết thúc không bao gồm');
    const allowed = (0, report_common_1.scope)(u, 'teaching_report.view');
    const links = await report_common_1.prisma.$queryRaw(client_1.Prisma.sql `SELECT DISTINCT code,teacher,assistant_teacher,system_type FROM calendar WHERE deleted_at IS NULL AND start_time>=${from} AND start_time<${to} ${allowed === null ? client_1.Prisma.empty : allowed.length ? client_1.Prisma.sql `AND code IN (${client_1.Prisma.join(allowed)})` : client_1.Prisma.sql `AND 1=0`} ORDER BY code,teacher,assistant_teacher,system_type LIMIT 50001`);
    if (links.length > 50000)
        (0, report_domain_1.fail)('Quá nhiều phân công; thu hẹp khoảng ngày', 422);
    const profiles = await loadProfiles();
    const programMetadata = new Map((await (0, lesson_repository_1.findLessonProgramOptions)(allowed)).map(p => [p.subject_code, p]));
    const assignments = links.map(link => ({ code: link.code, system_type: link.system_type ?? null, has_teacher: Boolean(String(link.teacher ?? '').trim()), has_assistant: Boolean(String(link.assistant_teacher ?? '').split(',').some(v => v.trim())), subject: programMetadata.get(link.code)?.subject_name?.trim() || null, grade: programMetadata.get(link.code)?.grade == null ? null : Number(programMetadata.get(link.code).grade), teacher_id: (0, exports.resolveProfile)(profiles, link.teacher)?.id ?? null,
        assistant_ids: [...new Set(String(link.assistant_teacher ?? '').split(',').map(v => (0, exports.resolveProfile)(profiles, v.trim())?.id).filter((v) => v != null))] }));
    const teacherIds = new Set(assignments.map(a => a.teacher_id)), assistantIds = new Set(assignments.flatMap(a => a.assistant_ids));
    return { programs: [...new Set(assignments.map(a => a.code))], teachers: profiles.filter(p => teacherIds.has(p.id)).map(publicProfile), assistants: profiles.filter(p => assistantIds.has(p.id)).map(publicProfile), subjects: [...new Set(assignments.map(a => a.subject).filter((v) => !!v))].sort((a, b) => a.localeCompare(b, 'vi')), assignments };
};
exports.reportOptions = reportOptions;
const reportData = async (u, q) => {
    const from = (0, report_domain_1.day)(q.from), to = (0, report_domain_1.day)(q.to);
    if (from >= to || +to - +from > 367 * 86400000)
        (0, report_domain_1.fail)('Chọn khoảng tối đa một năm, ngày kết thúc không bao gồm');
    const allowed = (0, report_common_1.scope)(u, 'teaching_report.view');
    const hoursMode = (0, report_domain_1.choice)(q.hours_mode ?? 'union', ['union', 'per_assignment'], 'Cách tính giờ');
    const requestedRole = q.role ? (0, report_domain_1.choice)(q.role, ['teacher', 'assistant'], 'Vai trò') : undefined;
    const parts = [client_1.Prisma.sql `c.deleted_at IS NULL AND c.start_time>=${from} AND c.start_time<${to}`];
    if (allowed !== null)
        parts.push(allowed.length ? client_1.Prisma.sql `c.code IN (${client_1.Prisma.join(allowed)})` : client_1.Prisma.sql `1=0`);
    if (q.code) {
        (0, report_common_1.check)(u, 'teaching_report.view', [(0, report_domain_1.text)(q.code, 'Chương trình', 30)]);
        parts.push(client_1.Prisma.sql `c.code=${q.code}`);
    }
    // Use the same program metadata as curriculum management, rather than calendar's combined 'Môn + khối' label.
    const programMetadata = new Map((await (0, lesson_repository_1.findLessonProgramOptions)(allowed)).map(p => [p.subject_code, p]));
    if (q.subject || q.grade) {
        const subject = q.subject ? (0, report_domain_1.text)(q.subject, 'Môn', 100) : undefined;
        const grade = q.grade ? (0, report_domain_1.integer)(q.grade, 'Khối', 1, 12) : undefined;
        const codes = [...programMetadata.values()].filter(p => (!subject || p.subject_name?.trim() === subject) && (grade === undefined || Number(p.grade) === grade)).map(p => p.subject_code);
        parts.push(codes.length ? client_1.Prisma.sql `c.code IN (${client_1.Prisma.join(codes)})` : client_1.Prisma.sql `1=0`);
    }
    if (q.system_type)
        parts.push(client_1.Prisma.sql `c.system_type=${(0, report_domain_1.choice)(q.system_type, ['topclass', 'topuni', 'event', 'phaken'], 'Hệ')}`);
    if (q.source)
        parts.push(q.source === 'feed' ? client_1.Prisma.sql `c.code LIKE 'feed-%'` : q.source === 'livestream' ? client_1.Prisma.sql `c.code NOT LIKE 'feed-%'` : (0, report_domain_1.fail)('Nguồn không hợp lệ'));
    const rawRows = await report_common_1.prisma.$queryRaw(client_1.Prisma.sql `SELECT c.*,l.grade FROM calendar c LEFT JOIN lessons l ON l.id=c.session_id WHERE ${client_1.Prisma.join(parts, ' AND ')} ORDER BY c.start_time,c.id LIMIT 20001`);
    const rows = rawRows.map(c => ({ ...c, id: Number(c.id), group_id: c.group_id == null ? null : Number(c.group_id), grade: c.grade == null ? null : Number(c.grade) }));
    if (rows.length > 20000)
        (0, report_domain_1.fail)('Báo cáo vượt 20.000 lịch; thu hẹp bộ lọc', 422);
    const profiles = await loadProfiles();
    const now = (0, dateTime_1.getVietnamWallClockDate)();
    let sessions = rows.map(c => {
        const teacherIdentity = (0, exports.resolveIdentity)(profiles, c.teacher), teacher = teacherIdentity.profile;
        const assistantKeys = [...new Set(String(c.assistant_teacher ?? '').split(',').map(v => v.trim()).filter(Boolean))];
        const assistants = assistantKeys.map(v => (0, exports.resolveProfile)(profiles, v));
        const progress = Number(c.lesson_status) === 1 ? 'cancelled' : c.start_time > now ? 'upcoming' : c.end_time > now ? 'ongoing' : 'ended';
        return { id: c.id, calendar_id: c.id, code: c.code, lesson_name: c.lesson_name,
            subject: programMetadata.get(c.code)?.subject_name?.trim() || c.subject, grade: programMetadata.get(c.code)?.grade ?? c.grade,
            start_time: c.start_time, end_time: c.end_time, scheduled_seconds: Math.max(0, (+c.end_time - +c.start_time) / 1000), progress,
            teacher_profile_id: teacher?.id ?? null, teacher: teacher?.display_name ?? c.teacher, teacher_username: teacher?.username ?? null,
            assistant_ids: assistants.filter(Boolean).map(p => p.id), assistant_teacher: assistantKeys.map((value, index) => assistants[index]?.display_name?.trim() || assistants[index]?.username || value).join(', ') || null,
            overlaps: [],
            issues: [...(!teacher ? [teacherIdentity.status === 'ambiguous' ? 'Tên giáo viên khớp nhiều hồ sơ' : String(c.teacher ?? '').trim() ? 'Tên giáo viên chưa khớp hồ sơ nhân sự' : 'Lịch chưa phân công giáo viên'] : []), ...(assistants.some(p => !p) ? ['Trợ giảng chưa khớp hồ sơ'] : [])] };
    });
    if (q.teacher_id)
        sessions = sessions.filter(s => s.teacher_profile_id === (0, report_domain_1.numberId)(q.teacher_id));
    if (q.assistant_id)
        sessions = sessions.filter(s => s.assistant_ids.includes((0, report_domain_1.numberId)(q.assistant_id)));
    if (requestedRole === 'teacher')
        sessions = sessions.filter(s => String(s.teacher ?? '').trim());
    if (requestedRole === 'assistant')
        sessions = sessions.filter(s => String(s.assistant_teacher ?? '').trim());
    if (q.person_id)
        sessions = sessions.filter(s => (requestedRole !== 'assistant' && s.teacher_profile_id === (0, report_domain_1.numberId)(q.person_id)) || (requestedRole !== 'teacher' && s.assistant_ids.includes((0, report_domain_1.numberId)(q.person_id))));
    if (q.progress)
        sessions = sessions.filter(s => s.progress === (0, report_domain_1.choice)(q.progress, ['upcoming', 'ongoing', 'ended', 'cancelled'], 'Tiến độ'));
    const sessionById = new Map(sessions.map(s => [s.id, s]));
    const hours = (items) => (hoursMode === 'union' ? (0, report_domain_2.intervalSeconds)(items) : items.reduce((n, s) => n + s.scheduled_seconds, 0)) / 3600;
    const teachers = profiles.flatMap(p => {
        if (q.person_id && p.id !== (0, report_domain_1.numberId)(q.person_id))
            return [];
        return ['teacher', 'assistant'].filter(role => !requestedRole || role === requestedRole).flatMap(role => {
            const assigned = sessions.filter(s => role === 'teacher' ? s.teacher_profile_id === p.id : s.assistant_ids.includes(p.id));
            if (!assigned.length)
                return [];
            const active = assigned.filter(s => s.progress !== 'cancelled'), ended = active.filter(s => s.progress === 'ended');
            const conflicts = (0, report_domain_2.scheduleOverlaps)(active);
            for (const s of active) {
                const overlap = conflicts.get(s.id);
                if (overlap?.count)
                    s.overlaps.push({ person_id: p.id, name: p.display_name || p.username, role, ...overlap, calendars: overlap.calendar_ids.map(id => { const other = sessionById.get(id); return { id: other.id, code: other.code, start_time: other.start_time, end_time: other.end_time }; }) });
            }
            return [{ id: `${p.id}:${role}`, teacher_profile_id: p.id, username: p.username, name: p.display_name || p.username, role,
                    assigned: assigned.length, ended: ended.length, upcoming: active.filter(s => s.progress === 'upcoming').length,
                    cancelled: assigned.filter(s => s.progress === 'cancelled').length,
                    scheduled_hours: hours(active), ended_hours: hours(ended),
                    overlapping_calendars: active.filter(s => (conflicts.get(s.id)?.count ?? 0) > 0).length,
                    programs: new Set(assigned.map(s => s.code)).size, subjects: new Set(assigned.map(s => s.subject)).size }];
        });
    });
    const active = sessions.filter(s => s.progress !== 'cancelled');
    return { sessions, teachers, summary: { assigned: sessions.length, ended: sessions.filter(s => s.progress === 'ended').length,
            upcoming: sessions.filter(s => s.progress === 'upcoming').length, ongoing: sessions.filter(s => s.progress === 'ongoing').length,
            cancelled: sessions.filter(s => s.progress === 'cancelled').length, scheduled_hours: active.reduce((n, s) => n + s.scheduled_seconds / 3600, 0),
            ended_hours: active.filter(s => s.progress === 'ended').reduce((n, s) => n + s.scheduled_seconds / 3600, 0),
            teacher_hours: teachers.filter(t => t.role === 'teacher').reduce((n, t) => n + t.ended_hours, 0),
            assistant_hours: teachers.filter(t => t.role === 'assistant').reduce((n, t) => n + t.ended_hours, 0) },
        metadata: { from: q.from, to_exclusive: q.to, timezone: 'Asia/Ho_Chi_Minh', generated_at: new Date().toISOString(), duration_basis: 'calendar_schedule', hours_mode: hoursMode, personnel_overlap: hoursMode === 'union' ? 'union_per_person_and_role' : 'sum_per_assignment', overlap_scope: 'filtered_report', overlap_examples_limit: 5 } };
};
exports.reportData = reportData;
const report = async (u, q) => {
    const data = await (0, exports.reportData)(u, q);
    const collection = (0, report_domain_1.choice)(q.collection ?? 'sessions', ['sessions', 'teachers'], 'Bảng');
    const sorts = collection === 'teachers' ? ['name', 'assigned', 'ended', 'scheduled_hours', 'ended_hours'] : ['start_time', 'teacher', 'code', 'progress'];
    const daily = Object.values(data.sessions.reduce((out, s) => { const date = s.start_time.toISOString().slice(0, 10); out[date] ??= { date, assigned: 0 }; out[date].assigned++; return out; }, {}));
    const personnel = (role) => data.teachers.filter(row => row.role === role).map(({ id, teacher_profile_id, name, username, assigned, scheduled_hours, ended_hours }) => ({ id, teacher_profile_id, name, username, assigned, scheduled_hours, ended_hours }));
    return { summary: data.summary, metadata: data.metadata, charts: { daily, teachers: personnel('teacher'), assistants: personnel('assistant') }, collection, ...(0, report_domain_1.paginate)(data[collection], q, sorts, sorts[0]) };
};
exports.report = report;
