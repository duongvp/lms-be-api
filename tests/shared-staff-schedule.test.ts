import assert from 'node:assert/strict';
import test from 'node:test';
import { checkConflict, ScheduleConflictError, validateBulkFinalStateConflicts, validateBulkScheduleConflicts } from '../src/modules/livestream/livestream.service';

const at = (time: string) => new Date(`2026-11-02T${time}:00.000Z`);
const candidate = {
  code: 'PROGRAM-A', lesson_name: 'Phương trình bậc hai',
  teacher: 'teacher-a', assistant_teacher: 'assistant-a,assistant-b',
  start_time: at('08:00'), end_time: at('10:00'),
};
const existing = { ...candidate, id: 1, code: 'PROGRAM-B', learn_number: 12 };
const check = (input: Record<string, unknown> = {}, rows: any[] = [existing]) => checkConflict({
  ...candidate, ...input,
  client: {
    calendar: { findMany: async ({ where }: any) => rows.filter((row) => (
      where.teacher ? row.teacher === where.teacher : row.code === where.code
    )) },
    $queryRaw: async () => rows,
  },
});

for (const flag of [undefined, false, 'true', 1]) {
  test(`chỉ chấp nhận boolean true; vẫn chặn với ${String(flag)}`, async () => {
    await assert.rejects(check({ allow_shared_staff_schedule: flag }), ScheduleConflictError);
  });
}

test('cho phép cùng GV và nhiều TG dạy chung từ 3 chương trình trở lên', async () => {
  await check({ allow_shared_staff_schedule: true }, [existing, { ...existing, id: 2, code: 'PROGRAM-C' }]);
});

test('chuẩn hóa Unicode, khoảng trắng và chữ hoa/thường của tên bài có dấu', async () => {
  await check({ allow_shared_staff_schedule: true, lesson_name: '  PHƯƠNG  TRÌNH BẬC HAI '.normalize('NFD') });
});

for (const [label, change] of Object.entries({
  'khác tên bài': { lesson_name: 'Hàm số bậc hai' },
  'thiếu tên bài': { lesson_name: null },
  'tên bài rỗng': { lesson_name: '   ' },
  'khác giờ bắt đầu': { start_time: at('08:30') },
  'khác giờ kết thúc': { end_time: at('09:30') },
  'chỉ chồng một phần': { start_time: at('09:00'), end_time: at('11:00') },
  'cùng chương trình': { code: 'PROGRAM-B' },
  'thiếu mã chương trình': { code: undefined },
})) {
  test(`bật tùy chọn vẫn chặn khi ${label}`, async () => {
    await assert.rejects(check({ allow_shared_staff_schedule: true, ...change }), ScheduleConflictError);
  });
}

test('thiếu tên bài ở lịch cũ vẫn bị chặn', async () => {
  await assert.rejects(check({ allow_shared_staff_schedule: true }, [{ ...existing, lesson_name: null }]), ScheduleConflictError);
});

test('vẫn kiểm tra tất cả lịch trùng GV/TG sau khi bỏ qua lịch chung hợp lệ', async () => {
  await assert.rejects(check({ allow_shared_staff_schedule: true }, [
    existing,
    { ...existing, id: 2, code: 'PROGRAM-C', lesson_name: 'Bài khác', assistant_teacher: '' },
    { ...existing, id: 3, code: 'PROGRAM-D', teacher: 'other-teacher', end_time: at('11:00') },
  ]), (error: unknown) => {
    assert.ok(error instanceof ScheduleConflictError);
    assert.deepEqual(error.conflicts.map((item) => item.id).sort(), [2, 3]);
    assert.equal(error.conflicts.find((item) => item.id === 3)?.staff_type, 'assistant');
    return true;
  });
});

test('tùy chọn áp dụng độc lập cho TG khi không trùng GV', async () => {
  await check({ allow_shared_staff_schedule: true, teacher: 'other-teacher' });
  await assert.rejects(check({ allow_shared_staff_schedule: true, teacher: 'other-teacher', lesson_name: 'Bài khác' }), ScheduleConflictError);
});

test('cùng chương trình vẫn chặn dù không trùng nhân sự', async () => {
  await assert.rejects(check({ allow_shared_staff_schedule: true, code: existing.code, teacher: 'other', assistant_teacher: '' }), ScheduleConflictError);
});

