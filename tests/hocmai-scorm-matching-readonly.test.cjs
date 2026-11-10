const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const load = (file, bindings, globals = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { loader: 'ts', format: 'cjs' }).code,
    { module, exports: module.exports, require: name => {
      if (!(name in bindings)) throw Error('Unexpected dependency ' + name);
      return bindings[name];
    }, ...globals });
  return module.exports;
};
const matcher = load('modules/hmo-lesson-sync/hmo-lesson-sync.service.ts', {
  '../../lib/prisma': {}, '../../integrations/hocmai-course-outline.service': {}, '../../utils/logger': {},
  '../livestream/hocmai-sync-queue.service': {},
  '../livestream/calendar-source': { calendarSourceFromCode: code => /^feed-/i.test(code) ? 'feed' : 'livestream' },
});
const base = { calendar_id: 1, lesson_id: 44, learn_number: 1,
  source_lesson_name: 'Ôn tập kiến thức thể loại: Văn bản thông tin - Phần 1.',
  calendar_lesson_name: 'Ôn tập kiến thức thể loại: Văn bản thông tin - Phần 1.',
  lesson_count: 0, start_time: '2026-06-22T20:00:00.000Z', teacher: 'daoanh',
  teacher_name: 'Đào Thị Hồng Anh', package_id: '9154', course_id: '1777' };
const title = base.source_lesson_name.replace(/\.$/, '');
const lesson = (lessonId, name = title, month = 'Tháng 6/2026') => ({ lessonId, name, sectionName: month });
function fixture(schedules, items) {
  let reads = 0, outlineReads = 0;
  const payloads = [];
  const db = new Proxy({}, { get: (_target, key) => {
    if (key === '$queryRaw') return async (_sql, program) => {
      assert.equal(program, 'nguvan-7-2027'); reads++; return schedules;
    };
    throw Error('Forbidden database access: ' + String(key));
  } });
  const service = load('modules/lessons/hocmai-scorm-name-sync.service.ts', {
    '../../lib/prisma': { __esModule: true, default: db },
    '../../integrations/hocmai-course-outline.service': { fetchHocmaiCourseOutlines: async pairs => {
      outlineReads++; return pairs.map(pair => ({ ...pair, exists: true, lessons: typeof items === "function" ? items(pair) : items }));
    } },
    '../../utils/logger': { logger: { error() {} } }, '../hmo-lesson-sync/hmo-lesson-sync.service': matcher,
  }, {
    AbortSignal, crypto: { randomUUID: () => 'test-job' }, process: { env: { SYNC_SCORM_TOKEN: 'fake-token' } },
    fetch: async (_url, options) => { payloads.push(JSON.parse(options.body)); return { ok: true, text: async () => '{}' }; },
  });
  return { preview: (options = { matchingMode: 'lesson_id' }) => service.previewHocmaiScormNameSync('nguvan-7-2027', options),
    teachers: () => service.getHocmaiScormTeachers('nguvan-7-2027'), parse: service.parseHocmaiScormOptions,
    start: (options, overrides = []) => service.startHocmaiScormNameSync('nguvan-7-2027', overrides, options),
    job: service.getHocmaiScormNameSyncJob, payloads,
    resolve: (id = '101', options = {}) => service.resolveManualHocmaiScormLesson('nguvan-7-2027', '1::9154::1777', id, options),
    reads: () => ({ reads, outlineReads }) };
}

test('SCORM uses the same ID mapping for an outline without teacher suffix in a multi-teacher program', async () => {
  const schedules = [base, { ...base, calendar_id: 2, lesson_id: 45, teacher_name: 'Nguyễn Văn Bình', source_lesson_name: 'Bài khác' }];
  const items = [lesson('101'), lesson('102', 'Bài khác_Thầy Bình')];
  const expected = matcher.matchCalendarsForCourse([base], items).get(1).lessonId;
  const s = fixture(schedules, items), result = await s.preview();
  assert.equal(expected, '101');
  assert.equal(result.rows[0].hocmaiLessonId, expected);
  assert.match(result.rows[0].reason, /chọn chức danh/);
  assert.equal(result.rows[0].status, 'skipped');
  assert.equal(result.rows[0].expectedName, undefined);
});

test('short HOCMAI suffix expands to the full teacher name in preview and manual selection', async () => {
  const s = fixture([base], [lesson('101', title + '_cô Anh')]);
  const preview = await s.preview(), resolved = await s.resolve();
  assert.equal(preview.rows[0].hocmaiLessonId, '101');
  assert.equal(preview.rows[0].expectedName, title + '_Cô Đào Thị Hồng Anh');
  assert.equal(resolved.suggestedName, preview.rows[0].expectedName);
  assert.equal(resolved.honorific, 'Cô');
  assert.equal(resolved.requiresHonorific, false);
});

