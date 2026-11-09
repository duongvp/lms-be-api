import { calendarSessionEnded } from './calendar-file-time';
import * as XLSX from 'xlsx';
const StyledXLSX: typeof XLSX = require('xlsx-js-style');
import {
  CalendarImportError,
  CalendarImportErrorCode,
  CalendarImportRow,
} from './calendar-import.types';

export type CalendarFileFormat = 'csv' | 'xlsx';

// One schema for exports, import templates and update files.
export const CALENDAR_FILE_COLUMNS = [
  { key: 'subject', header: 'Môn' },
  { key: 'code', header: 'Mã chương trình' },
  { key: 'learn_number', header: 'Bài' },
  { key: 'lesson_count', header: 'Lần học' },
  { key: 'lesson_name', header: 'Tên bài giảng' },
  { key: 'live_date', header: 'Ngày live' },
  { key: 'weekday', header: 'Thứ' },
  { key: 'time_range', header: 'Khung giờ' },
  { key: 'teacher_name', header: 'Tên GV' },
  { key: 'assistant_name', header: 'Trợ giảng' },
  { key: 'lesson_document', header: 'Tài liệu live\n(TL HS)' },
  { key: 'lesson_baitap', header: 'Nhiệm vụ học tập' },
  { key: 'archive_document', header: 'Tài liệu lưu trữ' },
  { key: 'course_ids', header: 'ID khóa học' },
  { key: 'lesson_ids', header: 'ID bài giảng' },
  { key: 'package_ids', header: 'ID gói học' },
  { key: 'key', header: 'Mã định danh lịch' },
  { key: 'system_type', header: 'Hệ thống' },
  { key: 'lesson_name_prefix', header: 'Tiền tố tên bài' },
  { key: 'lesson_name_suffix', header: 'Hậu tố tên bài' },
  { key: 'lesson_status', header: 'Trạng thái buổi học\n(0 = nghỉ, 1 = học)' },
] as const;
export const CALENDAR_IMPORT_FILE_COLUMNS = CALENDAR_FILE_COLUMNS.map(column => column.header);
export const CALENDAR_UPDATE_FILE_COLUMNS = CALENDAR_FILE_COLUMNS;

const normalizeHeader = (value: unknown) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/đ/g, 'd')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const HEADER_ALIASES: Record<string, string> = {
  code: 'code',
  subject: 'subject',
  mon: 'subject',
  'mon hoc': 'subject',
  'ma buoi hoc': 'code',
  'ma chuong trinh': 'code',
  bai: 'learn_number',
  'ten bai giang': 'lesson_name',
  'ten gv': 'teacher_name',
  'ngay live': 'live_date',
  'khung gio': 'time_range',
  'tai lieu live (tl hs)': 'lesson_document',
  'nhiem vu hoc tap': 'lesson_baitap',
  'tro giang': 'assistant_name',
  'email gv': 'teacher_email',
  'email tg': 'assistant_email',
  'start time': 'start_time',
  'end time': 'end_time',
  'learn number': 'learn_number',
  teacher: 'teacher',
  'assistant teacher': 'assistant_name',
  'assistant name': 'assistant_name',
  'lesson name': 'lesson_name',
  'lesson document': 'lesson_document',
  'evg banner': 'evg_banner',
  'evg stream': 'evg_stream',
  'lesson count': 'lesson_count',
  'system type': 'system_type',
  'package id': 'package_ids',
  'package ids': 'package_ids',
  packageid: 'package_ids',
  'course id': 'course_ids',
  'course ids': 'course_ids',
  courseid: 'course_ids',
  'lesson id': 'lesson_ids',
  'lesson ids': 'lesson_ids',
  lessonid: 'lesson_ids',
  key: 'key',
  'c key': 'key',
  'ma dinh danh lich': 'key',
  'he thong': 'system_type',
  'so thu tu bai': 'learn_number',
  'lan hoc': 'lesson_count',
  'trang thai buoi hoc': 'lesson_status',
  'lesson status': 'lesson_status',
  'tien to ten bai': 'lesson_name_prefix',
  'hau to ten bai': 'lesson_name_suffix',
  'id khoa hoc': 'course_ids',
  'id goi hoc': 'package_ids',
};

