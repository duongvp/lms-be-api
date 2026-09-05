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
      start_time: at('2026-08-28', '08:00'),
      end_time: at('2026-08-28', '10:00'),
    },
    {
      id: 2,
      teacher: 'Giáo viên A',
      start_time: at('2026-08-28', '09:00'),
      end_time: at('2026-08-28', '11:00'),
    },
  ]), /Trùng lịch giáo viên/);
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
