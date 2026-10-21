import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { createCalendarDetailReportService, compareDetailEvents } from '../src/modules/livestream/calendar-detail-report.service';
import { buildDetailWorkbook } from '../src/modules/livestream/calendar-detail-report.io';
import { detailId, parseDetailFilters, cursorScope, encodeDetailCursor, decodeDetailCursor } from '../src/modules/livestream/calendar-detail-report.validation';
import { countConsecutiveAttendance } from '../src/modules/livestream/calendar-room-report.service';

const at = (time: string) => new Date(`2026-10-20T${time}:00Z`);
const calendar = { id: 12, code: 'math', learn_number: 24, start_time: at('18:00'), end_time: at('19:30'), teacher: 'Teacher', assistant_teacher: 'Assistant', lesson_name: 'Test' };
const person = (id: number, room = 1) => ({ user_id: id, username: `student${id}`, name: `Học sinh ${id}`, student_hmid: `${100 + id}`, email: `student${id}@example.test`, room_id: room, belongs_to_calendar: 1 });
const log = (id: number, user: number, status: number, time: string, socket = 'socket1') => ({ activity_id: BigInt(id), created_at: at(time), status, username: `student${user}`, name: `${100 + user} - name`, session_id: socket });
const caps = { chat: true, moderation: true, activities: true }, basic = { chat: false, moderation: false, activities: false };
function fixture(options: { roster?: any[]; logs?: any[]; callbacks?: any[]; missingHidden?: boolean; events?: boolean } = {}) {
  const queries: Prisma.Sql[] = [];
  const roster = options.roster || [person(1), person(2, 10), person(3, 12), { ...person(4), username: ' teacher ' }, { ...person(5), student_hmid: '999' }, { ...person(6), belongs_to_calendar: 0 }];
  const logs = options.logs || [log(1, 1, 1, '18:00'), log(2, 1, 2, '18:05'), log(3, 1, 2, '18:10'), log(4, 1, 1, '18:15', 'socket2'), log(5, 2, 2, '18:05'), log(6, 2, 1, '18:10'), log(7, 2, 2, '18:15'), log(8, 99, 1, '18:15')];
  const client = {
    calendar: { findUnique: async () => calendar, findMany: async () => [] },
    teacher_profiles: { findMany: async () => [{ username: 'staff', student_hmid: '999' }] },
    users_block: { findMany: async () => [{ id: 9n, user_id: '101', note: 'stored', type: 1, created_at: at('10:00'), updated_at: at('11:00'), expired_at: null }] },
    $queryRaw: async (sql: Prisma.Sql) => {
      queries.push(sql); const text = sql.sql;
      if (text.includes('selected_callbacks')) return options.callbacks || [];
      if (text.includes('WITH assignments')) return roster;
      if (text.includes('FROM users_logs')) {
        if (options.events) return [{ id: 9007199254740993n, at: at('18:05'), username: 'student1', student_hmid: '101', room: null, content: null, metadata: { status: 2 } }];
        const dates = sql.values.filter(v => v instanceof Date) as Date[];
        return logs.filter(l => l.created_at >= dates[0] && l.created_at < dates[1]);
      }
      if (text.includes('COUNT(*)') && text.includes('logs_chat_new')) return [{ hmid: '101', count: 4n }];
      if (text.includes('chat_hidden_rules')) {
        if (options.missingHidden) throw new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2010', clientVersion: 'test', meta: { code: '1146' } });
        if (text.includes('COUNT(*)')) return [{ user_hmid: '101', count: 1n }];
        return [];
      }
      if (text.includes('FROM logs_chat_new') && options.events) return [{ id: 9007199254740994n, at: at('18:05'), username: null, student_hmid: '101', room: 'math46315241', content: '=1+1', metadata: { role: 'student', type: 1 } }];
      return [];
    },
  } as any;
  return { service: createCalendarDetailReportService(client), queries, client };
}

