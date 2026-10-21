import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import { buildCalendarRoomClassId } from './calendar-user-sync.service';
import { createAttendanceCounter, groupReportWindows, loadReportWindows, type ReportActivity, type ReportEnrollment, type ReportWindow } from './calendar-room-report.service';
import { cursorScope, decodeDetailCursor, encodeDetailCursor, type DetailFilters } from './calendar-detail-report.validation';

export type DetailCapabilities = { chat: boolean; moderation: boolean; activities: boolean };
const normalize = (value: string | null | undefined) => (value || '').trim().toLowerCase();
export const DETAIL_LIMITATIONS = [
  'Chuyên cần giữ quy tắc hai status=2 liên tiếp trong cùng phiên; join lại hoặc trạng thái khác ngắt chuỗi.',
  'Mốc đầu/cuối là thời điểm log được ghi nhận. Chưa đủ dữ liệu xác định giờ rời lớp, số phút học hoặc số lần kết nối lại.',
  'Roster và phân phòng là dữ liệu hiện lưu/lịch sử phân bổ, không phải bằng chứng đã vào phòng. Log chuyên cần không có room.',
  'Chat học sinh chỉ đếm role student, loại 1/2 và HMID khớp roster; loại broadcast/quiz không được cộng vào chỉ số này.',
  'Hạn chế chat là bản ghi hiện lưu, không phải toàn bộ lịch sử cấm/mở cấm. Không suy diễn actor từ cột user hoặc mở cấm từ updated_at.',
];
type Candidate = { user_id: number; username: string; name: string; student_hmid: string | null; email: string | null; room_id: number | null; belongs_to_calendar: number | bigint };
export type DetailStudent = Omit<Candidate, 'belongs_to_calendar' | 'email'> & {
  attendance: 'attended' | 'observed' | 'unobserved'; first_seen: string | null; last_seen: string | null;
  presence_records: number; status_1_records: number; socket_ids_count: number;
  duration_minutes: null; last_leave: null; reconnect_count: null;
  chat_count: number | null; moderation_records: number | null;
};
type Context = { calendar: NonNullable<Awaited<ReturnType<typeof prisma.calendar.findUnique>>>; windows: ReportWindow[]; roster: Candidate[]; overlapping_calendar_ids: number[] };
type Snapshot = { context: Context; students: DetailStudent[]; computed_at: string; unmatched_presence_records: number; hidden_rules_available: boolean | null; unmatched_chat_messages: number | null; ambiguous_chat_messages: number | null };
type Presence = ReportActivity & { session_id: string | null };
export type DetailEvent = { id: string; source: string; source_rank: number; at: string; username: string | null; student_hmid: string | null; room: string | null; content: string | null; metadata: Record<string, unknown>; identity: 'matched' | 'unmatched' | 'ambiguous'; student_ids: number[] };
type RawEvent = { id: bigint | number; at: Date; username: string | null; student_hmid: string | null; room: string | null; content: string | null; metadata: unknown };
const missingHiddenTable = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError
  && (e.code === 'P2021' || (e.code === 'P2010' && String(e.meta?.code) === '1146'));
const timeSql = (windows: ReportWindow[], field: Prisma.Sql, filters?: Pick<DetailFilters, 'from' | 'to'>) => {
  const ranges = windows.map(w => ({ from: new Date(Math.max(w.from.getTime(), filters?.from?.getTime() ?? -Infinity)), to: new Date(Math.min(w.to.getTime(), filters?.to?.getTime() ?? Infinity)) })).filter(w => w.from < w.to);
  return ranges.length ? Prisma.sql`(${Prisma.join(ranges.map(w => Prisma.sql`(${field} >= ${w.from} AND ${field} < ${w.to})`), ' OR ')})` : Prisma.sql`1=0`;
};
const classSql = (context: Context, field: Prisma.Sql, room: DetailFilters['room']) => {
  const c = context.calendar;
  if (room != null) return Prisma.sql`${field} = ${buildCalendarRoomClassId(c.code, c.start_time, c.learn_number, room)}`;
  const prefix = buildCalendarRoomClassId(c.code, c.start_time, c.learn_number, 1).slice(0, -1);
  if (room === null) return Prisma.sql`${field} = ${buildCalendarRoomClassId(c.code, c.start_time, c.learn_number, 1)}`;
  // Accept a canonical positive room suffix only; room 1 never matches room 10.
  const suffix = Prisma.sql`SUBSTRING(${field}, ${prefix.length + 1})`;
  return Prisma.sql`(${suffix} REGEXP '^[1-9][0-9]*$' AND BINARY ${field} = BINARY CONCAT(${prefix}, CAST(CAST(${suffix} AS UNSIGNED) AS CHAR)))`;
};


