import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import prisma from '../src/lib/prisma';
import { getCalendarRowsForExport } from '../src/modules/livestream/livestream.service';
import { buildOperationalCalendarWorkbook } from '../src/modules/livestream/livestream.io';

test('exports current calendar day, weekday, exact start/end and assistant into workbook', async () => {
  const code = 'tongon2vatlihsav2027';
  const fixtures = [
    { id: 4365, key: 'session1', code, learn_number: 1, session_id: 10n, system_type: 'topuni', subject: 'Vật lí', teacher: 'gv', assistant_teacher: null, lesson_name: 'Động học', start_time: new Date('2026-09-08T20:00:00Z'), end_time: new Date('2026-09-08T21:00:00Z'), lesson_document: '[{"link":"https://example.test/doc"}]', lesson_baitap: 'Bài tập', lesson_link: 'link1' },
    { id: 4366, key: 'session2', code, learn_number: 2, session_id: 11n, system_type: 'topuni', subject: 'Vật lí', teacher: 'gv', assistant_teacher: 'tg', lesson_name: 'Buổi qua ngày', start_time: new Date('2026-12-31T23:30:00Z'), end_time: new Date('2027-01-01T00:45:00Z') },
  ];
  const stub = (target: any, name: string, replacement: (...args: any[]) => any) => {
    const original = target[name];
    target[name] = replacement;
    return () => { target[name] = original; };
  };
  const mocks = [
    stub(prisma.calendar, 'findMany', async () => fixtures.map(row => ({ ...row }))),
    stub(prisma.lessons, 'findMany', async () => fixtures.map(row => ({ id: row.session_id, subject_code: code, system_type: 'topuni', subject_name: 'Vật lí', learn_number: row.learn_number }))),
    stub(prisma.lesson_course_mapping, 'findMany', async () => []),
    stub(prisma.package_lesson_mapping, 'findMany', async () => [{ key: 'session1', course_id: '3444', lesson_id: '176249', package_id: '9294' }]),
    stub(prisma.teacher_profiles, 'findMany', async () => [{ username: 'gv', display_name: 'Nguyễn Hữu Tình' }, { username: 'tg', display_name: 'Trợ Giảng A' }]),
    stub(prisma, '$queryRaw', async () => fixtures.map(row => ({ id: row.id, assistant_teacher: row.assistant_teacher, session_id: row.session_id }))),
  ];
  try {
    const rows = await getCalendarRowsForExport(undefined, null, code);
    const wb = XLSX.read(buildOperationalCalendarWorkbook(rows), { type: 'buffer' });
    const matrix = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const column = (row: number, name: string) => matrix[row][matrix[0].indexOf(name)] ?? '';
    assert.equal(column(1, 'Ngày live'), '08/09/2026');
    assert.equal(column(1, 'Thứ'), 'Thứ 3');
    assert.equal(column(1, 'Khung giờ'), '20:00-21:00');
    assert.equal(column(1, 'Trợ giảng'), '');
    assert.equal(column(1, 'Tên GV'), 'Nguyễn Hữu Tình');
    assert.equal(column(1, 'ID course'), '3444');
    assert.equal(column(1, 'ID Bài giảng'), '176249');
    assert.equal(column(1, 'ID package'), '9294');
    assert.equal(column(1, 'Tài liệu live\n(TL HS)'), 'https://example.test/doc');
    assert.equal(column(2, 'Ngày live'), '31/12/2026');
    assert.equal(column(2, 'Thứ'), 'Thứ 5');
    assert.equal(column(2, 'Khung giờ'), '23:30-00:45');
    assert.equal(column(2, 'Trợ giảng'), 'Trợ Giảng A');
    assert.equal(rows[1].end_time, '2027-01-01 00:45:00');
  } finally { mocks.forEach(restore => restore()); }
});
