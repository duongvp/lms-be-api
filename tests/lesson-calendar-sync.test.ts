import assert from 'node:assert/strict';
import test from 'node:test';
import { syncCalendarsFromLessons } from '../src/modules/lessons/lesson.repository';

test('đồng bộ lịch theo session_id hoặc code + learn_number và vá lại session_id', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
      calls.push({ sql, values });
      return 2;
    },
  };

  await syncCalendarsFromLessons(tx, [22n, 23n]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [22n, 23n]);
  assert.match(calls[0].sql, /lesson\.id = calendar_row\.session_id/);
  assert.match(calls[0].sql, /calendar_row\.code = lesson\.subject_code/);
  assert.match(calls[0].sql, /calendar_row\.learn_number = lesson\.learn_number/);
  assert.match(calls[0].sql, /SET calendar_row\.session_id = lesson\.id/);
  assert.match(calls[0].sql, /calendar_row\.lesson_name = lesson\.lesson_name/);
});

test('không chạy update calendar khi không có lesson cần đồng bộ', async () => {
  let called = false;
  await syncCalendarsFromLessons({
    $executeRawUnsafe: async () => { called = true; },
  }, []);
  assert.equal(called, false);
});
