const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');

const {
  CALENDAR_IMPORT_FILE_COLUMNS,
  parseCalendarImportFile,
  validateCalendarImportRows,
} = require('../dist/modules/livestream/livestream.io');
const {
  buildUniquePackageCoursePairs,
  validateCalendarImportOutlines,
} = require('../dist/modules/livestream/calendar-import.service');
const {
  fetchHocmaiCourseOutlines,
} = require('../dist/integrations/hocmai-course-outline.service');

const buildSheet = (rows) => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...CALENDAR_IMPORT_FILE_COLUMNS],
    ...rows,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const buildMatrixSheet = (matrix) => {
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const sampleRow = (overrides = {}) => [
  'Toán',
  'TOV_TC_T02',
  'Bài giảng 2',
  'Nguyễn Văn A',
  '01/08/2026',
  '7',
  '19:00-21:00',
  '',
  '',
  '',
  '',
  'Trần Thị B',
  '',
  overrides.courseIds ?? '3108, 3117,',
  overrides.lessonIds ?? '168357,168572',
  overrides.packageIds ?? '9025,9028',
  'gv@example.com',
  'tg@example.com',
];

const calendar = {
  system_type: 'topclass',
  code: 'TOV_TC_T02',
  learn_number: 2,
  start_time: '2026-08-01T12:00:00.000Z',
  end_time: '2026-08-01T14:00:00.000Z',
  lesson_status: 0,
};

test('parse format Sheet thực tế thành các danh sách ID độc lập', () => {
  const parsed = parseCalendarImportFile(buildSheet([sampleRow()]), 'import.xlsx');
  const result = validateCalendarImportRows(parsed);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.importRows[0].courseIds, ['3108', '3117']);
  assert.deepEqual(result.importRows[0].lessonIds, ['168357', '168572']);
  assert.deepEqual(result.importRows[0].packageIds, ['9025', '9028']);
  assert.equal(result.importRows[0].calendar.learn_number, 1);
  assert.equal(result.importRows[0].calendar.teacher, 'gv@example.com');
});

test('tự tìm dòng tiêu đề và chấp nhận Mã buổi học có dấu (*)', () => {
  const headers = [...CALENDAR_IMPORT_FILE_COLUMNS];
  headers[1] = 'Mã buổi học (*)';
  const parsed = parseCalendarImportFile(buildMatrixSheet([
    ['DANH SÁCH IMPORT LỊCH HỌC'],
    ['Vui lòng không thay đổi tên cột'],
    [],
    headers,
    sampleRow(),
  ]), 'import-with-title.xlsx');
  const result = validateCalendarImportRows(parsed);

  assert.deepEqual(result.errors, []);
  assert.equal(result.importRows.length, 1);
  assert.equal(result.importRows[0].row, 5);
  assert.equal(result.importRows[0].calendar.code, 'TOV_TC_T02');
});

test('chấp nhận dấu chấm làm ký tự phân cách danh sách ID', () => {
  const parsed = parseCalendarImportFile(
    buildSheet([sampleRow({
      lessonIds: '167537.167605',
      packageIds: '9017.9102',
    })]),
    'dot-separated-ids.xlsx'
  );
  const result = validateCalendarImportRows(parsed);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.importRows[0].lessonIds, ['167537', '167605']);
  assert.deepEqual(result.importRows[0].packageIds, ['9017', '9102']);
});

test('Email GV không bắt buộc và dòng Nghỉ được bỏ qua', () => {
  const restRow = sampleRow();
  restRow[1] = '';
  restRow[2] = 'Nghỉ';
  restRow[16] = '';
  const rowWithoutTeacherEmail = sampleRow();
  rowWithoutTeacherEmail[16] = '';

  const parsed = parseCalendarImportFile(
    buildSheet([restRow, rowWithoutTeacherEmail]),
    'optional-teacher-and-rest.xlsx'
  );
  const result = validateCalendarImportRows(parsed);

  assert.equal(parsed.length, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(result.importRows[0].row, 3);
  assert.equal(result.importRows[0].calendar.teacher, undefined);
});

test('URL trong cột package được xem là package trống để tra theo course', () => {
  const row = sampleRow({
    packageIds: 'https://hocmai.vn/bai-giang-truc-tuyen/174809/.html',
  });
  row[1] = 'NT_N_15_bù';
  row[16] = 'Đang lỗi link 2,3,4 => Đã được xử lí';

  const parsed = parseCalendarImportFile(buildSheet([row]), 'missing-package.xlsx');
  const result = validateCalendarImportRows(parsed);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.importRows[0].packageIds, []);
  assert.equal(result.importRows[0].calendar.learn_number, 1);
  assert.equal(result.importRows[0].calendar.teacher, undefined);
});