const mapImportHeader = (value: unknown) => {
  const header = normalizeHeader(value);
  if (header.startsWith('trang thai buoi hoc')) return 'lesson_status';
  if (HEADER_ALIASES[header]) return HEADER_ALIASES[header];
  if (header.startsWith('ma chuong trinh')) return 'code';
  if (header.startsWith('ma buoi hoc')) return 'code';
  if (header.startsWith('tai lieu live')) return 'lesson_document';
  if (header.startsWith('id course')) return 'course_ids';
  if (header.startsWith('id bai giang')) return 'lesson_ids';
  if (header.startsWith('id package')) return 'package_ids';
  return undefined;
};

const REQUIRED_HEADER_KEYS = new Set([
  'live_date',
  'time_range',
  'course_ids',
  'lesson_ids',
]);

const DATA_MARKER_KEYS = new Set([
  'code',
  'live_date',
  'time_range',
  'course_ids',
  'lesson_ids',
  'package_ids',
  'start_time',
  'end_time',
  'learn_number',
  'lesson_name',
  'key',
]);

const isRestRow = (row: Record<string, unknown>) => (
  [row.code, row.lesson_name].some((value) => (
    normalizeHeader(value).startsWith('nghi')
  ))
);

const normalizeMatrixRows = (matrix: unknown[][]) => {
  const candidates = matrix
    .slice(0, 50)
    .map((row, index) => {
      const mappedHeaders = row.map(mapImportHeader);
      const keys = new Set(mappedHeaders.filter(Boolean));
      const requiredCount = Array.from(REQUIRED_HEADER_KEYS)
        .filter((key) => keys.has(key))
        .length;
      return {
        index,
        mappedHeaders,
        score: keys.size,
        requiredCount,
        keys,
      };
    })
    .filter((candidate) => (
      candidate.requiredCount >= 3
      || (candidate.keys.has('start_time')
        && candidate.keys.has('end_time')
        && candidate.keys.has('learn_number'))
    ))
    .sort((left, right) => (
      right.requiredCount - left.requiredCount
      || right.score - left.score
      || left.index - right.index
    ));

  const header = candidates[0];
  if (!header) {
    throw new Error(
      'Không tìm thấy hàng tiêu đề hợp lệ. File cần có start_time, end_time và learn_number, '
      + 'hoặc format vận hành gồm Ngày live, Khung giờ và HMO ID.'
    );
  }

  return matrix
    .slice(header.index + 1)
    .map((values, offset) => {
      const normalized: Record<string, unknown> = {
        __rowNumber: header.index + offset + 2,
      };
      header.mappedHeaders.forEach((mappedKey, columnIndex) => {
        if (mappedKey) normalized[mappedKey] = values[columnIndex] ?? '';
      });
      return normalized;
    })
    .filter((row) => (
      !(isRestRow(row) && String(row.lesson_status ?? '').trim() === '')
      && Object.entries(row).some(([key, value]) => (
        DATA_MARKER_KEYS.has(key) && String(value ?? '').trim()
      ))
    ));
};

const parseCsvRows = (buffer: Buffer) => {
  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];
    if (character === '"' && quoted && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
};

const getWorksheetImportRange = (sheet: XLSX.WorkSheet) => {
  const originalRange = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const populatedRows = Array.from(new Set(
    Object.entries(sheet)
      .filter(([address, cell]) => (
        !address.startsWith('!')
        && cell?.v !== undefined
        && String(cell.v).trim() !== ''
      ))
      .map(([address]) => XLSX.utils.decode_cell(address).r)
  )).sort((left, right) => left - right);

  let lastRow = originalRange.e.r;
  for (let index = 1; index < populatedRows.length; index += 1) {
    if (populatedRows[index] - populatedRows[index - 1] > 1000) {
      lastRow = populatedRows[index - 1];
      break;
    }
  }

  return XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: originalRange.e.c },
  });
};

export const parseCalendarImportFile = (buffer: Buffer, originalName: string) => {
  const extension = originalName.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');
  }
  if (extension === 'csv') return normalizeMatrixRows(parseCsvRows(buffer));

  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return normalizeMatrixRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
    range: getWorksheetImportRange(sheet),
  }));
};

