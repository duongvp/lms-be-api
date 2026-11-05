const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const { Prisma } = require('@prisma/client');

const root = path.resolve(__dirname, '../src/modules/livestream');
const load = (source, bindings = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, require, Date, ...bindings });
  return module.exports;
};
const { buildCalendarColumnFilters } = load(fs.readFileSync(path.join(root, 'calendar-column-filters.ts'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'livestream.service.ts'), 'utf8');
const querySource = 'export ' + source.slice(source.indexOf('const buildCalendarListQuery = async'), source.indexOf('export const getCalendar = async'));
const listSource = source.slice(source.indexOf('export const getCalendar = async'), source.indexOf('export const getCalendarRowsForExport'));
const optionSource = source.slice(source.indexOf('export const getCalendarHeaderFilterOptions'), source.indexOf('export type HocmaiAttendanceUser'));
const now = new Date('2026-11-04T12:00:00Z');

const matches = (row, where) => Object.entries(where).every(([key, condition]) => {
  if (key === 'AND') return [].concat(condition).every(item => matches(row, item));
  if (key === 'OR') return condition.some(item => matches(row, item));
  const value = row[key];
  if (condition === null || typeof condition !== 'object' || condition instanceof Date) return value === condition;
  return Object.entries(condition).every(([operator, expected]) => {
    if (operator === 'in') return expected.includes(value);
    if (operator === 'not') return !matches(row, { [key]: expected });
    if (operator === 'startsWith') return String(value).startsWith(expected);
    if (operator === 'gt') return value > expected;
    if (operator === 'gte') return value >= expected;
    if (operator === 'lt') return value < expected;
    if (operator === 'lte') return value <= expected;
    throw Error('Unsupported fixture operator: ' + operator);
  });
});

const rows = Array.from({ length: 1000 }, (_, index) => ({
  id: index + 1, learn_number: index + 1, code: 'QA', deleted_at: null, lesson_status: 0,
  start_time: new Date('2026-11-01T08:00:00Z'), end_time: new Date('2026-11-01T09:00:00Z'), assistant_teacher: 'alice',
}));
for (const id of [501, 601, 701, 901, 999]) Object.assign(rows[id - 1], {
  start_time: new Date('2026-11-10T08:00:00Z'), end_time: new Date('2026-11-10T09:00:00Z'),
  assistant_teacher: id === 601 ? 'zoe2' : 'alice, zoe', lesson_status: id === 901 ? 1 : 0,
  code: id === 999 ? 'OTHER' : 'QA',
});

rows[879].assistant_teacher = null;
rows[878].assistant_teacher = ' [NULL] ';
rows[877].assistant_teacher = 'NULL';
rows[876].assistant_teacher = '';
rows[875].assistant_teacher = '-';

const fixture = () => {
  const calls = [];
  const prisma = {
    calendar: {
      count: async args => { calls.push({ kind: 'count', ...args }); return rows.filter(row => matches(row, args.where)).length; },
      findMany: async args => { calls.push({ kind: 'rows', ...args }); const matched = rows.filter(row => matches(row, args.where)); return args.select ? matched.map(row => Object.fromEntries(Object.keys(args.select).map(key => [key, row[key]]))) : matched.slice(args.skip, args.skip + args.take); },
    },
    $queryRaw: async sql => {
      calls.push({ kind: 'sql', sql });
      if (sql.sql.includes('SELECT DISTINCT assistant_teacher')) return rows.filter(row => sql.values.includes(row.id)).map(row => ({ assistant_teacher: row.assistant_teacher }));
      return rows.filter(row => (sql.sql.includes('UPPER(TRIM(COALESCE') && ['', 'NULL', '[NULL]', '-'].includes(String(row.assistant_teacher ?? '').trim().toUpperCase()))
        || sql.values.some(value => new RegExp(value.replaceAll('[[:space:]]', '\\s')).test(row.assistant_teacher)))
        .map(row => ({ id: row.id }));
    },
  };
  const bindings = {
    prisma, Prisma, buildCalendarColumnFilters,
    resolveCalendarSource: value => value || 'livestream',
    normalizeNumber: value => value === undefined ? undefined : Number(value),
    normalizeString: value => value == null ? undefined : String(value).trim() || undefined,
    normalizeDate: value => value ? new Date(value) : undefined,
    normalizeSortOrder: value => value === 'desc' ? 'desc' : 'asc',
    CALENDAR_SORT_FIELDS: ['start_time'], CALENDAR_SYSTEM_TYPES: ['topclass', 'topuni'],
    getVietnamWallClockDate: () => now,
    getCalendarIdsForPrograms: async programs => rows.filter(row => programs.includes(row.code)).map(row => row.id),
  };
  const compiled = load(querySource + listSource, bindings);
  bindings.buildCalendarListQuery = compiled.buildCalendarListQuery;
  bindings.parseAssistantTeachers = load('export ' + source.slice(source.indexOf('const parseAssistantTeachers ='), source.indexOf('\n};', source.indexOf('const parseAssistantTeachers =')) + 3)).parseAssistantTeachers;
  return { ...compiled, calls, bindings };
};

test('date + assistant + progress filters find matches beyond the first 300 rows, before counting and paging', async () => {
  const { getCalendar, calls } = fixture();
  const query = { code: 'QA', live_dates: '2026-11-10', assistant_teachers: 'zoe', progress_statuses: 'upcoming', page: 2, limit: 1 };
  const result = await getCalendar(query, null, false, true);
  assert.equal(result.total, 2);
  assert.deepEqual(Array.from(result.data, row => row.id), [701]);
  const count = calls.find(call => call.kind === 'count'), page = calls.find(call => call.kind === 'rows');
  assert.equal(count.where, page.where);
  assert.equal(page.skip, 1);
  assert.equal(page.take, 1);
  const sql = calls.find(call => call.kind === 'sql').sql;
  assert.match(sql.sql, /REGEXP \?/);
  assert.deepEqual(sql.values, ['(^|,)[[:space:]]*zoe[[:space:]]*(,|$)']);
  const denied = await getCalendar(query, ['OTHER'], false, true);
  assert.equal(denied.total, 0);
});

test('progress unions include cancelled lessons without misclassifying them by time', () => {
  const cancelled = { lesson_status: 1, start_time: new Date('2026-11-10'), end_time: new Date('2026-11-11') };
  const upcoming = { ...cancelled, lesson_status: 0 };
  for (const [statuses, expected] of [['upcoming', false], ['cancelled', true], ['upcoming,cancelled', true]]) {
    assert.equal(matches(cancelled, { AND: buildCalendarColumnFilters({ progress_statuses: statuses }, now).conditions }), expected);
  }
  assert.equal(matches(upcoming, { AND: buildCalendarColumnFilters({ progress_statuses: 'upcoming' }, now).conditions }), true);
  const ongoing = { lesson_status: null, start_time: now, end_time: now };
  assert.equal(matches(ongoing, { AND: buildCalendarColumnFilters({ progress_statuses: 'ongoing' }, now).conditions }), true);
  assert.equal(matches(ongoing, { AND: buildCalendarColumnFilters({ progress_statuses: 'completed' }, now).conditions }), false);
});

test('live dates are a union of whole wall-clock days, with an exclusive next-day boundary', () => {
  const where = { AND: buildCalendarColumnFilters({ live_dates: '2026-11-10,2026-11-12' }, now).conditions };
  for (const [date, expected] of [['2026-11-10T00:00:00Z', true], ['2026-11-10T23:59:59.999Z', true], ['2026-11-11T00:00:00Z', false], ['2026-11-12T15:00:00Z', true]]) {
    assert.equal(matches({ start_time: new Date(date) }, where), expected);
  }
  for (const live_dates of ['2026-02-30', '10/11/2026', 'invalid']) {
    assert.throws(() => buildCalendarColumnFilters({ live_dates }, now), /live_dates/);
  }
  assert.throws(() => buildCalendarColumnFilters({ progress_statuses: 'invalid' }, now), /progress_statuses/);
});

test('assistant selections are ORed and parameterized, including unassigned lessons', () => {
  const sql = buildCalendarColumnFilters({ assistant_teachers: "zoe,-,x' OR 1=1" }, now).assistantCondition;
  assert.match(sql.sql, / OR /);
  assert.match(sql.sql, /UPPER\(TRIM\(COALESCE/);
  assert.equal(sql.sql.includes("x' OR 1=1"), false);
  assert.deepEqual(sql.values, ['(^|,)[[:space:]]*zoe[[:space:]]*(,|$)', "(^|,)[[:space:]]*x' OR 1=1[[:space:]]*(,|$)"]);
});

test('assistant matching preserves names with spaces and escapes regular-expression characters', () => {
  const sql = buildCalendarColumnFilters({ assistant_teachers: 'Trợ giảng A,zoe.test+qa@example.com' }, now).assistantCondition;
  const patterns = sql.values.map(value => new RegExp(value.replaceAll('[[:space:]]', '\\s')));
  assert.equal(patterns[0].test('alice,  Trợ giảng A ,bob'), true);
  assert.equal(patterns[0].test('TrợgiảngA'), false);
  assert.equal(patterns[1].test('zoe.test+qa@example.com'), true);
  assert.equal(patterns[1].test('zoeXtestqa@example.com'), false);
});

test('header choices use every top filter and only values present in those results, without pagination', async () => {
  const { bindings, calls } = fixture();
  const { getCalendarHeaderFilterOptions } = load(optionSource, bindings);
  const filtered = await getCalendarHeaderFilterOptions({
    code: 'QA', start_time: '2026-11-10T00:00:00Z', end_time: '2026-11-10T23:59:59Z',
    from_learn_number: 500, to_learn_number: 600, time_status: 'upcoming', page: 5, limit: 25,
  }, ['QA']);
  assert.deepEqual(Array.from(filtered.live_dates), ['2026-11-10']);
  assert.deepEqual(Array.from(filtered.assistant_teachers), ['alice', 'zoe']);
  assert.deepEqual(Array.from(filtered.progress_statuses), ['upcoming']);
  const metadataQuery = calls.find(call => call.kind === 'rows');
  assert.equal(metadataQuery.skip, undefined);
  assert.equal(metadataQuery.take, undefined);
  assert.equal(metadataQuery.select.id, true);
  assert.equal(metadataQuery.select.lesson_status, true);
  const onlyEmptyAssistant = await getCalendarHeaderFilterOptions({ code: 'QA', calendar_id: 880 }, ['QA']);
  assert.deepEqual(Array.from(onlyEmptyAssistant.assistant_teachers), ['-']);
  assert.deepEqual(Array.from(onlyEmptyAssistant.progress_statuses), ['completed']);
  assert.deepEqual(Array.from(onlyEmptyAssistant.live_dates), ['2026-11-01']);
  const cancelledOnly = await getCalendarHeaderFilterOptions({ code: 'QA', calendar_id: 901 }, ['QA']);
  assert.deepEqual(Array.from(cancelledOnly.progress_statuses), ['cancelled']);
  const denied = await getCalendarHeaderFilterOptions({ code: 'OTHER' }, ['QA']);
  assert.equal(denied.live_dates.length, 0);
  assert.equal(denied.assistant_teachers.length, 0);
  assert.equal(denied.progress_statuses.length, 0);
});


test('unassigned assistants collapse legacy NULL markers and filter actual unassigned rows', async () => {
  const { getCalendar, bindings } = fixture();
  const { getCalendarHeaderFilterOptions } = load(optionSource, bindings);
  const options = await getCalendarHeaderFilterOptions({ code: 'QA', from_learn_number: 876, to_learn_number: 880 });
  assert.deepEqual(Array.from(options.assistant_teachers), ['-']);
  const result = await getCalendar({ code: 'QA', assistant_teachers: '-', limit: 25 }, null, false, true);
  assert.equal(result.total, 5);
  assert.deepEqual(Array.from(result.data, row => row.id), [876, 877, 878, 879, 880]);
  assert.deepEqual(Array.from(bindings.parseAssistantTeachers([null, '[NULL]', 'NULL', '-', 'alice', 'alice'])), ['alice']);
});

test('top status filters include cancelled lessons explicitly and exclude them from all time-only states', async () => {
  const { getCalendar } = fixture();
  for (const [time_status, expected] of [
    ['cancelled', [901]], ['upcoming', [501, 601, 701]],
    ['upcoming,cancelled', [501, 601, 701, 901]],
    ['upcoming,ongoing,completed', [501, 601, 701]],
    ['upcoming,ongoing,completed,cancelled', [501, 601, 701, 901]],
  ]) {
    const result = await getCalendar({ code: 'QA', live_dates: '2026-11-10', time_status, limit: 25 }, null, false, true);
    assert.equal(result.total, expected.length, time_status);
    assert.deepEqual(Array.from(result.data, row => row.id), expected, time_status);
  }
});
