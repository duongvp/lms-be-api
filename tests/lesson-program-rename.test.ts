import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { updateLessonProgramSubject } from '../src/modules/lessons/lesson.repository';
import { validateLessonProgramSubjectUpdatePayload } from '../src/modules/lessons/lesson.validation';

const runRename = async (calendarIds: number[], duplicate = false, newProgramCode = 'toan-6-2027', renameCode = true) => {
  const originalTransaction = prisma.$transaction;
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  prisma.$transaction = (async (callback: any) => callback({
    $queryRawUnsafe: async (sql: string) => {
      if (sql.includes('SELECT system_type')) return [{ system_type: 'topclass', grade: 6, subject_name: 'Nhập nhầm' }];
      if (sql.includes('SELECT id FROM calendar')) {
        assert.match(sql, /FOR UPDATE/);
        assert.doesNotMatch(sql, /lesson_status|start_time/);
        return calendarIds.map((id) => ({ id }));
      }
      if (sql.includes('UNION ALL')) return duplicate ? [{ code: newProgramCode }] : [];
      assert.fail(`Query không mong đợi: ${sql}`);
    },
    $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
      writes.push({ sql, values });
      return 1;
    },
  })) as typeof prisma.$transaction;
  try {
    const result = await updateLessonProgramSubject({
      programCode: 'nham-6-2027', subjectName: 'Toán', newProgramCode: renameCode ? newProgramCode : undefined,
    });
    return { result, writes };
  } catch (error) {
    assert.equal(writes.length, 0, 'Lỗi điều kiện phải xảy ra trước khi ghi dữ liệu');
    throw error;
  } finally {
    prisma.$transaction = originalTransaction;
  }
};

test('cho đổi tên/mã chương trình chưa có lịch và giữ cấu hình, quyền truy cập', async () => {
  const { result, writes } = await runRename([]);
  assert.equal(result.program_code, 'toan-6-2027');
  assert.equal(result.subject_name, 'Toán');
  assert.deepEqual(writes[0].values, ['toan-6-2027', 'Toán', 'nham-6-2027']);
  for (const table of ['role_program_scopes', 'room_config', 'program_teacher_banners', 'scope_resources']) {
    assert.ok(writes.some((write) => write.sql.includes(table)), table);
  }
  assert.ok(writes.every((write) => !write.sql.includes('UPDATE calendar')));
});

test('chặn đổi mã khi có bất kỳ lịch nào', async () => {
  await assert.rejects(runRename([10]), /chưa có lịch học nào/);
  await assert.doesNotReject(runRename([10], false, 'nham-6-2027'));
});

test('cho đổi tên môn khi có lịch và đồng bộ tên môn cho lịch quá khứ, lịch nghỉ', async () => {
  const { result, writes } = await runRename([10, 11], false, 'nham-6-2027', false);
  assert.equal(result.program_code, 'nham-6-2027');
  assert.equal(result.calendars_updated, 2);
  const calendarWrite = writes.find((write) => write.sql.includes('UPDATE calendar'));
  assert.ok(calendarWrite);
  assert.deepEqual(calendarWrite.values, ['Toán 6', 'nham-6-2027']);
  assert.doesNotMatch(calendarWrite.sql, /start_time|end_time|lesson_status/);
  assert.ok(!writes.some((write) => write.sql.includes('UPDATE role_program_scopes')));
});

test('chặn mã chương trình trùng trước khi ghi dữ liệu', async () => {
  await assert.rejects(runRename([], true), /đã tồn tại/);
});

test('kiểm tra mã đổi tên và vẫn hỗ trợ yêu cầu cũ chỉ đổi môn', () => {
  const base = { program_code: 'nham-6-2027', subject_name: 'Toán' };
  assert.deepEqual(validateLessonProgramSubjectUpdatePayload(base), base);
  assert.equal(validateLessonProgramSubjectUpdatePayload({ ...base, subject_code: ' toan-6-2027 ' }).subject_code, 'toan-6-2027');
  for (const subject_code of ['', 'mã sai', 'a'.repeat(101)]) {
    assert.throws(() => validateLessonProgramSubjectUpdatePayload({ ...base, subject_code }));
  }
});