test('so thời gian theo độ chính xác phút giống quy tắc lịch hiện có', async () => {
  await check({ allow_shared_staff_schedule: true }, [{
    ...existing, start_time: new Date('2026-11-02T08:00:35.000Z'),
    end_time: new Date('2026-11-02T10:00:40.000Z'),
  }]);
});

const bulkCandidates = [
  { ...candidate, id: 10 },
  { ...existing, id: 11 },
  { ...existing, id: 12, code: 'PROGRAM-C' },
];
const sharedOptions = { allow_shared_staff_schedule: true };
const now = new Date('2026-11-01T00:00:00.000Z');

test('sửa hàng loạt cho phép GV và nhiều TG chung giờ giữa nhiều chương trình trong lô', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts(bulkCandidates, sharedOptions));
});

for (const flag of [undefined, false, 'true', 1]) {
  test(`sửa hàng loạt mặc định chặn trùng trong lô với tùy chọn ${String(flag)}`, () => {
    assert.throws(() => validateBulkFinalStateConflicts(bulkCandidates, { allow_shared_staff_schedule: flag }), ScheduleConflictError);
  });
}

for (const [label, changes] of Object.entries({
  'khác tên cuối cùng': { lesson_name: 'Bài khác' },
  'thiếu tên bài': { lesson_name: null },
  'lệch giờ bắt đầu': { start_time: at('08:30') },
  'lệch giờ kết thúc': { end_time: at('10:30') },
  'cùng chương trình': { code: candidate.code },
})) {
  test(`sửa hàng loạt vẫn chặn trong lô khi ${label}`, () => {
    assert.throws(() => validateBulkFinalStateConflicts([
      bulkCandidates[0], { ...bulkCandidates[1], ...changes },
    ], sharedOptions), ScheduleConflictError);
  });
}

const bulkClient = (rows: any[]) => ({
  calendar: { findMany: async ({ where }: any) => rows.filter((row) => (
    (where.teacher ? row.teacher === where.teacher : row.code === where.code)
    && !where.id?.notIn?.includes(row.id)
  )) },
  $queryRaw: async () => rows,
});

test('sửa hàng loạt kiểm tra cùng quy tắc với cả lịch trong lô và ngoài lô', async () => {
  const outside = { ...existing, id: 20, code: 'PROGRAM-D' };
  await validateBulkScheduleConflicts(bulkCandidates, [10, 11, 12], bulkClient([outside]), now, sharedOptions);
  await assert.rejects(validateBulkScheduleConflicts(
    bulkCandidates, [10, 11, 12], bulkClient([outside]), now,
  ), ScheduleConflictError);
});

test('lô hợp lệ vẫn bị chặn khi trùng GV hoặc TG với lịch ngoài lô không hợp lệ', async () => {
  await assert.rejects(validateBulkScheduleConflicts(bulkCandidates, [10, 11, 12], bulkClient([
    { ...existing, id: 20, code: 'PROGRAM-D' },
    { ...existing, id: 21, code: 'PROGRAM-E', lesson_name: 'Bài khác', assistant_teacher: '' },
    { ...existing, id: 22, code: 'PROGRAM-F', teacher: 'other-teacher', end_time: at('11:00') },
  ]), now, sharedOptions), (error: unknown) => {
    assert.ok(error instanceof ScheduleConflictError);
    assert.deepEqual(error.conflicts.map((item) => item.id).sort(), [21, 22]);
    return true;
  });
});

test('sửa hàng loạt không bỏ qua xung đột cùng chương trình với lịch ngoài lô', async () => {
  await assert.rejects(validateBulkScheduleConflicts(
    bulkCandidates, [10, 11, 12], bulkClient([{ ...candidate, id: 20, teacher: 'other', assistant_teacher: '' }]), now, sharedOptions,
  ), ScheduleConflictError);
});

test('trong lô có cặp hợp lệ vẫn chặn lịch thứ ba khác bài và gom đủ xung đột', () => {
  assert.throws(() => validateBulkFinalStateConflicts([
    ...bulkCandidates, { ...existing, id: 13, code: 'PROGRAM-D', lesson_name: 'Bài khác' },
  ], sharedOptions), (error: unknown) => {
    assert.ok(error instanceof ScheduleConflictError);
    assert.deepEqual(error.conflicts.map((item) => item.id).sort(), [10, 11, 12, 13]);
    return true;
  });
});