const MAPPING_HEADER_ALIASES: Record<string, string> = {
  id: 'id',
  'calendar id': 'id',
  'id lich hoc': 'id',
  key: 'key',
  'c key': 'key',
  'ma dinh danh lich': 'key',
  'session key': 'key',
  sessionid: 'key',
  'session id': 'key',
  'ma lop': 'code',
  'ma khoa hoc': 'code',
  'ma buoi hoc': 'code',
  'ma chuong trinh': 'code',
  bai: 'learn_number',
  code: 'code',
  'buoi hoc': 'learn_number',
  'so buoi': 'learn_number',
  'learn number': 'learn_number',
  learn_number: 'learn_number',
};

const mapMappingImportHeader = (value: unknown) => {
  const header = normalizeHeader(value);
  if (MAPPING_HEADER_ALIASES[header]) return MAPPING_HEADER_ALIASES[header];
  if (header.startsWith('id package')) return 'package_ids';
  if (header.startsWith('id course')) return 'course_ids';
  if (header.startsWith('id bai giang')) return 'lesson_ids';
  if (header.startsWith('lesson id')) return 'lesson_ids';
  if (header.startsWith('course id')) return 'course_ids';
  if (header.startsWith('package id')) return 'package_ids';
  return undefined;
};

const parseMappingIds = (value: unknown) => Array.from(new Set(
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
));

export const parseCalendarMappingImportFile = (buffer: Buffer, originalName: string) => {
  const extension = originalName.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');
  }

  const matrix = extension === 'csv'
    ? parseCsvRows(buffer)
    : (() => {
        const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) return [] as unknown[][];
        return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: '',
          blankrows: true,
          raw: false,
          range: getWorksheetImportRange(sheet),
        });
      })();

  const header = matrix
    .slice(0, 50)
    .map((row, index) => ({
      index,
      mappedHeaders: row.map(mapMappingImportHeader),
    }))
    .find((candidate) => {
      const keys = new Set(candidate.mappedHeaders.filter(Boolean));
      return keys.has('course_ids')
        && keys.has('lesson_ids')
        && (keys.has('id') || keys.has('key') || (keys.has('code') && keys.has('learn_number')));
    });

  if (!header) {
    throw new Error('File mapping cần có ID/key hoặc Mã lớp + Buổi học, kèm ID course và ID Bài giảng.');
  }

  return matrix
    .slice(header.index + 1)
    .map((values, offset) => {
      const row: Record<string, unknown> = { row: header.index + offset + 2 };
      header.mappedHeaders.forEach((mappedKey, columnIndex) => {
        if (mappedKey) row[mappedKey] = values[columnIndex] ?? '';
      });
      const courseIds = parseMappingIds(row.course_ids);
      const lessonIds = parseMappingIds(row.lesson_ids);
      const packageIds = parseMappingIds(row.package_ids);
      return {
        row: Number(row.row),
        id: String(row.id ?? '').trim() || undefined,
        key: String(row.key ?? '').trim() || undefined,
        code: String(row.code ?? '').trim() || undefined,
        learn_number: String(row.learn_number ?? '').trim() || undefined,
        package_lesson_mappings: courseIds.map((courseId) => ({
          course_id: courseId,
          lesson_ids: lessonIds,
          package_ids: packageIds,
        })),
      };
    })
    .filter((row) => (
      row.id || row.key || row.code || row.learn_number
      || row.package_lesson_mappings.some((mapping) => (
        mapping.course_id || mapping.lesson_ids.length || mapping.package_ids.length
      ))
    ));
};

const importValueError = (field: string, message: string, suggestion?: string, currentValue?: string, importedValue?: string) =>
  Object.assign(new Error(message), {field, suggestion, currentValue, importedValue});

const requiredText = (value: unknown, field: string) => {
  const text = String(value ?? '').trim();
  if (!text) throw importValueError(field, `${field} không được để trống`, `Điền cột ${field} theo file mẫu rồi import lại.`);
  return text;
};

