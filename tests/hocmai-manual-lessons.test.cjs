const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const source = fs.readFileSync(path.join(__dirname, '../src/modules/lessons/hocmai-scorm-name-sync.service.ts'), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'cjs' }).code;
const row = { calendar_id: 12, lesson_id: 999, learn_number: 1,
  source_lesson_name: 'Tên không khớp', teacher: 'Giáo viên không khớp',
  package_id: '9154', course_id: '1777' };
const lessons = [
  { lessonId: '100', name: 'Bài của giáo viên A', sectionName: 'Tháng 6' },
  { lessonId: '101', name: 'Bài của giáo viên B', sectionName: 'Tháng 7' },
  { lessonId: '102', name: 'Bài khác', sectionName: 'Tháng 8' },
];
function fixture({ schedules = [row], exists = true, items = lessons, failure } = {}) {
  const queries = [], calls = [];
  const module = { exports: {} };
  const modules = {
    '../../lib/prisma': { default: { $queryRaw: async (sql, ...args) => { queries.push({ sql: sql.join('?'), args }); return schedules; } }, __esModule: true },
    '../../integrations/hocmai-course-outline.service': { fetchHocmaiCourseOutlines: async pairs => {
      calls.push(pairs); if (failure) throw new Error(failure);
      return pairs.map(pair => ({ ...pair, exists, lessons: items }));
    } },
    '../../utils/logger': { logger: {} },
    '../hmo-lesson-sync/hmo-lesson-sync.service': { normalizeTitle: value => String(value || '').toLowerCase() },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (!(name in modules)) throw new Error('Unexpected import ' + name);
    return modules[name];
  } });
  return { list: module.exports.getManualHocmaiScormLessons, resolve: module.exports.resolveManualHocmaiScormLesson, queries, calls };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('manual list returns every outline lesson despite title/teacher mismatch, scoped to the schedule pair', async () => {
  const s = fixture();
  const result = await s.list('nguvan-7-2027', '12::9154::1777');
  assert.deepEqual(plain(result), { rowKey: '12::9154::1777', packageId: '9154', courseId: '1777', lessons });
  assert.deepEqual(plain(s.calls), [[{ packageId: '9154', courseId: '1777' }]]);
  assert.deepEqual(plain(s.queries[0].args), ['nguvan-7-2027']);
  assert.match(s.queries[0].sql, /deleted_at IS NULL/);
});

test('a forged row/course or row outside the program never calls HOCMAI', async () => {
  for (const key of ['12::9154::999', '13::9154::1777', '999']) {
    const s = fixture();
    await assert.rejects(s.list('nguvan-7-2027', key), /Không tìm thấy lịch/);
    assert.equal(s.calls.length, 0);
  }
  const s = fixture({ schedules: [] });
  await assert.rejects(s.list('other-program', '12::9154::1777'), /Không tìm thấy lịch/);
  assert.equal(s.calls.length, 0);
});

test('missing context is rejected without querying the database', async () => {
  const s = fixture();
  await assert.rejects(s.list('', '12::9154::1777'), /không hợp lệ/);
  await assert.rejects(s.list('program', ''), /không hợp lệ/);
  assert.equal(s.queries.length, 0);
});

test('empty outlines stay empty; upstream errors and missing courses are surfaced', async () => {
  const empty = fixture({ items: [] });
  assert.deepEqual(plain((await empty.list('program', '12::9154::1777')).lessons), []);
  const missing = fixture({ exists: false });
  await assert.rejects(missing.list('program', '12::9154::1777'), /Không tìm thấy Package/);
  const failed = fixture({ failure: 'HMO_TIMEOUT' });
  await assert.rejects(failed.list('program', '12::9154::1777'), /HMO_TIMEOUT/);
});

test('manual resolution revalidates membership and returns the selected outline name', async () => {
  const s = fixture();
  const resolved = await s.resolve('program', '12::9154::1777', '101');
  assert.equal(resolved.lessonId, '101');
  assert.equal(resolved.currentName, 'Bài của giáo viên B');
  assert.equal(resolved.sessionName, 'Tháng 7');
  await assert.rejects(s.resolve('program', '12::9154::1777', '666'), /không thuộc Package 9154 \/ Course 1777/);
});