test('a missing suffix can use an unambiguous title from another lesson by the same teacher', async () => {
  const s = fixture([base], [lesson('101'), lesson('102', 'Nội dung khác_Cô Anh')]);
  assert.equal((await s.preview()).rows[0].expectedName, title + '_Cô Đào Thị Hồng Anh');
  assert.equal((await s.resolve()).suggestedName, title + '_Cô Đào Thị Hồng Anh');
});

test('missing or conflicting titles never silently produce a teacher-less name', async () => {
  for (const items of [[lesson('101')], [lesson('101'), lesson('102', 'Khác_Cô Anh'), lesson('103', 'Khác_Thầy Anh')]]) {
    const s = fixture([base], items), resolved = await s.resolve();
    assert.equal(resolved.suggestedName, '');
    assert.equal(resolved.requiresHonorific, true);
    assert.equal(resolved.teacherName, 'Đào Thị Hồng Anh');
    assert.equal(resolved.baseName, title);
  }
});

test('two teachers named Anh cannot infer a title from the ambiguous short name', async () => {
  const s = fixture([base, { ...base, calendar_id: 2, teacher_name: 'Nguyễn Ngọc Anh' }],
    [lesson('101'), lesson('102', 'Khác_Cô Anh')]);
  assert.equal((await s.resolve()).requiresHonorific, true);
});

test('teacher title from the schedule is preserved without duplicating the prefix', async () => {
  const s = fixture([{ ...base, teacher_name: 'Cô Đào Thị Hồng Anh' }], [lesson('101')]);
  assert.equal((await s.resolve()).suggestedName, title + '_Cô Đào Thị Hồng Anh');
});

test('matching retains month, part and teacher safeguards and does not reuse old mappings', async () => {
  for (const candidate of [lesson('101', title, 'Tháng 7/2026'),
    lesson('101', title.replace('Phần 1', 'Phần 2')), lesson('101', title + '_Thầy Bình')]) {
    const result = await fixture([base], [candidate]).preview();
    assert.equal(result.rows[0].hocmaiLessonId, undefined);
    assert.equal(result.updateCount, 0);
  }
});

test('repeated schedules use the same Lesson-ID allocation as the mapping synchronizer', async () => {
  const schedules = [base, { ...base, calendar_id: 2, start_time: '2026-06-25T20:00:00.000Z', lesson_count: 1 }];
  const items = [lesson('101', title + '_Cô Anh'), lesson('102', title + '_Cô Anh')];
  const expected = matcher.matchCalendarsForCourse(schedules, items);
  const result = await fixture(schedules, items).preview();
  assert.equal(result.rows[0].hocmaiLessonId, expected.get(1).lessonId);
  assert.equal(result.rows[1].hocmaiLessonId, expected.get(2).lessonId);
  assert.notEqual(result.rows[0].hocmaiLessonId, result.rows[1].hocmaiLessonId);
});

test('preview and manual resolution only invoke read-only dependencies', async () => {
  const s = fixture([base], [lesson('101', title + '_Cô Anh')]);
  await s.preview(); await s.resolve();
  assert.deepEqual(s.reads(), { reads: 2, outlineReads: 2 });
});


test('the old and Lesson-ID modes remain separate with no implicit fallback', async () => {
  const schedules = [base, { ...base, calendar_id: 2, lesson_id: 45, teacher_name: 'Nguyễn Văn Bình', source_lesson_name: 'Bài khác' }];
  const s = fixture(schedules, [lesson('101')]);
  const teacherPrefixes = { 'dao thi hong anh': 'Cô' };
  const old = await s.preview({ matchingMode: 'name_teacher', teacherPrefixes });
  const current = await s.preview({ matchingMode: 'lesson_id', teacherPrefixes });
  const defaultMode = await s.preview({ teacherPrefixes });
  assert.equal(old.rows[0].hocmaiLessonId, undefined);
  assert.equal(defaultMode.rows[0].hocmaiLessonId, undefined);
  assert.equal(current.rows[0].hocmaiLessonId, '101');
  assert.equal(current.rows[0].expectedName, title + '_Cô Đào Thị Hồng Anh');
});