const limitedText = (
  value: unknown,
  field: string,
  maxLength: number,
  required = false
) => {
  const text = String(value ?? '').trim();
  if (required && !text) throw importValueError(field, `${field} không được để trống`, `Điền cột ${field} theo file mẫu rồi import lại.`);
  if (text.length > maxLength) {
    throw importValueError(field, `${field} không được vượt quá ${maxLength} ký tự`, `Rút gọn cột ${field} còn tối đa ${maxLength} ký tự.`);
  }
  return text || undefined;
};

const parseIds = (
  value: unknown,
  field: string,
  errorCode: CalendarImportErrorCode,
  required = true
) => {
  const rawValue = String(value ?? '').trim();
  const normalizedValue = /^[\d\s,.]+$/.test(rawValue)
    ? rawValue.replace(/\./g, ',')
    : rawValue;
  const values = Array.from(new Set(
    normalizedValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  ));
  if (required && !values.length) {
    const error = new Error(`${field} không được để trống`) as Error & {
      errorCode?: CalendarImportErrorCode;
      field?: string;
    };
    error.errorCode = errorCode;
    error.field = field;
    throw error;
  }
  const invalid = values.find((id) => !/^\d+$/.test(id) || id.length > 50);
  if (invalid) {
    const error = new Error(`${field} "${invalid}" không hợp lệ`) as Error & {
      errorCode?: CalendarImportErrorCode;
      field?: string;
      invalidId?: string;
    };
    error.errorCode = errorCode;
    error.field = field;
    error.invalidId = invalid;
    throw error;
  }
  return values;
};

const parsePackageIds = (value: unknown) => {
  const packageValues = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item && !/^https?:\/\//i.test(item));
  return parseIds(
    packageValues.join(','),
    'ID package',
    'INVALID_PACKAGE_ID',
    false
  );
};

const parseLiveDate = (value: unknown) => {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const text = requiredText(value, 'Ngày live');
  const vietnamese = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const parts = vietnamese
    ? { day: Number(vietnamese[1]), month: Number(vietnamese[2]), year: Number(vietnamese[3]) }
    : iso
      ? { day: Number(iso[3]), month: Number(iso[2]), year: Number(iso[1]) }
      : null;
  if (!parts) throw importValueError('Ngày live', 'Ngày live không đúng định dạng.', 'Nhập ngày dạng DD/MM/YYYY, ví dụ 25/12/2027.');

  const test = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    test.getUTCFullYear() !== parts.year
    || test.getUTCMonth() !== parts.month - 1
    || test.getUTCDate() !== parts.day
  ) {
    throw importValueError('Ngày live', 'Ngày live không tồn tại trên lịch.', 'Kiểm tra lại ngày, tháng, năm; ví dụ tháng 2 không có ngày 30.');
  }
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const parseTimeRange = (value: unknown) => {
  const text = requiredText(value, 'Khung giờ');
  const parts = text.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) {
    throw importValueError('Khung giờ', 'Khung giờ không đúng định dạng.', 'Nhập giờ bắt đầu và kết thúc dạng HH:mm-HH:mm, ví dụ 20:00-21:30.');
  }
  const normalizeTime = (time: string) => {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw importValueError('Khung giờ', 'Khung giờ không đúng định dạng.', 'Nhập giờ bắt đầu và kết thúc dạng HH:mm-HH:mm, ví dụ 20:00-21:30.');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw importValueError('Khung giờ', 'Khung giờ không hợp lệ.', 'Giờ từ 00 đến 23, phút từ 00 đến 59; ví dụ 20:00-21:30.');
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };
  return {
    start: normalizeTime(parts[0]),
    end: normalizeTime(parts[1]),
  };
};

const normalizeAssignment = (value: unknown) => Array.from(new Set(
  String(value ?? '')
    .split(/[;,]/)
    .map((item) => item.trim().replace(/\s+/g, ''))
    .filter(Boolean)
)).join(',');

