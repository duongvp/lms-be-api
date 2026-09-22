import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { readSheetMetadata, replacementSheetRequests, calendarSessionEnded, calendarSheetFormatting, normalizeSheetPrivateKey, validateSheetExport, spreadsheetIdFromUrl, workbookRequests, splitSheetRequests, writeCalendarWorkbookToSheet } from '../src/integrations/google-sheet-write';
import { getSheetExportJob, startSheetExportJob } from '../src/integrations/google-sheet-export-job';
import { resolveCalendarExportSystem } from '../src/modules/livestream/calendar-export-system';
import { buildOperationalCalendarWorkbook, googleCalendarTabTitles } from '../src/modules/livestream/livestream.io';
import { assistantExportNames, uniqueExportIds, calendarExportPermissionProbes, applyCalendarExportVisibility } from '../src/modules/livestream/calendar-export-fields';

test('xuất ID course và tên trợ giảng theo quyền trường gốc vào đúng cột sheet', () => {
  const names = new Map([['assistant1@example.test', 'Nguyễn Văn A'], ['assistant2@example.test', 'Trần Thị B']]);
  const row = { code: 'program', subject: 'Toán', learn_number: 1,
    assistant_name: assistantExportNames(['assistant1@example.test', 'assistant2@example.test', 'unknown@example.test'], names),
    course_ids: uniqueExportIds(['3360', '3361', '3360', null, '']),
  };
  const probes = calendarExportPermissionProbes([row]);
  assert.equal(probes[0].assistant_teacher, true);
  const visible = applyCalendarExportVisibility([row], [{ code: true, subject: true, learn_number: true, assistant_teacher: true }]);
  const workbook = XLSX.read(buildOperationalCalendarWorkbook(visible), { type: 'buffer' });
  const matrix = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
  assert.equal(matrix[1][matrix[0].indexOf('ID course')], '3360,3361');
  assert.equal(matrix[1][matrix[0].indexOf('Trợ giảng')], 'Nguyễn Văn A, Trần Thị B');
  const hidden = applyCalendarExportVisibility([row], [{ code: true, learn_number: true }]);
  assert.equal(hidden[0].assistant_name, undefined);
  assert.equal(assistantExportNames(['unknown@example.test'], names), '');
});

test('tên tab phân biệt bằng mã chương trình, không dùng số trong ngoặc gây nhầm lớp', () => {
  assert.deepEqual(googleCalendarTabTitles([
    { code: 'tongontienganhvact-va2027', subject: 'Tiếng Anh' },
    { code: 'tongontienganhhsav2027', subject: 'Tiếng Anh' },
  ]), ['Tiếng Anh - tongontienganhhsav2027', 'Tiếng Anh - tongontienganhvact-va2027']);
});

test('hệ đề cương được ưu tiên khi lịch bị gán sai Topuni/Topclass', () => {
  const calendar = { code: 'program', system_type: 'topuni' };
  assert.equal(resolveCalendarExportSystem(calendar, undefined, [{ system_type: 'topclass' }]), 'topclass');
  assert.equal(resolveCalendarExportSystem({ ...calendar, system_type: 'topclass' }, { system_type: 'topuni' }, [{ system_type: 'topclass' }]), 'topuni');
  assert.throws(() => resolveCalendarExportSystem(calendar, undefined, [{ system_type: 'topclass' }, { system_type: 'topuni' }]), /nhiều hệ/);
});

const testPrivateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey.trim();

