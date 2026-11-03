import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { findLessons, findLessonsForExport } from '../src/modules/lessons/lesson.repository';
import { validateLessonListQuery } from '../src/modules/lessons/lesson.validation';

test('chấp nhận hai trạng thái và từ chối giá trị không hợp lệ', () => {
  for (const taught_status of ['taught', 'untaught'] as const) {
    assert.equal(validateLessonListQuery({ taught_status }).taught_status, taught_status);
  }
  assert.equal(validateLessonListQuery({}).taught_status, undefined);
  for (const taught_status of ['other', ['taught'], true]) {
    assert.throws(() => validateLessonListQuery({ taught_status }), /taught_status/);
  }
});

test('lọc cả tổng số, danh sách phân trang và export theo lịch đã bắt đầu đúng nguồn', async () => {
  const original = prisma.$queryRawUnsafe;
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  prisma.$queryRawUnsafe = (async (sql: string, ...values: unknown[]) => {
    calls.push({ sql, values });
    return sql.startsWith('SELECT COUNT(*) AS total') ? [{ total: 12n }] : [];
  }) as typeof prisma.$queryRawUnsafe;
  try {
    for (const taught_status of ['taught', 'untaught'] as const) {
      for (const calendar_source of ['livestream', 'feed'] as const) {
        calls.length = 0;
        const query = validateLessonListQuery({
          taught_status, calendar_source, subject_code: calendar_source === 'feed' ? 'feed-toan' : 'toan',
          page: '2', limit: '10', keyword: 'Hàm số',
        });
        const result = await findLessons(query);
        await findLessonsForExport({ ...query, format: 'xlsx' });
        assert.equal(result.total, 12);
        assert.equal(calls.length, 3);
        for (const { sql, values } of calls) {
          assert.ok(sql.includes(`${taught_status === 'taught' ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM calendar WHERE`));
          assert.match(sql, /calendar\.session_id = lessons\.id/);
          assert.match(sql, /calendar\.code = lessons\.subject_code AND calendar\.learn_number = lessons\.learn_number/);
          assert.match(sql, /calendar\.start_time <= NOW\(\)/);
          assert.ok(sql.includes(calendar_source === 'feed' ? "calendar.code LIKE 'feed-%'" : "calendar.code NOT LIKE 'feed-%'"));
          assert.ok(values.includes('%Hàm số%'));
        }
        assert.deepEqual(calls[1].values.slice(-2), [10, 10]);
      }
    }
    calls.length = 0;
    await findLessons(validateLessonListQuery({ subject_code: 'toan' }));
    assert.doesNotMatch(calls[0].sql, /EXISTS/);
  } finally {
    prisma.$queryRawUnsafe = original;
  }
});
