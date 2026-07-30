import * as XLSX from 'xlsx';

export type CalendarFileFormat = 'csv' | 'xlsx';

export type CalendarImportError = {
  row: number;
  field: string;
  message: string;
};

export const CALENDAR_FILE_COLUMNS = [
  { key: 'system_type', header: 'System Type' },
  { key: 'code', header: 'Code' },
  { key: 'learn_number', header: 'Learn Number' },
  { key: 'lesson_count', header: 'Lesson Count' },
  { key: 'subject', header: 'Subject' },
  { key: 'teacher', header: 'Teacher' },
  { key: 'lesson_name', header: 'Lesson Name' },
  { key: 'start_time', header: 'Start Time' },
  { key: 'end_time', header: 'End Time' },
  { key: 'channel_name', header: 'Channel Name' },
  { key: 'lesson_status', header: 'Lesson Status' },
  { key: 'package_lesson_mappings', header: 'Course/Lesson Mappings' },
];

const normalizeHeader = (value: unknown) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const HEADER_ALIASES: Record<string, string> = {
  'system type': 'system_type',
  'he thong': 'system_type',
  code: 'code',
  'ma lop': 'code',
  'learn number': 'learn_number',
  'so bai': 'learn_number',
  'lesson count': 'lesson_count',
  'so lan chieu': 'lesson_count',
  subject: 'subject',
  'mon hoc': 'subject',
  teacher: 'teacher',
  'giao vien': 'teacher',
  'lesson name': 'lesson_name',
  'ten bai hoc': 'lesson_name',
  'start time': 'start_time',
  'bat dau': 'start_time',
  'end time': 'end_time',
  'ket thuc': 'end_time',
  'channel name': 'channel_name',
  'phong kenh hoc': 'channel_name',
  'lesson status': 'lesson_status',
  'trang thai': 'lesson_status',
  'course/lesson mappings': 'package_lesson_mappings',
  'course lesson mappings': 'package_lesson_mappings',
  mapping: 'package_lesson_mappings',
};

const normalizeRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    const mappedKey = HEADER_ALIASES[normalizeHeader(key)];
    if (mappedKey) normalized[mappedKey] = value;
  });
  return normalized;
});

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
};

const parseCsvBuffer = (buffer: Buffer) => {
  const lines = buffer.toString('utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
};

export const parseCalendarImportFile = (buffer: Buffer, originalName: string) => {
  const extension = originalName.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return normalizeRows(parseCsvBuffer(buffer));
  if (extension !== 'xlsx') throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');

  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return normalizeRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    blankrows: false,
  }));
};

const parseMappings = (value: unknown) => String(value ?? '')
  .split(';')
  .map((group) => group.trim())
  .filter(Boolean)
  .map((group) => {
    const separator = group.indexOf(':');
    if (separator < 1) throw new Error('Mapping phải có dạng course_id:lesson_id1|lesson_id2');
    const courseId = group.slice(0, separator).trim();
    const lessonIds = group.slice(separator + 1)
      .split('|')
      .map((lessonId) => lessonId.trim())
      .filter(Boolean);
    if (!courseId || !lessonIds.length) {
      throw new Error('Mapping phải có Course ID và ít nhất một Lesson ID');
    }
    return { course_id: courseId, lesson_ids: lessonIds };
  });

const requiredText = (value: unknown, field: string) => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} không được để trống`);
  return text;
};

const optionalInteger = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} không hợp lệ`);
  return parsed;
};

const requiredDate = (value: unknown, field: string) => {
  const text = requiredText(value, field);
  const date = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) throw new Error(`${field} không hợp lệ`);
  return date.toISOString();
};

export const validateCalendarImportRows = (rows: Record<string, unknown>[]) => {
  const errors: CalendarImportError[] = [];
  const calendars: any[] = [];

  if (!rows.length) {
    return {
      calendars,
      errors: [{ row: 1, field: 'file', message: 'File import không có dữ liệu' }],
    };
  }
  if (rows.length > 500) {
    return {
      calendars,
      errors: [{ row: 1, field: 'file', message: 'Mỗi lần chỉ được import tối đa 500 lịch' }],
    };
  }

  rows.forEach((row, index) => {
    const excelRow = index + 2;
    try {
      const learnNumber = optionalInteger(row.learn_number, 'Learn Number');
      if (learnNumber === undefined || learnNumber < 1) {
        throw new Error('Learn Number phải lớn hơn 0');
      }
      const lessonCount = optionalInteger(row.lesson_count, 'Lesson Count');
      const lessonStatus = optionalInteger(row.lesson_status, 'Lesson Status') ?? 0;
      if (![0, 1].includes(lessonStatus)) throw new Error('Lesson Status chỉ nhận 0 hoặc 1');
      const mappings = parseMappings(row.package_lesson_mappings);
      if (!mappings.length) throw new Error('Course/Lesson Mappings không được để trống');

      calendars.push({
        system_type: requiredText(row.system_type || 'topclass', 'System Type'),
        code: requiredText(row.code, 'Code'),
        learn_number: learnNumber,
        ...(lessonCount !== undefined ? { lesson_count: lessonCount } : {}),
        subject: String(row.subject ?? '').trim() || undefined,
        teacher: String(row.teacher ?? '').trim() || undefined,
        lesson_name: String(row.lesson_name ?? '').trim() || undefined,
        start_time: requiredDate(row.start_time, 'Start Time'),
        end_time: requiredDate(row.end_time, 'End Time'),
        channel_name: String(row.channel_name ?? '').trim() || undefined,
        lesson_status: lessonStatus,
        package_lesson_mappings: mappings,
      });
    } catch (error: any) {
      errors.push({
        row: excelRow,
        field: 'row',
        message: error.message || 'Dữ liệu không hợp lệ',
      });
    }
  });

  return { calendars, errors };
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toSheetRows = (rows: any[]) => rows.map((row) => Object.fromEntries(
  CALENDAR_FILE_COLUMNS.map((column) => [column.header, row[column.key] ?? ''])
));

export const buildCalendarFile = (rows: any[], format: CalendarFileFormat) => {
  if (format === 'csv') {
    const lines = [
      CALENDAR_FILE_COLUMNS.map((column) => escapeCsvValue(column.header)).join(','),
      ...rows.map((row) => CALENDAR_FILE_COLUMNS
        .map((column) => escapeCsvValue(row[column.key]))
        .join(',')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
  }

  const worksheet = XLSX.utils.json_to_sheet(toSheetRows(rows), {
    header: CALENDAR_FILE_COLUMNS.map((column) => column.header),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Calendar');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

export const getCalendarFileContentType = (format: CalendarFileFormat) => (
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

export const buildCalendarTemplate = (format: CalendarFileFormat) => buildCalendarFile([{
  system_type: 'topclass',
  code: 'nguvan-6-2027',
  learn_number: 1,
  lesson_count: '',
  subject: 'Ngữ văn',
  teacher: 'Nguyễn Văn A',
  lesson_name: 'Bài 1 - Tôi và các bạn',
  start_time: '2026-08-03T19:00:00+07:00',
  end_time: '2026-08-03T21:00:00+07:00',
  channel_name: 'room-nguvan-6',
  lesson_status: 0,
  package_lesson_mappings: '1771:171233|171234;3355:171310',
}], format);