test('chuẩn hóa dấu ngoặc thừa, xuống dòng bị escape và từ chối khóa sai trước khi gọi Google', () => {
  assert.equal(normalizeSheetPrivateKey(`"${testPrivateKey}`), testPrivateKey);
  assert.equal(normalizeSheetPrivateKey(JSON.stringify(testPrivateKey)), testPrivateKey);
  assert.equal(normalizeSheetPrivateKey(testPrivateKey.replace(/\n/g, '\\\\n')), testPrivateKey);
  const oldEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const oldKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'test@example.test';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = 'not-a-private-key';
  try {
    assert.throws(() => validateSheetExport('https://docs.google.com/spreadsheets/d/id/edit'), /khóa RSA hợp lệ/);
  } finally {
    if (oldEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL; else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SHEETS_PRIVATE_KEY; else process.env.GOOGLE_SHEETS_PRIVATE_KEY = oldKey;
  }
});

test('chỉ nhận link HTTPS của Google Sheets', () => {
  assert.equal(spreadsheetIdFromUrl('https://docs.google.com/spreadsheets/d/sheet_123/edit?usp=sharing'), 'sheet_123');
  for (const url of ['http://docs.google.com/spreadsheets/d/id/edit', 'https://evil.test/spreadsheets/d/id/edit', 'https://docs.google.com.evil.test/spreadsheets/d/id/edit', 'invalid']) {
    assert.throws(() => spreadsheetIdFromUrl(url));
  }
});

test('batch tạo tab mới và giữ công thức dưới dạng văn bản', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Tên', 'ID', 'Giá trị'], ['=IMPORTXML("https://example.com")', '00123', 7]]), 'Chương trình');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const requests = workbookRequests(buffer, 'LMS test') as any[];
  assert.equal(requests.length, 2);
  assert.equal(requests[0].addSheet.properties.title, 'Chương trình LMS test');
  assert.equal(requests[0].addSheet.properties.gridProperties.rowCount, 2);
  assert.equal(requests[1].updateCells.start.sheetId, requests[0].addSheet.properties.sheetId);
  assert.deepEqual(requests[1].updateCells.rows[1].values, [
    { userEnteredValue: { stringValue: '=IMPORTXML("https://example.com")' } },
    { userEnteredValue: { stringValue: '00123' } },
    { userEnteredValue: { numberValue: 7 } },
  ]);
  assert.ok(requests.every((request) => !request.deleteSheet));
});

test('xuất qua googleapis với JWT, timeout và không retry tạo tab', async () => {
  const oldEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const oldKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'test@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = testPrivateKey.replace(/\n/g, '\\n');
  const calls: any[] = [];
  const client = mock.method(google, 'sheets', (options: any) => {
    assert.ok(options.auth instanceof google.auth.JWT);
    assert.equal(options.auth.email, process.env.GOOGLE_SHEETS_CLIENT_EMAIL);
    assert.equal(options.auth.key, testPrivateKey);
    assert.deepEqual(options.auth.scopes, ['https://www.googleapis.com/auth/spreadsheets']);
    return { spreadsheets: { get: async () => ({ data: { sheets: [] } }), batchUpdate: async (...args: any[]) => { calls.push(args); } } } as any;
  });
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Tên'], ['Bài học']]), 'Chương trình');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const result = await writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/test_id/edit');
    assert.equal(result.sheetCount, 1);
    assert.equal(calls[0][0].spreadsheetId, 'test_id');
    assert.equal(calls.length, 4);
    assert.equal(calls[0][0].requestBody.requests[0].addSheet.properties.hidden, true);
    assert.ok(calls[1][0].requestBody.requests[0].updateCells);
    assert.ok(calls[3][0].requestBody.requests.some((request: any) => request.updateSheetProperties?.properties.hidden === false));
    assert.ok(calls[3][0].requestBody.requests.some((request: any) => request.updateSheetProperties?.properties.title === 'Chương trình'));
    assert.deepEqual(calls[0][1], { timeout: 210_000, retry: false });
    client.mock.mockImplementation(() => ({ spreadsheets: { get: async () => ({ data: { sheets: [] } }), batchUpdate: async () => { throw { code: 403, response: { status: 403 } }; } } }) as any);
    await assert.rejects(writeCalendarWorkbookToSheet(buffer, result.sheetUrl), /quyền Chỉnh sửa/);
    client.mock.mockImplementation(() => ({ spreadsheets: { get: async () => ({ data: { sheets: [] } }), batchUpdate: async () => { throw { code: 400, response: { status: 400, data: { error: 'invalid_grant' } } }; } } }) as any);
    await assert.rejects(writeCalendarWorkbookToSheet(buffer, result.sheetUrl), /cùng file/);
  } finally {
    client.mock.restore();
    if (oldEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL; else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SHEETS_PRIVATE_KEY; else process.env.GOOGLE_SHEETS_PRIVATE_KEY = oldKey;
  }
});

test('đọc danh sách tab thử lại khi AbortError có code dạng số 20', async () => {
  let attempts = 0;
  const sheets = { spreadsheets: { get: async (_params: unknown, options: any) => {
    assert.equal(options.timeout, 60000);
    assert.equal(options.retry, false);
    attempts++;
    if (attempts === 1) throw { name: 'AbortError', code: 20, message: 'The operation was aborted.' };
    return { data: { sheets: [{ properties: { sheetId: 1, title: 'Tab' } }] } };
  } } } as any;
  const result = await readSheetMetadata(sheets, 'id');
  assert.equal(attempts, 2);
  assert.equal(result.data.sheets![0].properties!.title, 'Tab');
});