test('learn_number chỉ tăng trong cùng một code', () => {
  const firstCodeRow = sampleRow();
  firstCodeRow[1] = 'COURSE_A';
  const otherCodeRow = sampleRow();
  otherCodeRow[1] = 'COURSE_B';
  const secondCodeRow = sampleRow();
  secondCodeRow[1] = 'COURSE_A';

  const parsed = parseCalendarImportFile(
    buildSheet([firstCodeRow, otherCodeRow, secondCodeRow]),
    'learn-number-by-code.xlsx'
  );
  const result = validateCalendarImportRows(parsed);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.importRows.map((row) => ({
      code: row.calendar.code,
      learnNumber: row.calendar.learn_number,
    })),
    [
      { code: 'COURSE_A', learnNumber: 1 },
      { code: 'COURSE_B', learnNumber: 1 },
      { code: 'COURSE_A', learnNumber: 2 },
    ]
  );
});

test('không đọc khối dữ liệu lặp sau một khoảng trống rất lớn trong XLSX', () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...CALENDAR_IMPORT_FILE_COLUMNS],
    sampleRow(),
  ]);
  worksheet.A5001 = { t: 's', v: 'Môn' };
  worksheet.B5001 = { t: 's', v: 'Mã buổi học' };
  worksheet.C5002 = { t: 's', v: 'Quy định vận hành' };
  worksheet['!ref'] = `A1:${XLSX.utils.encode_col(CALENDAR_IMPORT_FILE_COLUMNS.length - 1)}5002`;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const parsed = parseCalendarImportFile(buffer, 'duplicated-tail.xlsx');

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].__rowNumber, 2);
});

test('báo rõ lỗi khi file không có hàng tiêu đề import', () => {
  assert.throws(
    () => parseCalendarImportFile(buildMatrixSheet([
      ['DANH SÁCH IMPORT LỊCH HỌC'],
      ['Không có các cột bắt buộc'],
      sampleRow(),
    ]), 'invalid-header.xlsx'),
    /Không tìm thấy hàng tiêu đề hợp lệ/
  );
});

test('từ chối ID sai format trước khi gọi HMO', () => {
  const parsed = parseCalendarImportFile(
    buildSheet([sampleRow({ packageIds: '9025,abc' })]),
    'import.xlsx'
  );
  const result = validateCalendarImportRows(parsed);
  assert.equal(result.errors[0].errorCode, 'INVALID_PACKAGE_ID');
  assert.equal(result.errors[0].packageId, 'abc');
});

test('không ghép ID theo index, chỉ giữ quan hệ HMO xác nhận', () => {
  const rows = [{
    row: 2,
    packageIds: ['9025', '9028'],
    courseIds: ['3108', '3117'],
    lessonIds: ['168357', '168572'],
    calendar,
  }];
  const pairs = [
    { packageId: '9025', courseId: '3108' },
    { packageId: '9025', courseId: '3117' },
    { packageId: '9028', courseId: '3108' },
    { packageId: '9028', courseId: '3117' },
  ];
  const results = [
    {
      packageId: '9025',
      courseId: '3108',
      exists: true,
      lessons: [{ lessonId: '168357' }],
    },
    {
      packageId: '9025',
      courseId: '3117',
      exists: false,
      lessons: [],
    },
    {
      packageId: '9028',
      courseId: '3108',
      exists: false,
      lessons: [],
    },
    {
      packageId: '9028',
      courseId: '3117',
      exists: true,
      lessons: [{ lessonId: '168572' }],
    },
  ];
  const result = validateCalendarImportOutlines(rows, pairs, results);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.resolvedRows[0].mappings, [
    { package_id: '9025', course_id: '3108', lesson_id: '168357' },
    { package_id: '9028', course_id: '3117', lesson_id: '168572' },
  ]);
});

test('giữ đúng cặp package-course khi package được suy ra từ sheet mapping', () => {
  const rows = [{
    row: 2,
    packageIds: ['9025', '9028'],
    courseIds: ['3108', '3117'],
    lessonIds: ['168357', '168572'],
    packageCoursePairs: [
      { packageId: '9025', courseId: '3108' },
      { packageId: '9028', courseId: '3117' },
    ],
    calendar,
  }];

  assert.deepEqual(buildUniquePackageCoursePairs(rows), [
    { packageId: '9025', courseId: '3108' },
    { packageId: '9028', courseId: '3117' },
  ]);
});

test('map partial/missing HMO response về đúng dòng', () => {
  const rows = [{
    row: 9,
    packageIds: ['9025'],
    courseIds: ['3108'],
    lessonIds: ['168357'],
    calendar,
  }];
  const result = validateCalendarImportOutlines(
    rows,
    [{ packageId: '9025', courseId: '3108' }],
    []
  );
  assert.ok(result.errors.some((error) => (
    error.row === 9
    && error.errorCode === 'HMO_INVALID_RESPONSE'
    && error.packageId === '9025'
    && error.courseId === '3108'
  )));
});

