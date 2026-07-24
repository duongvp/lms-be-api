import * as XLSX from 'xlsx';
import { LessonExportFormat } from './lesson.types';

export const LESSON_EXPORT_COLUMNS = [
  { key: 'grade', header: 'Grade' },
  { key: 'subject_name', header: 'Subject' },
  { key: 'learn_number', header: 'Learn Number' },
  { key: 'lesson_name', header: 'Lesson Name' },
  { key: 'lesson_document', header: 'Lesson Document' },
  { key: 'lesson_baitap', header: 'Lesson Bài tập' },
  { key: 'lesson_tomtat', header: 'Lesson Tóm tắt' },
  { key: 'lesson_phuongphap', header: 'Lesson Phương pháp' },
  { key: 'lesson_luuy', header: 'Lesson Lưu ý' },
  { key: 'lesson_ketqua', header: 'Lesson Kết quả' },
  { key: 'status', header: 'Status' },
];

const HEADER_ALIASES: Record<string, string> = {
  grade: 'grade',
  khối: 'grade',
  khoi: 'grade',
  subject: 'subject_name',
  'môn học': 'subject_name',
  'mon hoc': 'subject_name',
  subject_name: 'subject_name',
  'learn number': 'learn_number',
  learn_number: 'learn_number',
  'số thứ tự bài': 'learn_number',
  'so thu tu bai': 'learn_number',
  'lesson name': 'lesson_name',
  lesson_name: 'lesson_name',
  'tên bài học': 'lesson_name',
  'ten bai hoc': 'lesson_name',
  'lesson document': 'lesson_document',
  lesson_document: 'lesson_document',
  'tài liệu bài học': 'lesson_document',
  'tai lieu bai hoc': 'lesson_document',
  'lesson bài tập': 'lesson_baitap',
  'lesson bai tap': 'lesson_baitap',
  lesson_baitap: 'lesson_baitap',
  'bài tập': 'lesson_baitap',
  'bai tap': 'lesson_baitap',
  'lesson tóm tắt': 'lesson_tomtat',
  'lesson tom tat': 'lesson_tomtat',
  lesson_tomtat: 'lesson_tomtat',
  'tóm tắt': 'lesson_tomtat',
  'tom tat': 'lesson_tomtat',
  'lesson phương pháp': 'lesson_phuongphap',
  'lesson phuong phap': 'lesson_phuongphap',
  lesson_phuongphap: 'lesson_phuongphap',
  'phương pháp': 'lesson_phuongphap',
  'phuong phap': 'lesson_phuongphap',
  'lesson lưu ý': 'lesson_luuy',
  'lesson luu y': 'lesson_luuy',
  lesson_luuy: 'lesson_luuy',
  'lưu ý': 'lesson_luuy',
  'luu y': 'lesson_luuy',
  'lesson kết quả': 'lesson_ketqua',
  'lesson ket qua': 'lesson_ketqua',
  lesson_ketqua: 'lesson_ketqua',
  'kết quả': 'lesson_ketqua',
  'ket qua': 'lesson_ketqua',
  status: 'status',
  'trạng thái': 'status',
  'trang thai': 'status',
};

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('vi-VN');

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseCsvBuffer = (buffer: Buffer) => {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
};

const normalizeImportRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    const mappedKey = HEADER_ALIASES[normalizeHeader(key)];
    if (mappedKey) normalized[mappedKey] = value;
  });
  return normalized;
});

const toSheetRows = (rows: any[]) => rows.map((row) => (
  Object.fromEntries(
    LESSON_EXPORT_COLUMNS.map((column) => [column.header, row[column.key] ?? ''])
  )
));

export const buildLessonWorkbookBuffer = (rows: any[]) => {
  const worksheet = XLSX.utils.json_to_sheet(toSheetRows(rows), {
    header: LESSON_EXPORT_COLUMNS.map((column) => column.header),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lessons');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export const buildLessonCsvBuffer = (rows: any[]) => {
  const lines = [
    LESSON_EXPORT_COLUMNS.map((column) => escapeCsvValue(column.header)).join(','),
    ...rows.map((row) => LESSON_EXPORT_COLUMNS.map((column) => escapeCsvValue(row[column.key])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};

export const buildLessonTemplateBuffer = (format: LessonExportFormat) => {
  const example = [{
    grade: 6,
    subject_name: 'Toán',
    learn_number: '',
    lesson_name: 'Bài học mẫu',
    lesson_document: '',
    lesson_baitap: '',
    lesson_tomtat: '',
    lesson_phuongphap: '',
    lesson_luuy: '',
    lesson_ketqua: '',
    status: 1,
  }];
  return format === 'csv' ? buildLessonCsvBuffer(example) : buildLessonWorkbookBuffer(example);
};

export const parseLessonImportFile = (buffer: Buffer, originalName: string) => {
  const extension = originalName.split('.').pop()?.toLowerCase();
  if (extension === 'csv') {
    return normalizeImportRows(parseCsvBuffer(buffer));
  }

  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    blankrows: false,
  });

  if (extension !== 'xlsx') {
    return rows;
  }

  return normalizeImportRows(rows);
};

export const buildLessonExportBuffer = (rows: any[], format: LessonExportFormat) => (
  format === 'csv' ? buildLessonCsvBuffer(rows) : buildLessonWorkbookBuffer(rows)
);

export const getLessonExportContentType = (format: LessonExportFormat) => (
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);