test('chia theo byte UTF-8, ghi đúng vị trí cả khi một dòng cần chia nhiều đợt', () => {
  const rows = [
    { values: Array.from({ length: 8 }, (_, i) => ({ userEnteredValue: { stringValue: `Cột ${i} ${'ộ'.repeat(150)}` } })) },
    { values: [{ userEnteredValue: { stringValue: 'Dòng kế tiếp' } }] },
  ];
  const batches = splitSheetRequests([{ updateCells: { start: { sheetId: 42, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue', rows } }], 2500);
  assert.ok(batches.length > 1);
  const reconstructed: any[][] = [];
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify({ requests: batch })) <= 2500);
    for (const request of batch) {
      const update = request.updateCells!;
      for (const [i, row] of update.rows!.entries()) {
        const index = update.start!.rowIndex! + i;
        reconstructed[index] ||= [];
        row.values!.forEach((cell, j) => { reconstructed[index][update.start!.columnIndex! + j] = cell; });
      }
    }
  }
  assert.deepEqual(reconstructed, rows.map((row) => row.values));
});

test('xuất workbook trên 2 MB trực tiếp bằng nhiều đợt và chỉ hiện tab sau khi ghi đủ', async () => {
  const oldEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const oldKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'large@example.test';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = testPrivateKey;
  const calls: any[][] = [];
  const client = mock.method(google, 'sheets', () => ({ spreadsheets: { get: async () => ({ data: { sheets: [] } }), batchUpdate: async (params: any) => {
    assert.ok(Buffer.byteLength(JSON.stringify(params.requestBody)) <= 1_500_000);
    calls.push(params.requestBody.requests);
  } } }) as any);
  try {
    const matrix = [['Tên bài'], ...Array.from({ length: 600 }, (_, i) => [`Bài ${i} ${'ộ'.repeat(1500)}`])];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), 'Chương trình');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    assert.ok(Buffer.byteLength(JSON.stringify({ requests: workbookRequests(buffer, 'LMS test') })) > 2_000_000);
    const progress: number[] = [];
    const result = await writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/large_id/edit', (percent) => progress.push(percent));
    assert.equal(result.sheetCount, 1);
    const written: string[][] = [];
    for (const batch of calls) for (const request of batch) {
      if (!request.updateCells) continue;
      request.updateCells.rows.forEach((row: any, index: number) => {
        written[request.updateCells.start.rowIndex + index] = row.values.map((cell: any) => cell.userEnteredValue.stringValue);
      });
    }
    assert.deepEqual(written, matrix);
    assert.ok(calls.length > 3);
    assert.ok(calls.at(-1)!.some((request: any) => request.updateSheetProperties?.properties.hidden === false));
    assert.equal(progress.at(-1), 100);
  } finally {
    client.mock.restore();
    if (oldEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL; else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SHEETS_PRIVATE_KEY; else process.env.GOOGLE_SHEETS_PRIVATE_KEY = oldKey;
  }
});

test('lịch kết thúc theo giờ Việt Nam, kể cả buổi qua nửa đêm', () => {
  const now = new Date('2026-09-17T13:00:00Z'); // 20:00 Việt Nam
  assert.equal(calendarSessionEnded('16/09/2026', '18:00-19:30', now), true);
  assert.equal(calendarSessionEnded('17/09/2026', '18:00-19:30', now), true);
  assert.equal(calendarSessionEnded('17/09/2026', '19:00-21:00', now), false);
  assert.equal(calendarSessionEnded('18/09/2026', '18:00-19:30', now), false);
  assert.equal(calendarSessionEnded('17/09/2026', '23:00-01:00', now), false);
  assert.equal(calendarSessionEnded('31/02/2026', '18:00-19:30', now), false);
  assert.equal(calendarSessionEnded('', '', now), false);
});

test('thay toàn bộ tab cũ, gồm tab sai hệ và bản LMS, giữ tên không có thời gian', () => {
  const suffix = 'LMS 2026-09-17T06-40-06-192Z-1448';
  const additions = [{ addSheet: { properties: { sheetId: 100, title: `Tiếng Anh ${suffix}` } } }];
  const requests = replacementSheetRequests(additions, [
    { properties: { sheetId: 1, title: 'Tiếng Anh' } },
    { properties: { sheetId: 2, title: `Tiếng Anh ${suffix}` } },
    { properties: { sheetId: 3, title: 'Toán' } },
    { properties: { sheetId: 4, title: 'Ghi chú' } },
  ], suffix);
  assert.deepEqual(requests.filter((request) => request.deleteSheet).map((request) => request.deleteSheet!.sheetId), [1, 2, 3, 4]);
  assert.equal(requests.at(-1)!.updateSheetProperties!.properties!.title, 'Tiếng Anh');
  assert.equal(requests[0].updateSheetProperties!.properties!.hidden, false);
});

test('xuất lại không tăng số tab và nhận diện commit đã thành công dù timeout', async () => {
  const oldEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const oldKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'overwrite@example.test';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = testPrivateKey;
  const tabs = new Map<number, any>([
    [1, { sheetId: 1, title: 'Chương trình', hidden: false }],
    [2, { sheetId: 2, title: 'Chương trình LMS 2026-09-17T06-40-06-192Z-1448', hidden: false }],
    [3, { sheetId: 3, title: 'Ghi chú', hidden: false }],
  ]);
  let timeoutCommit = false;
  let timeoutCreation = true;
  let creations = 0;
  let commits = 0;
  const client = mock.method(google, 'sheets', () => ({ spreadsheets: {
    get: async () => ({ data: { sheets: [...tabs.values()].map((properties) => ({ properties: { ...properties } })) } }),
    batchUpdate: async (params: any) => {
      const requests = params.requestBody.requests;
      for (const request of requests) {
        if (request.addSheet) tabs.set(request.addSheet.properties.sheetId, { ...request.addSheet.properties });
        if (request.deleteSheet) tabs.delete(request.deleteSheet.sheetId);
        if (request.updateSheetProperties) Object.assign(tabs.get(request.updateSheetProperties.properties.sheetId), request.updateSheetProperties.properties);
      }
      if (requests.some((request: any) => request.addSheet)) {
        creations++;
        if (timeoutCreation) { timeoutCreation = false; throw { code: 20, name: 'AbortError', message: 'The operation was aborted.' }; }
      }
      if (requests.some((request: any) => request.updateSheetProperties?.fields === 'title')) {
        commits++;
        if (timeoutCommit) { timeoutCommit = false; throw { code: 'ETIMEDOUT' }; }
      }
    },
  } }) as any);
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Tên'], ['Bài học']]), 'Chương trình');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/overwrite_id/edit');
    assert.deepEqual([...tabs.values()].map((tab) => tab.title), ['Chương trình']);
    timeoutCommit = true;
    await writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/overwrite_id/edit');
    assert.equal(commits, 2);
    assert.equal(creations, 2);
    assert.equal(tabs.size, 1);
    assert.equal([...tabs.values()].find((tab) => tab.title === 'Chương trình').hidden, false);
    assert.equal(tabs.has(3), false);
  } finally {
    client.mock.restore();
    if (oldEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL; else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SHEETS_PRIVATE_KEY; else process.env.GOOGLE_SHEETS_PRIVATE_KEY = oldKey;
  }
});

