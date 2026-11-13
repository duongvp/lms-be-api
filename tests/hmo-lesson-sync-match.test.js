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

test('ưu tiên session đúng tháng, fallback khi Course chỉ có một ứng viên', () => {
  const feedRow = { ...row(1, '2026-10-14T22:00:00Z', ''), subject_code: 'feed-topic', source_lesson_name: 'Bài giảng' };
  const options = [
    { lessonId: 'oct', name: 'Bài giảng', sectionName: 'Tháng 10/2026' },
    { lessonId: 'topic', name: 'Bài giảng', sectionName: 'Chuyên đề' },
  ];
  assert.equal(matchCalendarsForCourse([feedRow], options).get(1).lessonId, 'oct');
  assert.equal(matchCalendarsForCourse([{ ...feedRow, start_time: '2026-11-14' }], options.slice(0, 1)).get(1).lessonId, 'oct');
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

test('session không chia tháng duy nhất được tự ghép khi tên và giáo viên khớp', () => {
  const result = matchCalendarsForCourse([
    row(1, '2027-03-10T18:00:00.000Z', 'Nguyễn Thị Chi'),
  ], [{
    lessonId: '900001',
    name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi',
    sectionName: 'Học tập tương tác',
  }]);

  assert.equal(result.get(1).lessonId, '900001');
});

test('một lịch với một ứng viên duy nhất vẫn tự map dù section thiếu năm', () => {
  const result = matchCalendarsForCourse([
    row(2, '2027-03-10T18:00:00.000Z', 'Nguyễn Thị Chi'),
  ], [{
    lessonId: '900002',
    name: 'Ôn tập phân số và số thập phân_Cô Nguyễn Thị Chi',
    sectionName: 'Tháng 3',
  }]);

  assert.equal(result.get(2).lessonId, '900002');
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


test('không tự map vào section (BỎ), chọn section Chặng 1 còn hiệu lực', () => {
  const source_lesson_name = 'Lí thuyết đọc hiểu truyện ngắn hiện đại';
  for (const marker of ['(BỎ)', '(bỏ)', '(Bỏ)', '(bỎ)']) {
    const result = matchCalendarsForCourse([
      { ...row(1, '2026-11-11T14:00:00Z', ''), source_lesson_name },
    ], [
      { lessonId: '179133', name: source_lesson_name, sectionId: 'old', sectionName: `Chặng 1 ${marker}` },
      { lessonId: '179163', name: source_lesson_name, sectionId: 'active', sectionName: 'Chặng 1: Các chủ đề trọng tâm - Học kì I' },
    ]);
    assert.equal(result.get(1).lessonId, '179163');
  }
});

test('nhận diện tháng sau tiền tố môn và dấu gạch dưới cho từng Course TSA', () => {
  const title = 'Luyện đề TSA-OD-Phần Tư duy Toán-P2';
  for (const lessonId of ['179222', '179491']) {
    const options = [{ lessonId, name: title, sectionName: 'TOÁN_Tháng 12/2026' }];
    const calendar = { ...row(1, '2026-12-04T11:00:00Z', ''), source_lesson_name: title };
    assert.equal(matchCalendarsForCourse([calendar], options).get(1).lessonId, lessonId);
    assert.equal(matchCalendarsForCourse([{ ...calendar, start_time: '2026-11-04' }], options).get(1).lessonId, lessonId);
    assert.equal(matchCalendarsForCourse([{ ...calendar, start_time: '2027-12-04' }], options).get(1).lessonId, lessonId);
  }
});

test('một lịch vẫn cần xác định session nếu cùng Course có nhiều Lesson khớp', () => {
  const calendar = row(1, '2026-11-04T11:00:00Z', 'Nguyễn Thị Chi');
  const result = matchCalendarsForCourse([calendar], [
    { lessonId: 'a', name: `${title}_Cô Nguyễn Thị Chi`, sectionName: 'TOÁN_Tháng 12/2026' },
    { lessonId: 'b', name: `${title}_Cô Nguyễn Thị Chi`, sectionName: 'TOÁN_Tháng 9/2026' },
  ]);
  assert.equal(result.get(1).ambiguityReason, 'SESSION_UNCERTAIN');
});


test('một lịch có hai ID cùng tên trong cùng section bắt chọn tay', () => {
  const calendar = row(1, '2027-02-25T18:00:00Z', 'Dương Thùy Linh');
  const result = matchCalendarsForCourse([calendar], [
    { lessonId: 'a', name: `${title}_Cô Dương Thùy Linh`, sectionName: 'Tháng 2/2027' },
    { lessonId: 'b', name: `${title}_Cô Dương Thùy Linh`, sectionName: 'Tháng 2/2027' },
  ]);
  assert.equal(result.get(1).lessonId, undefined);
  assert.equal(result.get(1).ambiguityReason, 'MULTIPLE_MATCHES');
  assert.equal(result.get(1).candidateCount, 2);
});

test('một lịch chọn tháng đúng trước khi xét nhiều Lesson cùng tên', () => {
  const calendar = row(1, '2027-02-25T18:00:00Z', 'Dương Thùy Linh');
  const options = [
    { lessonId: 'feb', name: `${title}_Cô Dương Thùy Linh`, sectionName: 'TOÁN_Tháng 2/2027' },
    { lessonId: 'apr', name: `${title}_Cô Dương Thùy Linh`, sectionName: 'TOÁN_Tháng 4/2027' },
  ];
  assert.equal(matchCalendarsForCourse([calendar], options).get(1).lessonId, 'feb');
  const duplicate = matchCalendarsForCourse([calendar], [...options, { ...options[0], lessonId: 'duplicate-feb' }]);
  assert.equal(duplicate.get(1).ambiguityReason, 'MULTIPLE_MATCHES');
});