test('phân biệt lesson không tồn tại và lesson sai context', () => {
  const rows = [
    {
      row: 2,
      packageIds: ['9025'],
      courseIds: ['3108'],
      lessonIds: ['999999', '168572'],
      calendar,
    },
    {
      row: 3,
      packageIds: ['9028'],
      courseIds: ['3117'],
      lessonIds: ['168572'],
      calendar: {
        ...calendar,
        code: 'TOV_TC_T03',
        learn_number: 3,
      },
    },
  ];
  const pairs = [
    { packageId: '9025', courseId: '3108' },
    { packageId: '9028', courseId: '3117' },
  ];
  const results = [
    {
      packageId: '9025',
      courseId: '3108',
      exists: true,
      lessons: [{ lessonId: '168357' }],
    },
    {
      packageId: '9028',
      courseId: '3117',
      exists: true,
      lessons: [{ lessonId: '168572' }],
    },
  ];
  const result = validateCalendarImportOutlines(rows, pairs, results);
  assert.ok(result.errors.some((error) => (
    error.lessonId === '999999' && error.errorCode === 'LESSON_NOT_FOUND'
  )));
  assert.ok(result.errors.some((error) => (
    error.row === 2
    && error.lessonId === '168572'
    && error.errorCode === 'LESSON_NOT_IN_PACKAGE_COURSE'
  )));
});

test('phát hiện lịch trùng trong file', () => {
  const rows = [2, 25].map((row) => ({
    row,
    packageIds: ['9025'],
    courseIds: ['3108'],
    lessonIds: ['168357'],
    calendar,
  }));
  const result = validateCalendarImportOutlines(
    rows,
    [{ packageId: '9025', courseId: '3108' }],
    [{
      packageId: '9025',
      courseId: '3108',
      exists: true,
      lessons: [{ lessonId: '168357' }],
    }]
  );
  const duplicate = result.errors.find(
    (error) => error.errorCode === 'DUPLICATE_SCHEDULE_IN_FILE'
  );
  assert.equal(duplicate.row, 25);
  assert.equal(duplicate.duplicateWithRow, 2);
});

test('parse được file lớn 1.000 dòng mà không gọi HMO theo từng dòng', () => {
  const buffer = buildSheet(
    Array.from({ length: 1000 }, (_, index) => sampleRow({
      lessonIds: String(168000 + index),
    }))
  );
  const parsed = parseCalendarImportFile(buffer, 'large.xlsx');
  const result = validateCalendarImportRows(parsed);
  assert.equal(result.importRows.length, 1000);
  assert.deepEqual(result.errors, []);
  assert.equal(
    buildUniquePackageCoursePairs(result.importRows).length,
    4
  );
});

test('HMO dùng nhiều GET và giới hạn số request chạy đồng thời', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.HMO_COURSE_OUTLINE_URL;
  const originalToken = process.env.HMO_COURSE_OUTLINE_TOKEN;
  const originalConcurrency = process.env.HMO_COURSE_OUTLINE_CONCURRENCY;
  const requests = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  process.env.HMO_COURSE_OUTLINE_URL = 'https://hmo.test/api/course/outline';
  process.env.HMO_COURSE_OUTLINE_TOKEN = 'test-token';
  process.env.HMO_COURSE_OUTLINE_CONCURRENCY = '3';
  global.fetch = async (input, options) => {
    const url = new URL(String(input));
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    requests.push({ url, options });
    await new Promise((resolve) => setTimeout(resolve, 2));
    activeRequests -= 1;
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        package: { id: url.searchParams.get('package') },
        course: {
          id: url.searchParams.get('course'),
          fullname: 'Test course',
          sections: [{
            id: '1',
            name: 'Section',
            lessons: [{ id: '168357', name: 'Lesson' }],
          }],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const pairs = Array.from({ length: 12 }, (_, index) => ({
      packageId: String(9000 + index),
      courseId: String(3000 + index),
    }));
    const results = await fetchHocmaiCourseOutlines(pairs);
    assert.equal(results.length, 12);
    assert.equal(requests.length, 12);
    assert.equal(maxActiveRequests, 3);
    assert.ok(requests.every(({ url, options }) => (
      options.method === 'GET'
      && options.body === undefined
      && url.searchParams.has('course')
      && url.searchParams.has('package')
      && url.searchParams.get('token') === 'test-token'
    )));
    assert.deepEqual(results[0].lessons, [{
      lessonId: '168357',
      name: 'Lesson',
    }]);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.HMO_COURSE_OUTLINE_URL;
    else process.env.HMO_COURSE_OUTLINE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.HMO_COURSE_OUTLINE_TOKEN;
    else process.env.HMO_COURSE_OUTLINE_TOKEN = originalToken;
    if (originalConcurrency === undefined) {
      delete process.env.HMO_COURSE_OUTLINE_CONCURRENCY;
    } else {
      process.env.HMO_COURSE_OUTLINE_CONCURRENCY = originalConcurrency;
    }
  }
});