test('định dạng tiêu đề và chỉ tô xanh nhạt các hàng đã kết thúc', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Tên bài giảng', 'Ngày live', 'Khung giờ', 'Tài liệu live\n(TL HS)'],
    ['Đã học', '16/09/2026', '18:00-19:30', ''],
    ['Đang học', '17/09/2026', '19:00-21:00', ''],
    ['Đã học khác', '15/09/2026', '18:00-19:30', ''],
  ]), 'Chương trình');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const formatting = calendarSheetFormatting(workbookRequests(buffer, 'test'), new Date('2026-09-17T13:00:00Z'));
  const greenRows = formatting.filter((request) => request.repeatCell?.fields === 'userEnteredFormat.backgroundColor' && request.repeatCell.range!.startRowIndex! > 0);
  assert.deepEqual(greenRows.map((request) => [request.repeatCell!.range!.startRowIndex, request.repeatCell!.range!.endRowIndex]), [[1, 2], [3, 4]]);
  assert.ok(formatting.some((request) => request.repeatCell?.cell?.userEnteredFormat?.textFormat?.bold));
  assert.ok(formatting.some((request) => request.updateBorders?.innerHorizontal));
  assert.ok(formatting.some((request) => request.updateDimensionProperties?.properties?.pixelSize === 330));
});

