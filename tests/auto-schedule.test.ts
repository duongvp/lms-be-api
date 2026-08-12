import assert from 'node:assert/strict';
import test from 'node:test';
import { previewAutoSchedule } from '../src/modules/livestream/auto-schedule.service';

test('xếp lịch xen kẽ theo block và bỏ qua ngày nghỉ', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-20',
    strategy: 'interleaved',
    holidays: ['2027-06-21'],
    blocks: [
      {
        learn_number: 1,
        sessions: [
          { weekday: 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 6, start_time: '19:00', end_time: '20:30' },
        ],
      },
      {
        learn_number: 2,
        sessions: [
          { weekday: 2, start_time: '19:00', end_time: '20:30' },
          { weekday: 6, start_time: '20:30', end_time: '22:00' },
        ],
      },
    ],
  });

  assert.deepEqual(result.calendars.map((item) => item.learn_number), [1, 2, 1, 2]);
  assert.equal(result.calendars[0].start_time.slice(0, 10), '2027-06-28');
  assert.ok(result.calendars.every((item) => !item.start_time.startsWith('2027-06-21')));
});

test('từ chối khung giờ kết thúc trước giờ bắt đầu', () => {
  assert.throws(() => previewAutoSchedule({
    program_code: 'toan-12-2027',
    system_type: 'topuni',
    start_date: '2027-06-20',
    blocks: [{
      learn_number: 1,
      sessions: [{ weekday: 2, start_time: '20:00', end_time: '19:00' }],
    }],
  }), /Giờ kết thúc/);
});

test('mỗi block cặp sở hữu hai bài và xếp xen kẽ các buổi trong block', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-20',
    strategy: 'interleaved',
    blocks: [{
      lessons: [1, 2].map((learnNumber, index) => ({
        learn_number: learnNumber,
        session_id: String(learnNumber),
        lesson_name: `Bài ${learnNumber}`,
        sessions: [
          { weekday: index + 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 6, start_time: '19:00', end_time: '20:30' },
        ],
      })),
    }],
  });

  assert.deepEqual(result.calendars.map((item) => item.learn_number), [1, 2, 1, 2]);
  assert.deepEqual(result.calendars.map((item) => item.auto_schedule.lesson_index), [0, 1, 0, 1]);
});

test('đưa lesson_id HMO đã chọn vào đúng package/course của calendar', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-21',
    blocks: [{
      lessons: [{
        learn_number: 1,
        session_id: '10',
        lesson_name: 'Bài 1',
        sessions: [{
          weekday: 1,
          start_time: '19:00',
          end_time: '20:30',
          hmo_mappings: [{ package_id: '9099', course_id: '3312', lesson_id: '12345' }],
        }],
      }],
    }],
  });

  assert.deepEqual(result.calendars[0].package_lesson_mappings, [{
    package_ids: ['9099'],
    course_id: '3312',
    lesson_ids: ['12345'],
  }]);
});

test('áp dụng tiền tố và hậu tố từ lần thứ hai của từng bài', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-21',
    customize_lesson_names: true,
    lesson_name_prefix: '[Lịch {n}] - ',
    lesson_name_suffix: ' - Buổi {n}',
    blocks: [{
      lessons: [{
        learn_number: 1,
        session_id: '10',
        lesson_name: 'Đọc hiểu văn bản',
        sessions: [
          { weekday: 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 2, start_time: '19:00', end_time: '20:30' },
        ],
      }],
    }],
  });

  assert.deepEqual(result.calendars.map((item) => item.lesson_name), [
    'Đọc hiểu văn bản',
    '[Lịch 2] - Đọc hiểu văn bản - Buổi 2',
  ]);
  assert.ok(result.calendars.every((item) => !('session_type' in item.auto_schedule)));
});

test('áp dụng mẫu tên khác nhau theo khoảng bài', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-21',
    customize_lesson_names: true,
    lesson_name_rules: [
      { from_learn_number: 1, to_learn_number: 10, prefix: '[Khối 1-{n}] ', suffix: '' },
      { from_learn_number: 11, to_learn_number: 20, prefix: '[Khối 2-{n}] ', suffix: ' - mở rộng' },
    ],
    blocks: [{
      lessons: [1, 11].map((learn_number) => ({
        learn_number,
        lesson_name: `Bài ${learn_number}`,
        sessions: [
          { weekday: 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 2, start_time: '19:00', end_time: '20:30' },
        ],
      })),
    }],
  });

  assert.deepEqual(result.calendars.map((item) => item.lesson_name), [
    'Bài 1',
    '[Khối 1-2] Bài 1',
    'Bài 11',
    '[Khối 2-2] Bài 11 - mở rộng',
  ]);
});

test('bài ngoài khoảng riêng tiếp tục dùng cấu hình tên chung', () => {
  const result = previewAutoSchedule({
    program_code: 'nguvan-6-2027',
    system_type: 'topclass',
    start_date: '2027-06-21',
    customize_lesson_names: true,
    lesson_name_prefix: '[Chung {n}] ',
    lesson_name_suffix: ' - chung',
    lesson_name_rules: [
      { from_learn_number: 1, to_learn_number: 2, prefix: '[Riêng {n}] ', suffix: ' - riêng' },
    ],
    blocks: [{
      lessons: [1, 2, 3].map((learn_number) => ({
        learn_number,
        lesson_name: `Bài ${learn_number}`,
        sessions: [
          { weekday: 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 2, start_time: '19:00', end_time: '20:30' },
        ],
      })),
    }],
  });

  assert.deepEqual(result.calendars.map((item) => item.lesson_name), [
    'Bài 1',
    '[Riêng 2] Bài 1 - riêng',
    'Bài 2',
    '[Riêng 2] Bài 2 - riêng',
    'Bài 3',
    '[Chung 2] Bài 3 - chung',
  ]);
});

test('Topuni chỉ tạo một buổi cho mỗi bài dù payload có nhiều buổi', () => {
  const result = previewAutoSchedule({
    program_code: 'toan-12-2027',
    system_type: 'topuni',
    start_date: '2027-06-21',
    blocks: [{
      lessons: [1, 2].map((learn_number) => ({
        learn_number,
        sessions: [
          { weekday: 1, start_time: '19:00', end_time: '20:30' },
          { weekday: 3, start_time: '19:00', end_time: '20:30' },
        ],
      })),
    }],
  });

  assert.deepEqual(result.calendars.map((item) => item.learn_number), [1, 2]);
});
