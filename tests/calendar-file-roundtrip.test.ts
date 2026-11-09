import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import prisma from '../src/lib/prisma';
import { buildCalendarFile, buildCalendarTemplate, buildCalendarUpdateFile, buildOperationalCalendarWorkbook, parseCalendarImportFile, validateCalendarImportRows, CALENDAR_FILE_COLUMNS } from '../src/modules/livestream/livestream.io';
import { updateCalendarsFromSheet, importCalendarFromSheet } from '../src/modules/livestream/calendar-import.service';
const context = { code: 'PROGRAM', subject: 'Toán', systemType: 'topuni' as const };
const fixture = {
  key: 'calendar-unique', code: 'PROGRAM', subject: 'Toán', system_type: 'topuni', learn_number: 5, lesson_count: 0,
  lesson_name: 'Bài 5', live_date: '01/08/2099', weekday: '7', time_range: '23:30-00:45',
  teacher_name: 'Cô An', assistant_name: '', lesson_status: 0,
};
const validateFile = (rows: any[], format: 'csv' | 'xlsx' = 'xlsx') => validateCalendarImportRows(
  parseCalendarImportFile(buildCalendarFile(rows, format), `test.${format}`), context,
);
test('CSV and Excel preserve identity, occurrence, system and overnight time', () => {
  for (const format of ['csv', 'xlsx'] as const) {
    const result = validateFile([fixture], format);
    assert.deepEqual(result.errors, []);
    const row = result.importRows[0];
    assert.equal(row.sourceKey, fixture.key);
    assert.equal(row.calendar.learn_number, 5);
    assert.equal(row.calendar.lesson_count, 0);
    assert.equal(row.calendar.system_type, 'topuni');
    assert.equal(row.calendar.start_time, '2099-08-01T23:30:00.000Z');
    assert.equal(row.calendar.end_time, '2099-08-02T00:45:00.000Z');
    assert.equal(row.calendar.teacher, 'Cô An');
    assert.equal(row.calendar.lesson_status, 0);
  }
});
test('rest rows and statuses round trip; invalid status, system and program fail', () => {
  const result = validateFile([{...fixture, lesson_name: 'Nghỉ lễ', lesson_status: 1}, fixture]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.importRows.map(row => row.calendar.lesson_status), [1, 0]);
  const rows = parseCalendarImportFile(buildCalendarFile([fixture], 'xlsx'), 'test.xlsx');
  for (const invalid of ['2', '-1', 'học', '0.5']) {
    assert.equal(validateCalendarImportRows([{...rows[0], lesson_status: invalid}], context).errors.length, 1);
  }
  assert.equal(validateCalendarImportRows([{...rows[0], system_type: 'topclass'}], context).errors.length, 1);
  assert.equal(validateCalendarImportRows([{...rows[0], code: 'WRONG'}], context).errors.length, 1);
});
test('templates share Vietnamese columns and colors without duplicate email columns', () => {
  for (const buffer of [buildCalendarFile([fixture], 'xlsx'), buildCalendarUpdateFile([fixture]), buildCalendarTemplate('xlsx'), buildOperationalCalendarWorkbook([fixture])]) {
    const wb = XLSX.read(buffer, {type:'buffer', cellStyles:true});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, {header:1});
    assert.equal(matrix[0].length, 21);
    assert.deepEqual(matrix[0], CALENDAR_FILE_COLUMNS.map(column => column.header));
    assert.equal(matrix[0].includes('Biên tập viên nội dung'), false);
    assert.equal(matrix[0].includes('Liên kết SharePoint'), false);
    assert.deepEqual(matrix[0].slice(0,4), ['Môn', 'Mã chương trình', 'Bài', 'Lần học']);
    const timeColumn = matrix[0].indexOf('Khung giờ');
    assert.deepEqual(matrix[0].slice(timeColumn,timeColumn+3), ['Khung giờ', 'Tên GV', 'Trợ giảng']);
    assert.equal(matrix[0].some((header: string) => /Email|assistant_teacher|learn_number|lesson_count/.test(header)), false);
    assert.equal(sheet.A1.s.fgColor.rgb, '0C343D');
  }
});
test('exported identity cannot be imported as new', async () => {
  assert.equal((await importCalendarFromSheet(validateFile([fixture]).importRows)).status, 'validation_error');
});
test('time-only overwrite preserves stored assignments and document metadata, supports rest/resume', async () => {
  let current: any = {
    ...fixture, id: 1, teacher: 'teacher@example.test', assistant_teacher: null, session_id: 1n,
    start_time: new Date('2099-08-01T23:30:00Z'), end_time: new Date('2099-08-02T00:45:00Z'),
    lesson_document: '[{"link":"https://example.test/doc","title":"PDF","type":"pdf"}]',
  };
  const originals = {findMany: prisma.calendar.findMany, profiles: prisma.teacher_profiles.findMany, query: prisma.$queryRaw, transaction: prisma.$transaction};
  let captured: unknown[] = [];
  (prisma.calendar as any).findMany = async () => [{...current}];
  (prisma.teacher_profiles as any).findMany = async () => [{username: 'teacher@example.test', display_name: 'Cô An'}];
  (prisma as any).$queryRaw = async () => [{id:1n, subject_code:'PROGRAM', learn_number:5, system_type:'topuni', subject_name:'Toán', lesson_name:'Bài 5'}];
  (prisma as any).$transaction = async (callback: any) => callback({
    $executeRawUnsafe: async (_sql: string, ...values: unknown[]) => {captured = values;},
    calendar: {findMany: async () => []},
  });
  try {
    const unchanged = await updateCalendarsFromSheet(validateFile([{
      ...fixture, lesson_document: 'https://example.test/doc',
    }]).importRows, undefined, 'overwrite');
    assert.equal(unchanged.status, 'success');
    assert.deepEqual(captured, []);
    for (const lessonStatus of [0, 1]) {
      const result = await updateCalendarsFromSheet(validateFile([{
        ...fixture, time_range: '22:30-23:45', lesson_status: lessonStatus, lesson_document: 'https://example.test/doc',
      }]).importRows, undefined, 'overwrite');
      assert.equal(result.status, 'success');
      assert.ok(captured.includes('teacher@example.test'));
      assert.ok(captured.includes(current.lesson_document));
      assert.equal(captured[captured.length - 2], lessonStatus);
      current.lesson_status = 1;
    }
    const badRows = validateFile([fixture]).importRows;
    badRows[0].sourceKey = 'wrong-key';
    assert.equal((await updateCalendarsFromSheet(badRows, undefined, 'overwrite')).status, 'validation_error');
  } finally {
    prisma.calendar.findMany = originals.findMany;
    prisma.teacher_profiles.findMany = originals.profiles;
    prisma.$queryRaw = originals.query;
    prisma.$transaction = originals.transaction;
  }
});

test('Excel marks only ended sessions green, independent of row parity', () => {
  const rows = [
    {...fixture, live_date:'01/01/2000'},
    {...fixture, live_date:'01/01/2099'},
    {...fixture, live_date:'01/01/2099'},
    {...fixture, live_date:'01/01/2000'},
  ];
  for (const buffer of [buildCalendarFile(rows, 'xlsx'), buildCalendarUpdateFile(rows), buildOperationalCalendarWorkbook(rows)]) {
    const wb = XLSX.read(buffer, {type:'buffer',cellStyles:true});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    assert.deepEqual([2,3,4,5].map(row=>sheet[`A${row}`].s.fgColor.rgb), ['B7E1CD','FFFFFF','FFFFFF','B7E1CD']);
  }
});