test('lượt xuất chạy nền, cập nhật tiến độ và chỉ chủ sở hữu được xem', async () => {
  let finish!: (result: { sheetUrl: string; sheetCount: number; rowCount: number }) => void;
  const job = startSheetExportJob(123, 'job-test', async (progress) => {
    progress(50, 'Đang ghi');
    return new Promise((resolve) => { finish = resolve; });
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getSheetExportJob(job.jobId, 123).progress, 50);
  assert.throws(() => getSheetExportJob(job.jobId, 124), /Không tìm thấy/);
  assert.throws(() => startSheetExportJob(123, 'job-test', async () => ({ sheetUrl: '', sheetCount: 0, rowCount: 0 })), /đang được xuất/);
  assert.throws(() => startSheetExportJob(123, ['another-sheet', 'job-test'], async () => ({ sheetUrl: '', sheetCount: 0, rowCount: 0 })), /đang được xuất/);
  finish({ sheetUrl: 'sheet', sheetCount: 2, rowCount: 10 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getSheetExportJob(job.jobId, 123).status, 'completed');
  assert.equal(getSheetExportJob(job.jobId, 123).progress, 100);
  const failed = startSheetExportJob(123, 'job-test', async () => { throw new Error('Test failed'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getSheetExportJob(failed.jobId, 123).status, 'failed');
  assert.equal(getSheetExportJob(failed.jobId, 123).error, 'Test failed');
});

test('thử lại đợt ghi đúng vị trí khi Google lỗi tạm thời và dọn đúng tab tạo dở', async () => {
  const oldEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const oldKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'retry@example.test';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = testPrivateKey;
  let created: any;
  let firstWrite: string | undefined;
  let attempts = 0;
  let shouldFail = false;
  const deletions: number[] = [];
  const client = mock.method(google, 'sheets', () => ({ spreadsheets: {
    batchUpdate: async (params: any) => {
      const requests = params.requestBody.requests;
      if (requests[0].addSheet) created = requests[0].addSheet.properties;
      if (requests[0].updateCells) {
        if (shouldFail) throw { code: 400, response: { status: 400 } };
        const serialized = JSON.stringify(requests);
        attempts++;
        if (attempts === 1) { firstWrite = serialized; throw { response: { status: 503 } }; }
        assert.equal(serialized, firstWrite);
      }
      for (const request of requests) if (request.deleteSheet) deletions.push(request.deleteSheet.sheetId);
    },
    get: async () => ({ data: { sheets: created ? [
      { properties: created },
      { properties: { sheetId: 999, title: 'Tab người dùng' } },
      { properties: { sheetId: 998, title: created.title } },
    ] : [] } }),
  } }) as any);
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Tên'], ['Bài học']]), 'Chương trình');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/retry_id/edit');
    assert.equal(attempts, 2);
    shouldFail = true;
    await assert.rejects(writeCalendarWorkbookToSheet(buffer, 'https://docs.google.com/spreadsheets/d/retry_id/edit'), /Google Sheets từ chối/);
    assert.deepEqual(deletions, [created.sheetId]);
  } finally {
    client.mock.restore();
    if (oldEmail === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_EMAIL; else process.env.GOOGLE_SHEETS_CLIENT_EMAIL = oldEmail;
    if (oldKey === undefined) delete process.env.GOOGLE_SHEETS_PRIVATE_KEY; else process.env.GOOGLE_SHEETS_PRIVATE_KEY = oldKey;
  }
});

test('buổi nghỉ dùng Môn Nghỉ và chữ đỏ toàn dòng, buổi học bù vẫn giữ môn', () => {
  const rows = [
    { code: 'toan-11-2027', subject: 'Toán 11', learn_number: 1, lesson_status: 1, live_date: '08/09/2026', time_range: '20:00-21:00' },
    { code: 'toan-11-2027', subject: 'Toán 11', learn_number: 1, lesson_status: 0, live_date: '22/09/2026', time_range: '20:00-21:00', lesson_name: '[HỌC BÙ] Toán' },
    { code: 'vatli', subject: 'Vật lí', learn_number: 1, system_type: 'topuni', lesson_status: 1, live_date: '22/09/2026', time_range: '20:00-21:00' },
  ];
  const buffer = buildOperationalCalendarWorkbook(rows);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const matrices = wb.SheetNames.map(name => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 }));
  assert.equal(matrices[0][1][0], 'Nghỉ');
  assert.equal(matrices[0][2][0], 'Toán');
  assert.equal(matrices[1][1][0], 'Nghỉ');
  const formatting = calendarSheetFormatting(workbookRequests(buffer, 'test'), new Date('2026-09-17T00:00:00Z'));
  const red = formatting.filter(r => r.repeatCell?.cell?.userEnteredFormat?.textFormat?.foregroundColor?.red === 1 && r.repeatCell?.cell?.userEnteredFormat?.textFormat?.foregroundColor?.green === 0);
  assert.equal(red.length, 2);
  for (const r of red) {
    assert.equal(r.repeatCell!.range!.startRowIndex, 1);
    assert.equal(r.repeatCell!.range!.endRowIndex, 2);
    assert.equal(r.repeatCell!.range!.startColumnIndex, 0);
    assert.equal(r.repeatCell!.range!.endColumnIndex, matrices[0][0].length);
  }
});
