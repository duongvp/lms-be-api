const assert = require('node:assert/strict');
const test = require('node:test');

const {
  matchCalendarsForCourse,
} = require('../dist/modules/hmo-lesson-sync/hmo-lesson-sync.service');

const title = 'Ôn tập phân số và số thập phân..';
const candidates = [
  { lessonId: '168530', name: 'Ôn tập phân số và số thập phân_Cô Dương Thùy Linh', sectionName: 'Tháng 2/2027' },
  { lessonId: '168531', name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi', sectionName: 'Tháng 2/2027' },
  { lessonId: '168845', name: 'Ôn tập phân số và số thập phân_Cô Linh', sectionName: 'Tháng 2/2027' },
  { lessonId: '168846', name: 'Ôn tập phân số và số thập phân_Cô Chi', sectionName: 'Tháng 2/2027' },
  { lessonId: '168558', name: 'Ôn tập phân số và số thập phân_Cô Dương Thùy Linh', sectionName: 'Tháng 4/2027' },
  { lessonId: '168559', name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi', sectionName: 'Tháng 4/2027' },
  { lessonId: '168873', name: 'Ôn tập phân số và số thập phân_Cô Linh', sectionName: 'Tháng 4/2027' },
  { lessonId: '168874', name: 'Ôn tập phân số và số thập phân_Cô Chi', sectionName: 'Tháng 4/2027' },
];

const row = (calendarId, startTime, teacher, lessonName = title, lessonCount = 0) => ({
  calendar_id: calendarId,
  source_lesson_name: title,
  lesson_name: lessonName,
  lesson_count: lessonCount,
  start_time: startTime,
  teacher,
});

test('Feed tự ghép tên bài trong session chuyên đề hoặc không có tên session', () => {
  for (const sectionName of ['Trạm tiếp sức tri thức', undefined]) {
    const result = matchCalendarsForCourse([
      { ...row(1, '2026-10-14T22:00:00Z', 'Nguyễn Thị Mai'), subject_code: 'feed-tramtiepsuctrithuc', source_lesson_name: 'Bài giảng' },
    ], [
      { lessonId: 'a', name: 'Bài giảng_Cô Mai', sectionName },
      { lessonId: 'b', name: 'Bài giảng_Cô Lan', sectionName },
    ]);
    assert.equal(result.get(1).lessonId, 'a');
  }
});

test('Feed không tự ghép khi nhiều session chuyên đề cùng khớp', () => {
  const result = matchCalendarsForCourse([
    { ...row(1, '2026-10-14T22:00:00Z', ''), subject_code: 'feed-topic', source_lesson_name: 'Bài giảng' },
  ], ['a', 'b'].map((id) => ({ lessonId: id, name: 'Bài giảng', sectionId: id, sectionName: 'Chuyên đề' })));
  assert.equal(result.get(1).ambiguityReason, 'SESSION_UNCERTAIN');
});

test('Feed vẫn ưu tiên session đúng tháng, không lấy session tháng khác làm fallback', () => {
  const feedRow = { ...row(1, '2026-10-14T22:00:00Z', ''), subject_code: 'feed-topic', source_lesson_name: 'Bài giảng' };
  const options = [
    { lessonId: 'oct', name: 'Bài giảng', sectionName: 'Tháng 10/2026' },
    { lessonId: 'topic', name: 'Bài giảng', sectionName: 'Chuyên đề' },
  ];
  assert.equal(matchCalendarsForCourse([feedRow], options).get(1).lessonId, 'oct');
  assert.equal(matchCalendarsForCourse([{ ...feedRow, start_time: '2026-11-14' }], options.slice(0, 1)).get(1).ambiguityReason, 'SESSION_UNCERTAIN');
});

test('Lịch 2 của bài 67 không lấy nhầm Lesson cùng tên thuộc bài 81', () => {
  const result = matchCalendarsForCourse([
    row(2997, '2027-02-25T18:00:00.000Z', 'Dương Thùy Linh'),
    row(3019, '2027-02-27T20:00:00.000Z', 'Nguyễn Thị Chi', '[Lịch 2] - ' + title, 1),
  ], candidates);

  assert.equal(result.get(2997).lessonId, '168530');
  assert.equal(result.get(3019).lessonId, '168531');
});

test('bài 81 chọn Lesson cùng tên trong đúng session tháng 4/2027', () => {
  const result = matchCalendarsForCourse([
    row(3473, '2027-04-15T18:00:00.000Z', 'Dương Thùy Linh'),
    row(3484, '2027-04-17T20:00:00.000Z', 'Nguyễn Thị Chi'),
  ], candidates);

  assert.equal(result.get(3473).lessonId, '168558');
  assert.equal(result.get(3484).lessonId, '168559');
});

test('session không phải Tháng M/YYYY bắt buộc chọn thủ công', () => {
  const result = matchCalendarsForCourse([
    row(1, '2027-03-10T18:00:00.000Z', 'Nguyễn Thị Chi'),
  ], [{
    lessonId: '900001',
    name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi',
    sectionName: 'Học tập tương tác',
  }]);

  assert.deepEqual(result.get(1), {
    errorCode: 'AMBIGUOUS',
    ambiguityReason: 'SESSION_UNCERTAIN',
    candidateCount: 1,
  });
});

test('session thiếu năm cũng không được tự động chọn', () => {
  const result = matchCalendarsForCourse([
    row(2, '2027-03-10T18:00:00.000Z', 'Nguyễn Thị Chi'),
  ], [{
    lessonId: '900002',
    name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi',
    sectionName: 'Tháng 3',
  }]);

  assert.equal(result.get(2).errorCode, 'AMBIGUOUS');
  assert.equal(result.get(2).ambiguityReason, 'SESSION_UNCERTAIN');
});


test('backend suy ra session duy nhất cho lịch cùng bài bắc qua đầu tháng', () => {
  const result = matchCalendarsForCourse([
    { ...row(2593, '2026-12-31T18:00:00.000Z', 'Dương Thùy Linh'), source_lesson_name: 'Đề luyện cuối kì I_Đề số 04..' },
    { ...row(2604, '2027-01-02T20:00:00.000Z', 'Nguyễn Thị Chi', '[Lịch 2] - Đề luyện cuối kì I_Đề số 04..', 1), source_lesson_name: 'Đề luyện cuối kì I_Đề số 04..' },
  ], [
    { lessonId: '173858', name: 'Ôn tập phân số và số thập phân_Cô Dương Thùy Linh', sectionId: '1097911', sectionName: 'Tháng 12/2026' },
    { lessonId: '173883', name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi', sectionId: '1097911', sectionName: 'Tháng 12/2026' },
  ].map((candidate) => ({
    ...candidate,
    name: candidate.name.replace('Ôn tập phân số và số thập phân', 'Đề luyện cuối kì I_Đề số 04'),
  })));

  assert.equal(result.get(2593).lessonId, '173858');
  assert.equal(result.get(2604).lessonId, '173883');
});