const normalizeAssistantNames = (value: unknown) => {
  const assistants = Array.from(new Set(
    String(value ?? '')
      .split(/[;,]/)
      .map((item) => item.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
  ));
  const normalized = assistants.join(',');
  if (normalized.length > 500) {
    throw new Error('Trợ giảng không được vượt quá 500 ký tự');
  }
  return normalized;
};

const normalizeOptionalTeacher = (value: unknown) => {
  const text = limitedText(value, 'Email GV', 120);
  if (!text || /\s/.test(text)) return undefined;
  const teacher = normalizeAssignment(text);
  if (teacher.includes(',')) {
    throw new Error('Email GV chỉ được chứa một tài khoản giáo viên');
  }
  return teacher || undefined;
};

const toDocumentJson = (value: unknown) => {
  const document = String(value ?? '').trim();
  if (!document) return undefined;
  try {
    const parsed = JSON.parse(document);
    if (Array.isArray(parsed)) return JSON.stringify(parsed);
  } catch {
    // Giá trị link/text đơn vẫn được hỗ trợ như format vận hành cũ.
  }
  return JSON.stringify([document]);
};

const parseDirectDateTime = (value: unknown, field: string) => {
  const text = requiredText(value, field).replace(' ', 'T');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`${field} phải có định dạng YYYY-MM-DD HH:mm:ss`);
  const normalized = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || '00'}.000Z`;
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error(`${field} không hợp lệ`);
  return normalized;
};

const optionalNonNegativeInteger = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw importValueError(field, `${field} phải là số nguyên không âm.`, 'Nhập số nguyên từ 0 trở lên; riêng Bài phải từ 1 trở lên.');
  return parsed;
};

type CalendarImportProgramContext = {
  code: string;
  subject: string;
  systemType: 'topclass' | 'topuni';
};

export const validateCalendarImportRows = (
  rows: Record<string, unknown>[],
  programContext?: CalendarImportProgramContext
) => {
  const errors: CalendarImportError[] = [];
  const importRows: CalendarImportRow[] = [];
  const learnNumbersByCode = new Map<string, number>();

  if (!rows.length) {
    return {
      importRows,
      errors: [{
        row: 1,
        field: 'file',
        errorCode: 'INVALID_ROW' as const,
        message: 'File import không có dữ liệu',
      }],
    };
  }
  const configuredMaxRows = Number(process.env.CALENDAR_IMPORT_MAX_ROWS);
  const maxRows = Number.isInteger(configuredMaxRows) && configuredMaxRows > 0
    ? configuredMaxRows
    : 300;
  if (rows.length > maxRows) {
    return {
      importRows,
      errors: [{
        row: 1,
        field: 'file',
        errorCode: 'INVALID_ROW' as const,
        message: `Mỗi lần chỉ được import tối đa ${maxRows} lịch`,
      }],
    };
  }

  rows.forEach((row, index) => {
    const sourceRow = Number(row.__rowNumber);
    const excelRow = Number.isInteger(sourceRow) && sourceRow > 0
      ? sourceRow
      : index + 2;
    try {
      if (String(row.key ?? '').trim()) {
        for (const [field, value] of [['Mã chương trình', row.code], ['Môn', row.subject], ['Hệ thống', row.system_type]]) {
          if (!String(value ?? '').trim()) throw importValueError(String(field), `${field} trong dòng cập nhật đang để trống.`, `Khôi phục ${field} theo file export gốc; không xóa cột định danh khi cập nhật lịch.`);
        }
      }
      const suppliedCode = String(row.code ?? '').trim();
      if (programContext && suppliedCode && suppliedCode !== programContext.code) {
        throw importValueError('Mã chương trình', 'Mã chương trình trong file không khớp chương trình đang chọn.', 'Chọn đúng chương trình để import, hoặc dùng lại file export của chương trình này.', programContext.code, suppliedCode);
      }
      const code = programContext?.code || requiredText(row.code, 'Mã chương trình');
      if (code.length > 30) throw new Error('Mã chương trình không được vượt quá 30 ký tự');
      const directDateFormat = Boolean(String(row.start_time ?? '').trim() || String(row.end_time ?? '').trim());
      const directFormat = directDateFormat || Boolean(programContext);
      const suppliedLearnNumber = optionalNonNegativeInteger(row.learn_number, 'Bài');
      if (programContext && suppliedLearnNumber === undefined) throw importValueError('Bài', 'Bài không được để trống.', 'Điền số bài đã có trong chương trình đang chọn.');
      if (suppliedLearnNumber !== undefined && suppliedLearnNumber < 1) throw importValueError('Bài', 'Bài phải lớn hơn 0.', 'Điền số bài đã có trong chương trình, bắt đầu từ 1.');
      const learnNumber = suppliedLearnNumber ?? (learnNumbersByCode.get(code) ?? 0) + 1;
      learnNumbersByCode.set(code, learnNumber);
      let startTime: string;
      let endTime: string;
      if (directDateFormat) {
        startTime = parseDirectDateTime(row.start_time, 'start_time');
        endTime = parseDirectDateTime(row.end_time, 'end_time');
      } else {
        const date = parseLiveDate(row.live_date);
        const time = parseTimeRange(row.time_range);
        startTime = `${date}T${time.start}:00.000Z`;
        endTime = `${date}T${time.end}:00.000Z`;
        if (time.end < time.start) endTime = new Date(new Date(endTime).getTime() + 86400000).toISOString();
      }
      if (new Date(startTime) >= new Date(endTime)) {
        throw importValueError('Khung giờ', 'Giờ kết thúc phải sau giờ bắt đầu.', 'Kiểm tra hai mốc giờ; không nhập giờ bắt đầu và kết thúc giống nhau.');
      }

      // Empty IDs leave mappings unchanged; supplied IDs must still be parsed
      // for internal imports and validated against content and HMO below.
      const courseIds = parseIds(row.course_ids, 'ID khóa học', 'INVALID_COURSE_ID', !directFormat);
      const lessonIds = parseIds(row.lesson_ids, 'ID bài giảng', 'INVALID_LESSON_ID', !directFormat);
      const packageIds = directFormat
        ? parseIds(row.package_ids, 'ID gói học', 'INVALID_PACKAGE_ID', false)
        : parsePackageIds(row.package_ids);
      const teacher = directFormat
        ? limitedText(row.teacher ?? row.teacher_name ?? row.teacher_email, 'Tên GV', 150)
        : normalizeOptionalTeacher(row.teacher_email);
      // Người vận hành quản lý trợ giảng bằng tên hiển thị. Vẫn nhận Email TG
      // của file cũ làm fallback; bước validate async sẽ đổi tên thành username
      // chuẩn từ teacher_profiles trước khi ghi calendar.
      const assistantTeacher = normalizeAssistantNames(
        String(row.assistant_name ?? '').trim()
          ? row.assistant_name
          : row.assistant_email
      );
      const subject = limitedText(row.subject, 'Môn', 100) || programContext?.subject;
      if (!subject) throw new Error('Môn không được để trống');
      const lessonName = limitedText(row.lesson_name, 'Tên bài giảng', 400, !programContext || Boolean(row.key));
      const lessonExercise = limitedText(row.lesson_baitap, 'Nhiệm vụ học tập', 500);
      const suppliedSystemType = String(row.system_type || '').trim().toLowerCase();
      if (programContext && suppliedSystemType && suppliedSystemType !== programContext.systemType) {
        throw importValueError('Hệ thống', 'Hệ thống trong file không khớp chương trình đang chọn.', 'Giữ nguyên Hệ thống theo chương trình và file export gốc.', programContext.systemType, suppliedSystemType);
      }
      const systemType = String(
        programContext?.systemType || suppliedSystemType || (directFormat ? '' : 'topclass')
      ).trim().toLowerCase();
      if (systemType !== 'topclass' && systemType !== 'topuni') throw importValueError('Hệ thống', 'Hệ thống không hợp lệ.', 'Chỉ nhập topclass hoặc topuni, đúng theo chương trình đang chọn.');

      const statusProvided = String(row.lesson_status ?? '').trim() !== '';
      if (statusProvided && !['0', '1'].includes(String(row.lesson_status).trim())) {
        throw importValueError('Trạng thái buổi học', 'Trạng thái buổi học không hợp lệ.', 'Chỉ nhập 0 nếu nghỉ hoặc 1 nếu học.');
      }
      if (String(row.lesson_name_prefix ?? '').length > 100) throw importValueError('Tiền tố tên bài', 'Tiền tố tên bài vượt quá 100 ký tự.', 'Rút gọn tiền tố còn tối đa 100 ký tự.');
      if (String(row.lesson_name_suffix ?? '').length > 100) throw importValueError('Hậu tố tên bài', 'Hậu tố tên bài vượt quá 100 ký tự.', 'Rút gọn hậu tố còn tối đa 100 ký tự.');
      importRows.push({
        statusProvided,
        lessonNamePrefix: String(row.lesson_name_prefix ?? ''),
        lessonNameSuffix: String(row.lesson_name_suffix ?? ''),
        row: excelRow,
        sourceFormat: directFormat ? 'direct' : 'operational',
        sourceKey: limitedText(row.key, 'key', 100),
        packageIds,
        courseIds,
        lessonIds,
        calendar: {
          system_type: systemType,
          code,
          learn_number: learnNumber,
          subject,
          teacher: teacher || undefined,
          assistant_teacher: assistantTeacher || undefined,
          lesson_name: lessonName,
          lesson_document: toDocumentJson(row.lesson_document),
          evg_banner: limitedText(row.evg_banner, 'evg_banner', 500),
          evg_stream: limitedText(row.evg_stream, 'evg_stream', 500),
          lesson_count: optionalNonNegativeInteger(row.lesson_count, 'Lần học'),
          lesson_baitap: lessonExercise,
          start_time: startTime,
          end_time: endTime,
          // File: 0 nghỉ, 1 học. Database legacy: 1 nghỉ, 0 học.
          lesson_status: statusProvided ? 1 - Number(row.lesson_status) : 0,
        },
      });
    } catch (error: any) {
      const invalidId = error.invalidId;
      errors.push({
        row: excelRow,
        field: error.field || 'row',
        errorCode: error.errorCode || 'INVALID_ROW',
        message: error.message || 'Dữ liệu không hợp lệ',
        suggestion: error.suggestion,
        currentValue: error.currentValue,
        importedValue: error.importedValue,
        ...(error.errorCode === 'INVALID_PACKAGE_ID' ? { packageId: invalidId } : {}),
        ...(error.errorCode === 'INVALID_COURSE_ID' ? { courseId: invalidId } : {}),
        ...(error.errorCode === 'INVALID_LESSON_ID' ? { lessonId: invalidId } : {}),
      });
    }
  });

  return { importRows, errors };
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const fileValue = (row: any, key: string) => key === 'lesson_status'
  ? (row.lesson_status == null ? '' : 1 - Number(row.lesson_status))
  : key === 'weekday' ? String(row.weekday ?? '').replace(/^Thứ\s+/i, '').replace(/Chủ Nhật/i, 'CN') : row[key] ?? '';

const toSheetRows = (rows: any[]) => rows.map((row) => Object.fromEntries(
  CALENDAR_FILE_COLUMNS.map((column) => [column.header, fileValue(row, column.key)])
));

export const buildCalendarFile = (rows: any[], format: CalendarFileFormat) => {
  if (format === 'csv') {
    const lines = [
      CALENDAR_FILE_COLUMNS.map((column) => escapeCsvValue(column.header)).join(','),
      ...rows.map((row) => CALENDAR_FILE_COLUMNS
        .map((column) => escapeCsvValue(fileValue(row, column.key)))
        .join(',')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
  }

  const worksheet = XLSX.utils.json_to_sheet(toSheetRows(rows), {
    header: CALENDAR_FILE_COLUMNS.map((column) => column.header),
  });
  worksheet['!cols'] = CALENDAR_FILE_COLUMNS.map((column) => ({
    wch: column.key === 'lesson_status' ? 28 : [
      'lesson_name',
      'lesson_document',
      'lesson_baitap',
      'archive_document',
      'content_homework',
      'sharepoint_link',
    ].includes(column.key) ? 32 : 18,
  }));
  styleCalendarWorksheet(worksheet);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lịch học');
  return StyledXLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const OPERATIONAL_COLUMNS = CALENDAR_FILE_COLUMNS.map(({header, key}) => [header, key] as const);

const styleCalendarWorksheet = (sheet: XLSX.WorkSheet) => {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  sheet['!rows'] = [{ hpt: 36 }];
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  const columnIndex = (key: string) => CALENDAR_FILE_COLUMNS.findIndex(column => column.key === key);
  const now = new Date();
  for (let r = 0; r <= range.e.r; r++) {
    const value = (key: string) => sheet[XLSX.utils.encode_cell({r, c: columnIndex(key)})]?.v;
    const ended = r > 0 && calendarSessionEnded(String(value('live_date') ?? ''), String(value('time_range') ?? ''), now);
    const status = value('lesson_status');
    const isRest = r > 0 && status !== '' && status != null && Number(status) === 0;
    for (let c = 0; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({r, c});
      const cell = sheet[address] || (sheet[address] = {t: 's', v: ''});
      cell.s = {
        font: { name: 'Arial', sz: 10, bold: r === 0, color: {rgb: r === 0 ? 'FFFFFF' : isRest ? 'FF0000' : '000000'} },
        fill: {fgColor: {rgb: r === 0 ? (['lesson_document', 'lesson_baitap'].includes(CALENDAR_FILE_COLUMNS[c]?.key) ? '741B47' : '0C343D') : ended ? 'B7E1CD' : 'FFFFFF'}},
        alignment: {vertical: 'center', wrapText: r === 0},
        border: Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side, {style: 'thin', color: {rgb: '00B050'}}])),
      };
    }
  }
};

const operationalSheetName = (rows: any[], code: string, used: Set<string>) => {
  const grade = code.match(/(?:^|-)(\d{1,2})(?:-|$)/)?.[1];
  const subject = String(rows[0]?.subject || code).trim();
  const base = `${subject}${grade && !subject.includes(grade) ? ` ${grade}` : ''}`
    .replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Chương trình';
  let name = base;
  let index = 2;
  while (used.has(name.toLocaleLowerCase('vi'))) {
    const suffix = ` (${index++})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLocaleLowerCase('vi'));
  return name;
};