test('validate IDs, filters, malformed inputs and cap backend page size', () => {
  assert.equal(detailId('4294967295'), 4294967295);
  for (const id of ['-1', '0', '1 OR 1', '1.5', '4294967296']) assert.throws(() => detailId(id));
  for (const query of [{ limit: 101 }, { page: -1 }, { room_id: '0' }, { attendance: 'absent' }, { sort: 'DROP TABLE users' }, { q: ['x'] }, { from: '2026-10-20' }, { from: '2026-10-20T19:00:00Z', to: '2026-10-20T18:00:00Z' }]) assert.throws(() => parseDetailFilters(query));
  assert.equal(parseDetailFilters({ room_id: 'unassigned' }).room, null);
});

test('cursor binds calendar/student/filters/order and preserves large IDs', () => {
  const scope = cursorScope([12, 1, 'chat']);
  const cursor = { time: at('18:05').toISOString(), id: '9007199254740993', source: 2, scope };
  assert.deepEqual(decodeDetailCursor(encodeDetailCursor(cursor), scope), cursor);
  assert.throws(() => decodeDetailCursor(encodeDetailCursor(cursor), cursorScope([99, 1, 'chat'])));
  assert.throws(() => decodeDetailCursor(encodeDetailCursor({ ...cursor, id: '-1' }), scope));
  assert.throws(() => decodeDetailCursor('invalid', scope));
});

test('roster filters staff, correct calendar enrollment; returns one row per student and genuine null duration', async () => {
  const { service } = fixture();
  const result = await service.students(12, parseDetailFilters({}), caps);
  assert.deepEqual(result.rows.map(s => s.user_id), [1, 2, 3]);
  assert.deepEqual(result.counts, { added: 3, attended: 1, observed: 1, unobserved: 1, chat_messages: 4, students_with_chat: 1, banned_students: null, ban_events: null, join_count: null, leave_count: null, reconnect_count: null });
  assert.equal(result.rows[0].presence_records, 4);
  assert.equal(result.rows[0].socket_ids_count, 2);
  assert.equal(result.rows[0].duration_minutes, null);
  assert.equal(result.rows[0].last_leave, null);
  assert.equal(result.rows[0].reconnect_count, null);
  assert.equal(result.rows[0].chat_count, 4);
  assert.equal(result.rows[0].moderation_records, 2);
  assert.equal(result.data_quality.unmatched_presence_records, 1);
  assert.equal(result.rows[2].first_seen, null);
  assert.equal('email' in result.rows[0], false);
  assert.equal('belongs_to_calendar' in result.rows[0], false);
});

test('room 1 excludes room 10/12 and does not label other assigned students as unmatched', async () => {
  const result = await fixture().service.students(12, parseDetailFilters({ room_id: 1 }), caps);
  assert.deepEqual(result.rows.map(s => s.user_id), [1]);
  assert.equal(result.data_quality.unmatched_presence_records, 1);
});

test('attendance filters run before pagination; search and Excel return the same filtered rows', async () => {
  const { service } = fixture();
  const filters = parseDetailFilters({ attendance: 'observed', limit: 1, q: '102' });
  const page = await service.students(12, filters, caps);
  const exported = await service.students(12, filters, caps, true);
  assert.equal(page.total, 1); assert.deepEqual(page.rows.map(s => s.user_id), [2]);
  assert.deepEqual(exported.rows, page.rows);
  const wb = buildDetailWorkbook('students', exported.rows, 'calendar=12');
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Học sinh']) as any[];
  assert.equal(sheet[0]['ID enrollment'], '2');
  assert.equal(sheet[0]['Phút học'], 'Chưa xác định');
});

test('without private capabilities do not query chat/moderation or return their numbers', async () => {
  const { service, queries } = fixture();
  const report = await service.students(12, parseDetailFilters({}), basic);
  assert.equal(report.counts.chat_messages, null);
  assert.equal(report.rows[0].chat_count, null);
  assert.equal(report.rows[0].moderation_records, null);
  assert.equal(queries.some(q => /logs_chat_new|chat_hidden_rules/.test(q.sql)), false);
  await assert.rejects(service.students(12, parseDetailFilters({ chat: 'yes' }), basic), (e: any) => e.statusCode === 403);
  await assert.rejects(service.students(12, parseDetailFilters({ moderation: 'yes' }), basic), (e: any) => e.statusCode === 403);
  for (const source of ['chat', 'moderation', 'activities']) await assert.rejects(service.events(12, 1, parseDetailFilters({ source }), basic), (e: any) => e.statusCode === 403);
});