test('multiple matching lessons remain manual in the old mode while Lesson-ID mode allocates occurrences', async () => {
  const schedules = [base, { ...base, calendar_id: 2, start_time: '2026-06-25T20:00:00.000Z', lesson_count: 1 }];
  const s = fixture(schedules, [lesson('101', title + '_Cô Anh'), lesson('102', title + '_Cô Anh')]);
  const old = await s.preview({ matchingMode: 'name_teacher' });
  assert.equal(old.updateCount, 0);
  assert.equal(old.rows[0].status, 'skipped');
  const current = await s.preview({ matchingMode: 'lesson_id' });
  assert.equal(current.rows[0].hocmaiLessonId, '101');
  assert.equal(current.rows[1].hocmaiLessonId, '102');
});

test('program teacher list is deduplicated and user prefixes override inferred titles in both naming paths', async () => {
  const s = fixture([base, { ...base, package_id: '9177', course_id: '3367' }], [lesson('101', title + '_Cô Anh')]);
  const teachers = await s.teachers();
  assert.equal(teachers.length, 1);
  assert.equal(teachers[0].name, 'Đào Thị Hồng Anh');
  const options = { matchingMode: 'name_teacher', teacherPrefixes: { [teachers[0].key]: 'TS.' } };
  assert.equal((await s.preview(options)).rows[0].expectedName, title + '_TS. Đào Thị Hồng Anh');
  assert.equal((await s.resolve('101', options)).suggestedName, title + '_TS. Đào Thị Hồng Anh');
  assert.equal((await s.resolve('101', options)).requiresHonorific, false);
});

test('invalid modes, malformed prefixes and teachers outside the program are rejected', async () => {
  const s = fixture([base], [lesson('101')]);
  for (const options of [{ matchingMode: 'fallback' }, { teacherPrefixes: [] },
    { teacherPrefixes: { 'dao thi hong anh': 123 } }, { teacherPrefixes: { 'dao thi hong anh': 'Cô\nThầy' } }]) {
    assert.throws(() => s.parse(options));
  }
  await assert.rejects(s.preview({ teacherPrefixes: { other: 'Cô' } }), /không thuộc chương trình/);
  await assert.rejects(s.resolve('101', { teacherPrefixes: { other: 'Cô' } }), /không thuộc chương trình/);
});

test('apply recomputes with the selected mode and an immutable copy of prefixes (mock HTTP only)', async () => {
  const schedules = [base, { ...base, calendar_id: 2, lesson_id: 45, teacher_name: 'Nguyễn Văn Bình', source_lesson_name: 'Bài khác' }];
  const s = fixture(schedules, [lesson('101')]);
  const options = { matchingMode: 'lesson_id', teacherPrefixes: { 'dao thi hong anh': 'Cô' } };
  const started = s.start(options);
  options.matchingMode = 'name_teacher'; options.teacherPrefixes['dao thi hong anh'] = 'Thầy';
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.job(started.id).status, 'completed', s.job(started.id).error);
  assert.equal(s.payloads[0][0].lesson_name, title + '_Cô Đào Thị Hồng Anh');
  assert.equal(s.payloads[0][0].lesson_id, 101);
  const old = fixture(schedules, [lesson('101')]);
  old.start({ matchingMode: 'name_teacher', teacherPrefixes: { 'dao thi hong anh': 'Cô' } });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(old.payloads.length, 0);
});


test('an ambiguous shared target for different teachers is skipped even with explicit prefixes', async () => {
  const s = fixture([base, { ...base, calendar_id: 2, teacher_name: 'Nguyễn Văn Bình' }], [lesson('101')]);
  const result = await s.preview({ matchingMode: 'lesson_id', teacherPrefixes: {
    'dao thi hong anh': 'Cô', 'nguyen van binh': 'Thầy',
  } });
  assert.equal(result.updateCount, 0);
  assert.equal(result.rows[0].status, 'skipped');
  assert.equal(result.rows[1].status, 'skipped');
  assert.match(result.rows[0].reason, /hai tên đích khác nhau/);
});


const repeatedTitle = 'Hướng dẫn đọc hiểu một văn bản truyện';
const repeatedSchedules = () => [
  ...['9154::1777', '9201::3368'].flatMap(pair => {
    const [package_id, course_id] = pair.split('::');
    return [
      { ...base, calendar_id: 10, lesson_id: 407, learn_number: 24, source_lesson_name: repeatedTitle,
        start_time: '2026-09-14T20:00:00.000Z', package_id, course_id, lesson_count: 0 },
      { ...base, calendar_id: 11, lesson_id: 407, learn_number: 24, source_lesson_name: repeatedTitle,
        start_time: '2026-09-17T20:00:00.000Z', package_id, course_id, lesson_count: 1 },
    ];
  }),
  { ...base, calendar_id: 12, lesson_id: 408, source_lesson_name: 'Bài khác', teacher_name: 'Nguyễn Văn Bình' },
];
const repeatedOutline = pair => (pair.packageId === '9201'
  ? [lesson('174969', repeatedTitle + '_Cô Đào Thị Hồng Anh', 'Tháng 9/2026'),
     lesson('174970', repeatedTitle + '_Cô Anh', 'Tháng 9/2026')]
  : [lesson('171828', repeatedTitle + '_Cô Anh', 'Tháng 9/2026'),
     lesson('171829', repeatedTitle + '_Cô Anh', 'Tháng 9/2026')]);