/** Read-only, single-calendar report. No callback/quiz/chat joins against attendance rows. */
export const createCalendarDetailReportService = (client = prisma) => {
  let activeBuilds = 0;
  const cache = new Map<string, { expires: number; promise: Promise<Snapshot> }>();
  const contexts = new Map<number, { expires: number; promise: Promise<Context> }>();
  const loadContext = async (calendarId: number): Promise<Context> => {
    const calendar = await client.calendar.findUnique({ where: { id: calendarId } });
    if (!calendar) throw new ApiError('Không tìm thấy lịch học', 404);
    const prefix = buildCalendarRoomClassId(calendar.code, calendar.start_time, calendar.learn_number, 1).slice(0, -1);
    const [windows, candidates, staff, overlapping] = await Promise.all([
      loadReportWindows([calendar], client),
      client.$queryRaw<Candidate[]>(Prisma.sql`
        WITH assignments AS (
          SELECT user_id, new_room_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
          FROM classroom_assignment_history WHERE calendar_id = ${calendarId}
        )
        SELECT s.id AS user_id, s.username, s.name, s.student_hmid, s.email,
          COALESCE(a.new_room_id, CASE WHEN s.room_id > 0 AND s.class_id = CONCAT(${prefix}, s.room_id) THEN s.room_id ELSE NULL END) AS room_id,
          CASE WHEN a.user_id IS NOT NULL OR s.class_id = CONCAT(${prefix}, CASE WHEN s.room_id > 0 THEN s.room_id ELSE 1 END) THEN 1 ELSE 0 END AS belongs_to_calendar
        FROM users s LEFT JOIN assignments a ON a.user_id = s.id AND a.rn = 1
        WHERE s.code = ${calendar.code} AND s.learn_number = ${calendar.learn_number}
      `),
      client.teacher_profiles.findMany({ select: { username: true, student_hmid: true } }),
      client.calendar.findMany({ where: { id: { not: calendarId }, code: calendar.code, learn_number: calendar.learn_number, start_time: { lt: calendar.end_time }, end_time: { gt: calendar.start_time } }, select: { id: true } }),
    ]);
    const staffNames = new Set([...staff.map(s => normalize(s.username)), normalize(calendar.teacher), ...(calendar.assistant_teacher || '').split(',').map(normalize)]);
    const staffIds = new Set(staff.map(s => normalize(s.student_hmid)).filter(Boolean));
    const roster = candidates.filter(s => Boolean(s.belongs_to_calendar) && !staffNames.has(normalize(s.username)) && !staffIds.has(normalize(s.student_hmid)))
      .map(s => ({ ...s, user_id: Number(s.user_id), room_id: s.room_id == null ? null : Number(s.room_id) }));
    const span = windows.reduce((sum, w) => sum + Math.max(0, w.to.getTime() - w.from.getTime()), 0);
    if (span > 72 * 3600000) throw new ApiError('Phạm vi phiên vượt 72 giờ; cần kiểm tra dữ liệu lịch trước khi xem chi tiết', 422);
    if (roster.length > 30000) throw new ApiError('Lớp vượt giới hạn 30.000 học sinh của báo cáo chi tiết', 422);
    return { calendar, windows, roster, overlapping_calendar_ids: overlapping.map(c => c.id) };
  };
  const context = (id: number) => {
    const old = contexts.get(id);
    if (old && old.expires > Date.now()) return old.promise;
    for (const [key, value] of contexts) if (value.expires <= Date.now()) contexts.delete(key);
    while (contexts.size >= 20) contexts.delete(contexts.keys().next().value!);
    const promise = loadContext(id), entry = { expires: Date.now() + 120000, promise };
    promise.then(() => { entry.expires = Date.now() + 30000; }, () => {});
    contexts.set(id, entry);
    promise.catch(() => { if (contexts.get(id) === entry) contexts.delete(id); });
    return promise;
  };
  const buildSnapshot = async (calendarId: number, room: DetailFilters['room'], caps: DetailCapabilities): Promise<Snapshot> => {
    const ctx = await context(calendarId);
    const roster = ctx.roster.filter(s => room === undefined || s.room_id === room);
    const enrollments: ReportEnrollment[] = ctx.windows.flatMap(w => roster.map(s => ({ ...s, window_id: w.key })));
    const observations = new Map<number, { first: Date; last: Date; ids: Set<string>; status1: number; sockets: Set<string> }>();
    const rosterNames = new Set(ctx.roster.map(s => normalize(s.username)));
    const rosterHmids = new Set(ctx.roster.map(s => normalize(s.student_hmid)).filter(Boolean));
    let unmatchedRecords = 0;
    const counter = createAttendanceCounter(enrollments, (s, activity) => {
      const a = activity as Presence;
      const key = `${a.activity_id}:${a.created_at.toISOString()}`;
      const current = observations.get(s.user_id) || { first: a.created_at, last: a.created_at, ids: new Set<string>(), status1: 0, sockets: new Set<string>() };
      if (current.ids.has(key)) return;
      current.ids.add(key);
      if (a.created_at < current.first) current.first = a.created_at;
      if (a.created_at > current.last) current.last = a.created_at;
      if (a.status === 1) current.status1++;
      if (a.session_id) current.sockets.add(a.session_id);
      observations.set(s.user_id, current);
    });
    let records = 0;
    for (const group of groupReportWindows(ctx.windows)) {
      const chunks: Array<{ from: Date; to: Date }> = [];
      for (let start = group.from.getTime(); start < group.to.getTime(); start += 3600000)
        chunks.push({ from: new Date(start), to: new Date(Math.min(start + 3600000, group.to.getTime())) });
      // At most two reads in parallel. Consume chronologically; never join heartbeat chains across sessions.
      for (let offset = 0; offset < chunks.length; offset += 2) {
        const batches = await Promise.all(chunks.slice(offset, offset + 2).map(({ from, to }) => client.$queryRaw<Presence[]>(Prisma.sql`
          SELECT id AS activity_id, created_at, status, username,
            TRIM(SUBSTRING_INDEX(name, ' - ', 1)) AS student_hmid, session_id
          FROM users_logs WHERE code = ${ctx.calendar.code} AND learn_number = ${ctx.calendar.learn_number}
            AND created_at >= ${from} AND created_at < ${to} AND ${timeSql(group.windows, Prisma.sql`created_at`)}
          ORDER BY created_at, id LIMIT 200001
        `)));
        for (const logs of batches) {
          unmatchedRecords += logs.filter(a => !rosterNames.has(normalize(a.username)) && !rosterHmids.has(normalize(a.student_hmid ?? a.name?.split(' - ')[0]))).length;
          records += logs.length;
          if (records > 200000) throw new ApiError('Buổi học vượt 200.000 log; hãy kiểm tra phạm vi dữ liệu', 422);
          counter.add(logs.flatMap(a => group.windows.filter(w => a.created_at >= w.from && a.created_at < w.to).map(w => ({ ...a, window_id: w.key }))));
        }
      }
    }
    const attended = new Set(counter.attendedEnrollments().map(s => s.user_id));
    const chatCounts = new Map<string, number>();
    if (caps.chat) {
      const rows = await client.$queryRaw<Array<{ hmid: string; count: bigint }>>(Prisma.sql`
        SELECT CAST(user_hmid AS CHAR) AS hmid, COUNT(*) AS count FROM logs_chat_new
        WHERE code = ${ctx.calendar.code} AND learn_number = ${ctx.calendar.learn_number}
          AND ${timeSql(ctx.windows, Prisma.sql`mess_time`)} AND ${classSql(ctx, Prisma.sql`classroom_id`, room)}
          AND LOWER(TRIM(user_role)) = 'student' AND mess_type IN (1, 2) GROUP BY user_hmid
      `);
      rows.forEach(r => chatCounts.set(normalize(r.hmid), Number(r.count)));
    }
    const restrictions = new Map<number, number>();
    let hiddenAvailable: boolean | null = caps.moderation ? true : null;
    if (caps.moderation) {
      const byRestrictionIdentity = new Map<string, Set<number>>();
      const byHmid = new Map<string, Set<number>>();
      for (const s of roster) {
        for (const value of [s.student_hmid, s.email]) {
          const key = normalize(value);
          if (!key) continue;
          const ids = byRestrictionIdentity.get(key) || new Set<number>(); ids.add(s.user_id); byRestrictionIdentity.set(key, ids);
        }
        const hmid = normalize(s.student_hmid);
        if (hmid) { const ids = byHmid.get(hmid) || new Set<number>(); ids.add(s.user_id); byHmid.set(hmid, ids); }
      }
      const blocks = await client.users_block.findMany({ where: { code: ctx.calendar.code, learn_number: ctx.calendar.learn_number }, select: { user_id: true } });
      for (const b of blocks) for (const id of byRestrictionIdentity.get(normalize(b.user_id)) || []) restrictions.set(id, (restrictions.get(id) || 0) + 1);
      try {
        const rules = await client.$queryRaw<Array<{ user_hmid: string | null; count: bigint }>>(Prisma.sql`
          SELECT user_hmid, COUNT(*) AS count FROM chat_hidden_rules
          WHERE code = ${ctx.calendar.code} AND learn_number = ${ctx.calendar.learn_number}
            AND ${classSql(ctx, Prisma.sql`classroom_id`, room)}
            AND (${timeSql(ctx.windows, Prisma.sql`created_at`)} OR ${timeSql(ctx.windows, Prisma.sql`restored_at`)}) GROUP BY user_hmid
        `);
        for (const r of rules) for (const id of byHmid.get(normalize(r.user_hmid)) || []) restrictions.set(id, (restrictions.get(id) || 0) + Number(r.count));
      } catch (e) { if (!missingHiddenTable(e)) throw e; hiddenAvailable = false; }
    }
    const hmidUses = new Map<string, number>();
    for (const s of ctx.roster) if (normalize(s.student_hmid)) hmidUses.set(normalize(s.student_hmid), (hmidUses.get(normalize(s.student_hmid)) || 0) + 1);
    return {
      unmatched_chat_messages: caps.chat ? [...chatCounts].reduce((n, [hmid, count]) => n + (hmidUses.has(hmid) ? 0 : count), 0) : null,
      ambiguous_chat_messages: caps.chat ? [...chatCounts].reduce((n, [hmid, count]) => n + ((hmidUses.get(hmid) || 0) > 1 ? count : 0), 0) : null,
      context: ctx, computed_at: new Date().toISOString(), unmatched_presence_records: unmatchedRecords, hidden_rules_available: hiddenAvailable,
      students: roster.map(s => {
        const o = observations.get(s.user_id);
        const { email: _email, belongs_to_calendar: _belongs, ...identity } = s;
        return { ...identity, attendance: attended.has(s.user_id) ? 'attended' : o ? 'observed' : 'unobserved', first_seen: o?.first.toISOString() ?? null, last_seen: o?.last.toISOString() ?? null,
          presence_records: o?.ids.size ?? 0, status_1_records: o?.status1 ?? 0, socket_ids_count: o?.sockets.size ?? 0,
          duration_minutes: null, last_leave: null, reconnect_count: null,
          chat_count: caps.chat && (hmidUses.get(normalize(s.student_hmid)) || 0) <= 1 ? chatCounts.get(normalize(s.student_hmid)) || 0 : null,
          moderation_records: caps.moderation && hiddenAvailable ? restrictions.get(s.user_id) || 0 : null };
      }),
    };
  };
  const snapshot = (id: number, f: DetailFilters, caps: DetailCapabilities) => {
    const key = JSON.stringify([id, f.room === undefined ? 'all' : f.room, caps]);
    const entry = cache.get(key);
    if (!f.refresh && entry && entry.expires > Date.now()) return entry.promise;
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
    while (cache.size >= 20) cache.delete(cache.keys().next().value!);
    if (f.refresh) contexts.delete(id);
    if (activeBuilds >= 3) throw new ApiError('Đang xử lý nhiều báo cáo chi tiết, vui lòng thử lại sau ít giây', 503);
    activeBuilds++;
    const promise = buildSnapshot(id, f.room, caps).finally(() => { activeBuilds--; });
    const value = { promise, expires: Date.now() + 120000 };
    promise.then(() => { value.expires = Date.now() + 30000; }, () => {});
    cache.set(key, value);
    promise.catch(() => { if (cache.get(key) === value) cache.delete(key); });
    return promise;
  };
  const overview = (s: Snapshot, caps: DetailCapabilities) => ({
    calendar: { id: s.context.calendar.id, code: s.context.calendar.code, learn_number: s.context.calendar.learn_number,
      lesson_name: s.context.calendar.lesson_name, teacher: s.context.calendar.teacher, assistant_teacher: s.context.calendar.assistant_teacher,
      start_time: s.context.calendar.start_time.toISOString(), end_time: s.context.calendar.end_time.toISOString() },
    computed_at: s.computed_at, capabilities: caps,
    counts: { added: s.students.length, attended: s.students.filter(s => s.attendance === 'attended').length,
      observed: s.students.filter(s => s.attendance === 'observed').length, unobserved: s.students.filter(s => s.attendance === 'unobserved').length,
      chat_messages: caps.chat ? s.students.reduce((n, s) => n + (s.chat_count || 0), 0) : null, students_with_chat: caps.chat ? s.students.filter(s => s.chat_count).length : null,
      banned_students: null, ban_events: null, join_count: null, leave_count: null, reconnect_count: null },
    rooms: [...new Set(s.context.roster.map(s => s.room_id))].sort((a, b) => a == null ? 1 : b == null ? -1 : a - b),
    data_quality: { limitations: DETAIL_LIMITATIONS, hidden_rules_available: s.hidden_rules_available,
      unmatched_presence_records: s.unmatched_presence_records, unmatched_chat_messages: s.unmatched_chat_messages, ambiguous_chat_messages: s.ambiguous_chat_messages, presence_room_evidence: 'assigned_roster_only',
      overlapping_calendar_ids: s.context.overlapping_calendar_ids, enrollment_snapshot: false, ambiguous_chat_student_ids: caps.chat ? s.students.filter(s => s.chat_count === null).map(s => s.user_id) : [] },
  });
  const students = async (id: number, f: DetailFilters, caps: DetailCapabilities, exportAll = false) => {
    if ((f.chat !== 'all' || f.sort === 'chat_count') && !caps.chat) throw new ApiError('Không có quyền xem chat', 403);
    if (f.moderation !== 'all' && !caps.moderation) throw new ApiError('Không có quyền xem kiểm duyệt', 403);
    const s = await snapshot(id, f, caps);
    if (f.moderation !== 'all' && s.hidden_rules_available === false) throw new ApiError('Thiếu nguồn kiểm duyệt, chưa thể lọc đầy đủ', 422);
    const rows = filterDetailStudents(s.students, f);
    if (exportAll && rows.length > 20000) throw new ApiError('Excel vượt giới hạn 20.000 học sinh; hãy thu hẹp bộ lọc', 422);
    return { ...overview(s, caps), total: rows.length, page: f.page, limit: f.limit,
      rows: exportAll ? rows : rows.slice((f.page - 1) * f.limit, f.page * f.limit) };
  };
  const student = async (id: number, studentId: number, f: DetailFilters, caps: DetailCapabilities) => {
    const s = await snapshot(id, f, caps);
    const row = s.students.find(s => s.user_id === studentId);
    if (!row) throw new ApiError('Học sinh không thuộc phạm vi lịch/room này', 404);
    let restriction_records: unknown[] | null = null;
    if (caps.moderation) {
      const identity = s.context.roster.find(s => s.user_id === studentId)!;
      const ids = [identity.student_hmid, identity.email].filter((v): v is string => Boolean(v));
      restriction_records = ids.length ? await client.users_block.findMany({ where: { code: s.context.calendar.code, learn_number: s.context.calendar.learn_number, user_id: { in: ids } },
        select: { id: true, note: true, type: true, created_at: true, updated_at: true, expired_at: true } }) : [];
      restriction_records = JSON.parse(JSON.stringify(restriction_records, (_k, v) => typeof v === 'bigint' ? String(v) : v));
    }
    return { student: row, restriction_records, ...overview(s, caps) };
  };
  const events = async (id: number, studentId: number | undefined, f: DetailFilters, caps: DetailCapabilities) => {
    if (f.source === 'chat' && !caps.chat) throw new ApiError('Không có quyền xem chat', 403);
    if (f.source === 'moderation' && !caps.moderation) throw new ApiError('Không có quyền xem kiểm duyệt', 403);
    if (f.source === 'activities' && !caps.activities) throw new ApiError('Không có quyền xem hoạt động quiz', 403);
    // Event reads do not scan attendance or wait for the roster snapshot.
    const ctx = await context(id);
    const roster = ctx.roster.filter(s => f.room === undefined || s.room_id === f.room);
    const byName = new Map<string, Candidate[]>(), byHmid = new Map<string, Candidate[]>();
    for (const s of roster) {
      for (const [map, value] of [[byName, s.username], [byHmid, s.student_hmid]] as const) {
        const key = normalize(value); if (!key) continue;
        const matches = map.get(key) || []; matches.push(s); map.set(key, matches);
      }
    }
    const selected = studentId == null ? undefined : roster.find(s => s.user_id === studentId);
    if (studentId != null && !selected) throw new ApiError('Học sinh không thuộc phạm vi lịch/room này', 404);
    const scope = cursorScope([id, studentId, f.room ?? (f.room === null ? 'unassigned' : 'all'), f.from, f.to, f.q, f.order, f.source, caps]);
    const cursor = decodeDetailCursor(f.cursor, scope);
    const asc = f.order === 'asc';
    const order = asc ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const seek = (rank: number, time: Prisma.Sql, key = Prisma.sql`id`) => {
      if (!cursor) return Prisma.sql`1=1`;
      const at = new Date(cursor.time), id = BigInt(cursor.id);
      return asc ? Prisma.sql`(${time} > ${at} OR (${time} = ${at} AND (${rank} > ${cursor.source} OR (${rank} = ${cursor.source} AND ${key} > ${id}))))`
        : Prisma.sql`(${time} < ${at} OR (${time} = ${at} AND (${rank} < ${cursor.source} OR (${rank} = ${cursor.source} AND ${key} < ${id}))))`;
    };
    const person = (username: Prisma.Sql | null, hmid: Prisma.Sql | null) => {
      const people = selected ? [selected] : f.room !== undefined ? roster : undefined;
      if (!people) return Prisma.sql`1=1`;
      const names = people.map(s => normalize(s.username)), hmids = people.map(s => normalize(s.student_hmid)).filter(Boolean);
      const parts: Prisma.Sql[] = [];
      if (username && names.length) parts.push(Prisma.sql`LOWER(TRIM(${username})) IN (${Prisma.join(names)})`);
      if (hmid && hmids.length) parts.push(Prisma.sql`LOWER(TRIM(${hmid})) IN (${Prisma.join(hmids)})`);
      return parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`1=0`;
    };
    const c = ctx.calendar;
    const batches: Array<Promise<DetailEvent[]>> = [];
    let hiddenAvailable: boolean | null = caps.moderation && (f.source === 'all' || f.source === 'moderation') ? true : null;
    const add = (rank: number, source: string, sql: Prisma.Sql, optional = false) => {
      batches.push(client.$queryRaw<RawEvent[]>(sql).then(rows => rows.map(r => {
        const matches = [...new Map([...(byName.get(normalize(r.username)) || []), ...(byHmid.get(normalize(r.student_hmid)) || [])].map(s => [s.user_id, s])).values()];
        return { id: String(r.id), source, source_rank: rank, at: r.at.toISOString(), username: r.username, student_hmid: r.student_hmid, room: r.room, content: r.content,
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata as Record<string, unknown>,
          identity: matches.length === 1 ? 'matched' as const : matches.length ? 'ambiguous' as const : 'unmatched' as const, student_ids: matches.map(s => s.user_id) };
      })).catch(e => { if (optional && missingHiddenTable(e)) { hiddenAvailable = false; return []; } throw e; }));
    };
    if (f.source === 'all' || f.source === 'presence') add(1, 'presence', Prisma.sql`
      SELECT id, created_at AS at, username, TRIM(SUBSTRING_INDEX(name, ' - ', 1)) AS student_hmid,
        NULL AS room, NULL AS content, JSON_OBJECT('status', status, 'source_system', source_system, 'socket_session_id', session_id) AS metadata
      FROM users_logs WHERE code = ${c.code} AND learn_number = ${c.learn_number}
        AND ${timeSql(ctx.windows, Prisma.sql`created_at`, f)} AND ${seek(1, Prisma.sql`created_at`)}
        AND ${person(Prisma.sql`username`, Prisma.sql`TRIM(SUBSTRING_INDEX(name, ' - ', 1))`)}
      ORDER BY created_at ${order}, id ${order} LIMIT ${f.limit + 1}
    `);
    if (caps.chat && (f.source === 'all' || f.source === 'chat')) add(2, 'chat', Prisma.sql`
      SELECT id, mess_time AS at, NULL AS username, CAST(user_hmid AS CHAR) AS student_hmid, classroom_id AS room, mess_content AS content,
        JSON_OBJECT('mess_id', mess_id, 'role', user_role, 'type', mess_type, 'status', mess_status, 'display_name', user_display_name, 'source_system', source_system) AS metadata
      FROM logs_chat_new WHERE code = ${c.code} AND learn_number = ${c.learn_number}
        AND ${timeSql(ctx.windows, Prisma.sql`mess_time`, f)} AND ${classSql(ctx, Prisma.sql`classroom_id`, f.room)}
        AND ${person(null, Prisma.sql`CAST(user_hmid AS CHAR)`)} AND ${seek(2, Prisma.sql`mess_time`)}
        AND (${f.q} = '' OR LOCATE(${f.q}, COALESCE(mess_content, '')) > 0)
      ORDER BY mess_time ${order}, id ${order} LIMIT ${f.limit + 1}
    `);
    // users_block is a current projection; expose it only on student overview, never fabricate timeline events from updated_at.
    if (caps.activities && (f.source === 'all' || f.source === 'activities')) add(4, 'quiz_submission', Prisma.sql`
      SELECT id, created_at AS at, username, NULL AS student_hmid, class_id AS room, NULL AS content,
        JSON_OBJECT('quiz_id', quiz_id, 'score', CAST(score AS CHAR), 'answer_seconds', duration) AS metadata
      FROM quiz_logs WHERE code = ${c.code} AND learn_number = ${c.learn_number}
        AND ${timeSql(ctx.windows, Prisma.sql`created_at`, f)} AND ${classSql(ctx, Prisma.sql`class_id`, f.room)}
        AND ${person(Prisma.sql`username`, null)} AND ${seek(4, Prisma.sql`created_at`)}
      ORDER BY created_at ${order}, id ${order} LIMIT ${f.limit + 1}
    `);
    if (caps.moderation && (f.source === 'all' || f.source === 'moderation')) {
      for (const restored of [false, true]) {
        const rank = restored ? 6 : 5, time = restored ? Prisma.sql`restored_at` : Prisma.sql`created_at`;
        add(rank, restored ? 'chat_restored' : 'chat_hidden', Prisma.sql`
          SELECT id, ${time} AS at, NULL AS username, user_hmid AS student_hmid, classroom_id AS room, reason AS content,
            JSON_OBJECT('scope', scope, 'mess_id', mess_id, 'actor', ${restored ? Prisma.sql`restored_by` : Prisma.sql`hidden_by`}, 'actor_role', ${restored ? Prisma.sql`NULL` : Prisma.sql`hidden_by_role`}) AS metadata
          FROM chat_hidden_rules WHERE code = ${c.code} AND learn_number = ${c.learn_number}
            AND ${timeSql(ctx.windows, time, f)} AND ${classSql(ctx, Prisma.sql`classroom_id`, f.room)}
            AND ${person(null, Prisma.sql`user_hmid`)} AND ${seek(rank, time)}
          ORDER BY ${time} ${order}, id ${order} LIMIT ${f.limit + 1}
        `, true);
      }
    }
    const merged = (await Promise.all(batches)).flat().sort((a, b) => compareDetailEvents(a, b) * (asc ? 1 : -1));
    const more = merged.length > f.limit, rows = merged.slice(0, f.limit), last = rows.at(-1);
    return { rows, next_cursor: more && last ? encodeDetailCursor({ time: last.at, source: last.source_rank, id: last.id, scope }) : null,
      hidden_rules_available: hiddenAvailable as boolean | null, limitations: DETAIL_LIMITATIONS, overlapping_calendar_ids: ctx.overlapping_calendar_ids };
  };
  return { students, student, events, clearCache: () => { cache.clear(); contexts.clear(); } };
};
export const compareDetailEvents = (a: Pick<DetailEvent, 'at' | 'source_rank' | 'id'>, b: Pick<DetailEvent, 'at' | 'source_rank' | 'id'>) =>
  a.at.localeCompare(b.at) || a.source_rank - b.source_rank || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
export const filterDetailStudents = (rows: DetailStudent[], f: DetailFilters) => rows.filter(s =>
  (!f.q || [s.name, s.username, s.student_hmid].some(v => normalize(v).includes(normalize(f.q))))
  && (f.attendance === 'all' || s.attendance === f.attendance)
  && (f.chat === 'all' || (f.chat === 'yes' ? (s.chat_count || 0) > 0 : s.chat_count === 0))
  && (f.moderation === 'all' || (f.moderation === 'yes' ? (s.moderation_records || 0) > 0 : s.moderation_records === 0)))
  .sort((a, b) => {
    const value = f.sort === 'chat_count' ? (a.chat_count || 0) - (b.chat_count || 0)
      : f.sort === 'first_seen' ? (a.first_seen || '\uffff').localeCompare(b.first_seen || '\uffff') : a.name.localeCompare(b.name, 'vi');
    return (value || a.user_id - b.user_id) * (f.order === 'asc' ? 1 : -1);
  });
export const calendarDetailReportService = createCalendarDetailReportService();