test('detail totals match shared summary counter, no heartbeat chain across EVG sessions', async () => {
  const roster = [person(1)], callbacks = [
    { calendar_id: 12, live_session_id: 'a', start_on: at('18:00'), end_on: at('18:10') },
    { calendar_id: 12, live_session_id: 'b', start_on: at('18:10'), end_on: at('19:30') },
  ];
  const logs = [log(1, 1, 2, '18:05'), log(2, 1, 2, '18:15')];
  const report = await fixture({ roster, callbacks, logs }).service.students(12, parseDetailFilters({}), basic);
  assert.equal(report.counts.attended, 0); assert.equal(report.rows[0].presence_records, 2);
  const summary = countConsecutiveAttendance(callbacks.map(c => ({ ...person(1), window_id: c.live_session_id })), logs.map((l, i) => ({ ...l, window_id: callbacks[i].live_session_id })));
  assert.equal(summary.reduce((n, r) => n + Number(r.attended_students), 0), report.counts.attended);
});

test('overlapping sessions deduplicate log observations and student count', async () => {
  const callbacks = ['a', 'b'].map(live_session_id => ({ calendar_id: 12, live_session_id, start_on: at('18:00'), end_on: at('19:30') }));
  const report = await fixture({ callbacks }).service.students(12, parseDetailFilters({}), basic);
  assert.equal(report.counts.attended, 1); assert.equal(report.rows[0].presence_records, 4);
});

test('missing optional hidden-rule table yields explicit unavailable, never a complete empty history', async () => {
  const { service } = fixture({ missingHidden: true });
  const result = await service.students(12, parseDetailFilters({}), caps);
  assert.equal(result.data_quality.hidden_rules_available, false);
  await assert.rejects(service.students(12, parseDetailFilters({ moderation: 'no' }), caps), (e: any) => e.statusCode === 422);
  const events = await service.events(12, 1, parseDetailFilters({ source: 'moderation' }), caps);
  assert.equal(events.hidden_rules_available, false);
});

test('student IDs are checked against the selected calendar and room for every dataset', async () => {
  const { service } = fixture();
  await assert.rejects(service.student(12, 99, parseDetailFilters({}), caps), (e: any) => e.statusCode === 404);
  await assert.rejects(service.events(12, 2, parseDetailFilters({ room_id: 1 }), caps), (e: any) => e.statusCode === 404);
  const student = await service.student(12, 1, parseDetailFilters({}), caps);
  assert.equal((student.restriction_records![0] as any).id, '9');
  assert.equal('user' in (student.restriction_records![0] as any), false);
});

test('events have stable source/time/BigInt ordering, backend cursor and bounded SELECTs', async () => {
  const { service, queries } = fixture({ events: true });
  const result = await service.events(12, 1, parseDetailFilters({ limit: 1 }), caps);
  assert.equal(result.rows[0].source, 'presence'); assert.equal(result.rows[0].id, '9007199254740993');
  assert.ok(result.next_cursor);
  const scope = JSON.parse(Buffer.from(result.next_cursor!, 'base64url').toString()).scope;
  assert.equal(decodeDetailCursor(result.next_cursor!, scope)!.source, 1);
  const eventQueries = queries.filter(q => /SELECT id,/.test(q.sql));
  assert.ok(eventQueries.every(q => q.sql.includes('LIMIT ?')));
  assert.ok(queries.every(q => !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(q.sql)));
  assert.ok(compareDetailEvents({ at: 'a', source_rank: 1, id: '9007199254740993' }, { at: 'a', source_rank: 1, id: '9007199254740994' }) < 0);
});