for (const matchingMode of ['name_teacher', 'lesson_id']) test(`${matchingMode}: two September schedules receive 174969 and 174970, not a shared ID`, async () => {
  const s = fixture(repeatedSchedules(), repeatedOutline);
  const result = await s.preview({ matchingMode, teacherPrefixes: { 'dao thi hong anh': 'Cô' } });
  const pair = result.rows.filter(row => row.packageId === '9201');
  assert.equal(pair[0].hocmaiLessonId, '174969');
  assert.equal(pair[1].hocmaiLessonId, '174970');
  assert.equal(pair[0].status, 'unchanged'); assert.equal(pair[1].status, 'update');
  assert.equal(pair[0].sharedTarget, undefined); assert.equal(pair[1].sharedTarget, undefined);
  if (matchingMode === 'lesson_id') {
    const otherPair = result.rows.filter(row => row.packageId === '9154' && row.learnNumber === 24);
    assert.equal(otherPair[0].hocmaiLessonId, '171828');
    assert.equal(otherPair[1].hocmaiLessonId, '171829');
  }
});

test('insufficient repeated candidates are skipped instead of silently sharing one ID', async () => {
  const rows = repeatedSchedules().filter(row => row.package_id === '9201');
  const result = await fixture(rows, [repeatedOutline({ packageId: '9201' })[0]]).preview({
    matchingMode: 'lesson_id', teacherPrefixes: { 'dao thi hong anh': 'Cô' },
  });
  assert.equal(result.updateCount, 0);
  assert.equal(result.rows[0].status, 'skipped'); assert.equal(result.rows[1].status, 'skipped');
  assert.match(result.rows[0].reason, /Lesson ID riêng/);
});

test('candidate order comes from the outline while schedule order comes from dates', async () => {
  const rows = repeatedSchedules().filter(row => row.package_id === '9201').reverse();
  const items = repeatedOutline({ packageId: '9201' }).map((item, index) => ({ ...item, lessonIndex: index, sectionId: 'sep' })).reverse();
  const result = await fixture(rows, items).preview({ matchingMode: 'lesson_id' });
  assert.equal(result.rows.find(row => row.key.startsWith('10::')).hocmaiLessonId, '174969');
  assert.equal(result.rows.find(row => row.key.startsWith('11::')).hocmaiLessonId, '174970');
});

test('extra candidates or several sessions never cause a guessed repeated allocation', async () => {
  const rows = repeatedSchedules().filter(row => row.package_id === '9201');
  for (const items of [
    [...repeatedOutline({ packageId: '9201' }), lesson('174971', repeatedTitle + '_Cô Anh', 'Tháng 9/2026')],
    repeatedOutline({ packageId: '9201' }).map((item, index) => ({ ...item, sectionId: 'session-' + index })),
  ]) {
    const result = await fixture(rows, items).preview({ matchingMode: 'lesson_id' });
    assert.equal(result.updateCount, 0);
    assert.equal(result.rows[0].status, 'skipped'); assert.equal(result.rows[1].status, 'skipped');
  }
});

test('a manual selection cannot reuse the ID of another schedule in the same pair (mock HTTP only)', async () => {
  const rows = repeatedSchedules().filter(row => row.package_id === '9201');
  const s = fixture(rows, repeatedOutline({ packageId: '9201' }));
  const job = s.start({ matchingMode: 'lesson_id' }, [{
    rowKey: '11::9201::3368', lessonId: '174969', expectedName: repeatedTitle + '_Cô Đào Thị Hồng Anh',
  }]);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.job(job.id).status, 'failed');
  assert.match(s.job(job.id).error, /cần chọn Lesson ID riêng/);
  assert.equal(s.payloads.length, 0);
});

test('correct repeated allocation produces two independent update targets (mock HTTP only)', async () => {
  const s = fixture(repeatedSchedules().filter(row => row.package_id === '9201'), repeatedOutline({ packageId: '9201' }));
  const job = s.start({ matchingMode: 'lesson_id', teacherPrefixes: { 'dao thi hong anh': 'TS.' } });
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.job(job.id).status, 'completed', s.job(job.id).error);
  assert.deepEqual(s.payloads[0].map(item => item.lesson_id), [174969, 174970]);
});
