import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBulkFinalStateConflicts } from '../src/modules/livestream/livestream.service';

const at = (date: string, hour: string) => new Date(`${date}T${hour}:00.000Z`);

test('cho phép dời dây chuyền các lịch của cùng giáo viên khi trạng thái cuối không trùng', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      teacher: 'Giáo viên A',
      code: 'COURSE-1',
      start_time: at('2026-08-28', '08:00'),
      end_time: at('2026-08-28', '10:00'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      code: 'COURSE-1',
      start_time: at('2026-09-02', '08:00'),
      end_time: at('2026-09-02', '10:00'),
    },
  ]));
});

test('từ chối khi trạng thái cuối của hai lịch vẫn trùng giáo viên', () => {
  assert.throws(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      teacher: 'Giáo viên A',
      code: 'COURSE-1',
      learn_number: 10,
      lesson_name: 'Bài thứ nhất',
      start_time: at('2026-08-28', '08:00'),
      end_time: at('2026-08-28', '10:00'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      code: 'COURSE-2',
      learn_number: 20,
      lesson_name: 'Bài thứ hai',
      start_time: at('2026-08-28', '09:00'),
      end_time: at('2026-08-28', '11:00'),
    },
  ]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Trùng lịch giáo viên: “Giáo viên A”/);
    assert.match(error.message, /khóa COURSE-1, Bài 10, “Bài thứ nhất”, ID lịch 1/);
    assert.match(error.message, /28\/08\/2026 08:00–28\/08\/2026 10:00/);
    assert.match(error.message, /khóa COURSE-2, Bài 20, “Bài thứ hai”, ID lịch 2/);
    return true;
  });
});

test('hai lịch nối tiếp sát giờ không bị xem là trùng', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      teacher: 'Giáo viên A',
      start_time: at('2026-08-28', '08:00'),
      end_time: at('2026-08-28', '10:00'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      start_time: at('2026-08-28', '10:00'),
      end_time: at('2026-08-28', '12:00'),
    },
  ]));
});

test('bỏ qua phần giây ẩn khi hai lịch giáo viên nối tiếp cùng phút', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      teacher: 'Giáo viên A',
      start_time: at('2026-08-28', '08:00'),
      end_time: new Date('2026-08-28T09:30:45.000Z'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      start_time: at('2026-08-28', '09:30'),
      end_time: at('2026-08-28', '11:00'),
    },
  ]));
});

test('hai lịch trợ giảng nối tiếp cùng phút không bị xem là trùng', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      assistant_teacher: 'trogiang-a',
      start_time: at('2026-08-28', '08:00'),
      end_time: new Date('2026-08-28T09:30:45.000Z'),
    },
    {
      id: 2,
      assistant_teacher: 'trogiang-a',
      start_time: at('2026-08-28', '09:30'),
      end_time: at('2026-08-28', '11:00'),
    },
  ]));
});

test('lịch nghỉ học không gây trùng giáo viên hoặc trợ giảng', () => {
  assert.doesNotThrow(() => validateBulkFinalStateConflicts([
    {
      id: 1,
      teacher: 'Giáo viên A',
      assistant_teacher: 'trogiang-a',
      lesson_status: 1,
      start_time: at('2026-08-28', '09:00'),
      end_time: at('2026-08-28', '11:00'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      assistant_teacher: 'trogiang-a',
      lesson_status: 0,
      start_time: at('2026-08-28', '09:30'),
      end_time: at('2026-08-28', '10:30'),
    },
  ]));
});

test('thông báo rõ trợ giảng và hai lịch bị trùng trong cập nhật hàng loạt', () => {
  assert.throws(() => validateBulkFinalStateConflicts([
    {
      id: 11,
      assistant_teacher: 'trogiang-a,trogiang-b',
      code: 'COURSE-11',
      learn_number: 11,
      lesson_name: 'Lịch thứ nhất',
      start_time: at('2026-09-08', '18:00'),
      end_time: at('2026-09-08', '20:00'),
    },
    {
      id: 12,
      assistant_teacher: 'trogiang-b',
      code: 'COURSE-12',
      learn_number: 12,
      lesson_name: 'Lịch thứ hai',
      start_time: at('2026-09-08', '19:00'),
      end_time: at('2026-09-08', '21:00'),
    },
  ]), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Trùng lịch trợ giảng: “trogiang-b”/);
    assert.match(error.message, /khóa COURSE-11, Bài 11, “Lịch thứ nhất”, ID lịch 11/);
    assert.match(error.message, /khóa COURSE-12, Bài 12, “Lịch thứ hai”, ID lịch 12/);
    return true;
  });
});