export const buildOperationalCalendarWorkbook = (rows: any[]) => {
  const workbook = XLSX.utils.book_new();
  const groups = new Map<string, any[]>();
  rows.forEach((row) => {
    const code = String(row.code || 'Chương trình').trim();
    groups.set(code, [...(groups.get(code) || []), row]);
  });
  const used = new Set<string>();
  Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'vi')).forEach(([code, items]) => {
    const operationalRows = items;
    const matrix = [
      OPERATIONAL_COLUMNS.map(([header]) => header),
      ...operationalRows.map((row) => OPERATIONAL_COLUMNS.map(([, key]) => fileValue(row, key))),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    sheet['!cols'] = OPERATIONAL_COLUMNS.map(([, key]) => ({
      wch: key === 'lesson_status' ? 28 : ['lesson_name', 'lesson_document', 'lesson_baitap', 'archive_document'].includes(key) ? 34 : 18,
    }));
    styleCalendarWorksheet(sheet);
    XLSX.utils.book_append_sheet(workbook, sheet, operationalSheetName(items, code, used));
  });
  if (!workbook.SheetNames.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Lịch học');
  return StyledXLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

export const googleCalendarTabTitles = (rows: any[]) => {
  const groups = new Map<string, any>();
  for (const row of rows) {
    const code = String(row.code || 'Chương trình').trim();
    if (!groups.has(code)) groups.set(code, row);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'vi')).map(([code, row]) => {
    const subject = String(row.subject || code).trim();
    const title = `${subject} - ${code}`;
    return (title.length <= 100 ? title : code).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 100);
  });
};

export const buildCalendarUpdateFile = (rows: any[]) => buildCalendarFile(rows, 'xlsx');

export const getCalendarFileContentType = (format: CalendarFileFormat) => (
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

export const buildCalendarTemplate = (format: CalendarFileFormat) => buildCalendarFile([{
  subject: '', code: '', lesson_name: '',
  live_date: '17/08/2027', weekday: '', time_range: '21:00-22:00',
  teacher_name: 'Phạm Thái Sơn', assistant_name: 'Nguyễn Văn Trợ Giảng',
  learn_number: 1, lesson_count: 0, lesson_status: 0,
}], format);
