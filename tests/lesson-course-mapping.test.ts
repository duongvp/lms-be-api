import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { updateLessonCourseMappings } from '../src/modules/lessons/lesson.repository';

for (const action of ['add', 'delete'] as const) {
  for (const scope of ['selected', 'all'] as const) {
    test(`${action} Course ID cho cả bài đã diễn ra, phạm vi ${scope}`, async () => {
      const originalTransaction = prisma.$transaction;
      const writes: Array<{ sql: string; values: unknown[] }> = [];
      // Bài 22 đã diễn ra; bài 23 chưa diễn ra.
      const tx = {
        $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
          if (sql.includes('calendar_row')) return [{ id: 22n }];
          assert.equal(values[0], 'toan-6');
          if (scope === 'selected') {
            assert.match(sql, /lesson\.id IN \(\?, \?\)/);
            assert.deepEqual(values.slice(1), [22n, 23n]);
          } else {
            assert.equal(values.length, 1);
          }
          return [{ id: 22n }, { id: 23n }];
        },
        $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
          writes.push({ sql, values });
          return 1;
        },
      };
      prisma.$transaction = (async (callback: any) => callback(tx)) as typeof prisma.$transaction;
      try {
        const result = await updateLessonCourseMappings({
          programCode: 'toan-6',
          action,
          packageId: 'package-1',
          courseId: 'course-1',
          lessonIds: scope === 'selected' ? [22n, 23n] : undefined,
        });
        assert.deepEqual(result, { affected: 2, skipped_past: 0, total: 2 });
        assert.deepEqual(writes.map((call) => call.values), [
          [22n, 'package-1', 'course-1'],
          [23n, 'package-1', 'course-1'],
        ]);
        for (const write of writes) {
          assert.match(write.sql, action === 'add'
            ? /INSERT INTO lesson_course_mapping/
            : /DELETE FROM lesson_course_mapping/);
        }
      } finally {
        prisma.$transaction = originalTransaction;
      }
    });
  }
}