test('chat query counts only normal/reply student records and exact canonical room scope', async () => {
  const { service, queries } = fixture();
  await service.students(12, parseDetailFilters({ room_id: 1 }), caps);
  const chat = queries.find(q => q.sql.includes('COUNT(*)') && q.sql.includes('logs_chat_new'))!;
  assert.match(chat.sql, /mess_type IN \(1, 2\)/);
  assert.match(chat.sql, /LOWER\(TRIM\(user_role\)\) = 'student'/);
  assert.match(chat.sql, /classroom_id = \?/);
  assert.equal(chat.values.some(v => typeof v === 'string' && v.endsWith('241')), true);
});

test('ambiguous HMID never duplicates chat counts across enrollments', async () => {
  const { service } = fixture({ roster: [person(1), { ...person(2), student_hmid: '101' }] });
  const result = await service.students(12, parseDetailFilters({}), caps);
  assert.equal(result.counts.chat_messages, 0);
  assert.deepEqual(result.rows.map(s => s.chat_count), [null, null]);
  assert.deepEqual(result.data_quality.ambiguous_chat_student_ids, [1, 2]);
});

test('snapshot caching avoids re-reading attendance on filter/page changes; caps and room isolate cache', async () => {
  const { service, queries } = fixture();
  await service.students(12, parseDetailFilters({}), basic);
  const first = queries.filter(q => q.sql.includes('FROM users_logs')).length;
  await service.students(12, parseDetailFilters({ page: 2, q: 'name' }), basic);
  assert.equal(queries.filter(q => q.sql.includes('FROM users_logs')).length, first);
  await service.students(12, parseDetailFilters({ refresh: 'true' }), basic);
  assert.ok(queries.filter(q => q.sql.includes('FROM users_logs')).length > first);
});

test('export preserves original text safely, big identifiers and nulls', () => {
  const event = { id: '9007199254740993', source: 'chat', source_rank: 2, at: at('18:05').toISOString(), username: null, student_hmid: '101', room: 'room', content: '=HYPERLINK("bad")', metadata: {}, identity: 'matched' as const, student_ids: [1] };
  const workbook = buildDetailWorkbook('events', [event], 'scope');
  const sheet = workbook.Sheets['Nhật ký'];
  assert.equal(sheet.A2.v, event.id); assert.equal(sheet.A2.t, 's');
  assert.equal(sheet.G2.v, event.content); assert.equal(sheet.G2.t, 's'); assert.equal(sheet.G2.f, undefined);
});


test('parallel hour reads consumed in order keep the chain over the hour boundary', async () => {
  const { service, client } = fixture({ roster: [person(1)], logs: [log(1, 1, 2, '18:55'), log(2, 1, 2, '19:05')] });
  const read = client.$queryRaw;
  let running = 0, maxRunning = 0;
  client.$queryRaw = async (sql: Prisma.Sql) => {
    if (!sql.sql.includes('FROM users_logs')) return read(sql);
    running++; maxRunning = Math.max(maxRunning, running);
    const start = sql.values.find(v => v instanceof Date) as Date;
    await new Promise(resolve => setTimeout(resolve, start.getUTCHours() === 18 ? 20 : 1));
    const rows = await read(sql); running--; return rows;
  };
  const r = await service.students(12, parseDetailFilters({}), basic);
  assert.equal(maxRunning, 2); assert.equal(r.counts.attended, 1);
  assert.equal(r.rows[0].first_seen, at('18:55').toISOString()); assert.equal(r.rows[0].last_seen, at('19:05').toISOString());
});

test('overlarge roster is rejected rather than silently truncating; concurrent heavy reports are bounded', async () => {
  const large = fixture({ roster: Array.from({ length: 30003 }, (_, i) => person(i + 1)) });
  await assert.rejects(large.service.students(12, parseDetailFilters({}), basic), (e: any) => e.statusCode === 422);
  const { service, client } = fixture();
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  client.calendar.findUnique = async () => { await pending; return calendar; };
  const running = [1, 10, 12].map(room_id => service.students(12, parseDetailFilters({ room_id }), basic));
  await assert.rejects(service.students(12, parseDetailFilters({ room_id: 20 }), basic), (e: any) => e.statusCode === 503);
  finish(); await Promise.all(running);
});
