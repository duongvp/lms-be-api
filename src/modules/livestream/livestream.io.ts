import * as XLSX from 'xlsx';
import {
  CalendarImportError,
  CalendarImportErrorCode,
  CalendarImportRow,
} from './calendar-import.types';

export type CalendarFileFormat = 'csv' | 'xlsx';

export const CALENDAR_IMPORT_FILE_COLUMNS = [
  'Môn',
  'Mã buổi học',
  'Tên bài giảng',
  'Tên GV',
  'Ngày live',
  'Thứ',
  'Khung giờ',
  'Tài liệu live\n(TL HS)',
  'Nhiệm vụ học tập',
  'Tài liệu lưu trữ',
  'BTV ND',
  'Trợ giảng',
  'Link sharepoint',
  'ID course\n(TSA,HSA,V-ACT,TN THPT)',
  'ID Bài giảng\n(TSA,HSA,V-ACT,TN THPT)',
  'ID package\n(TSA,HSA,V-ACT,TN THPT)',
  'Email GV',
  'Email TG',
] as const;

const CALENDAR_IMPORT_EXPORT_KEYS = [
  'subject',
  'code',
  'lesson_name',
  'teacher_name',
  'live_date',
  'weekday',
  'time_range',
  'lesson_document',
  'lesson_baitap',
  'archive_document',
  'content_homework',
  'assistant_name',
  'sharepoint_link',
  'course_ids',
  'lesson_ids',
  'package_ids',
  'teacher_email',
  'assistant_email',
] as const;

// Export dùng chính cấu trúc của file import để người dùng có thể sửa file
// vừa xuất rồi import lại mà không phải đổi tên hoặc sắp xếp cột.
export const CALENDAR_FILE_COLUMNS = CALENDAR_IMPORT_FILE_COLUMNS.map(
  (header, index) => ({
    key: CALENDAR_IMPORT_EXPORT_KEYS[index],
    header,
  })
);

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
};

const mapImportHeader = (value: unknown) => {
  const header = normalizeHeader(value);
  if (HEADER_ALIASES[header]) return HEADER_ALIASES[header];
  if (header.startsWith('ma buoi hoc')) return 'code';
  if (header.startsWith('tai lieu live')) return 'lesson_document';
  if (header.startsWith('id course')) return 'course_ids';
  if (header.startsWith('id bai giang')) return 'lesson_ids';
  if (header.startsWith('id package')) return 'package_ids';
  return undefined;
};

const REQUIRED_HEADER_KEYS = new Set([
  'code',
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
        hasCode: keys.has('code'),
        keys,
      };
    })
    .filter((candidate) => (
      candidate.hasCode
      && (candidate.requiredCount >= 3
        || (candidate.keys.has('start_time') && candidate.keys.has('end_time')))
    ))
    .sort((left, right) => (
      right.requiredCount - left.requiredCount
      || right.score - left.score
      || left.index - right.index
    ));

  const header = candidates[0];
  if (!header) {
    throw new Error(
      'Không tìm thấy hàng tiêu đề hợp lệ. File cần có code + start_time + end_time, '
      + 'hoặc format vận hành gồm Mã buổi học, Ngày live, Khung giờ và HMO ID.'
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
      !isRestRow(row)
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
  'session key': 'key',
  sessionid: 'key',
  'session id': 'key',
  'ma lop': 'code',
  'ma khoa hoc': 'code',
  'ma buoi hoc': 'code',
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

const requiredText = (value: unknown, field: string) => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} không được để trống`);
  return text;
};

const limitedText = (
  value: unknown,
  field: string,
  maxLength: number,
  required = false
) => {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${field} không được để trống`);
  if (text.length > maxLength) {
    throw new Error(`${field} không được vượt quá ${maxLength} ký tự`);
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
  if (!parts) throw new Error('Ngày live phải có định dạng DD/MM/YYYY');

  const test = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    test.getUTCFullYear() !== parts.year
    || test.getUTCMonth() !== parts.month - 1
    || test.getUTCDate() !== parts.day
  ) {
    throw new Error('Ngày live không hợp lệ');
  }
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const parseTimeRange = (value: unknown) => {
  const text = requiredText(value, 'Khung giờ');
  const parts = text.split(/\s*[-–—]\s*/);
  if (parts.length !== 2) {
    throw new Error('Khung giờ phải có định dạng HH:mm-HH:mm');
  }
  const normalizeTime = (time: string) => {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new Error('Khung giờ phải có định dạng HH:mm-HH:mm');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new Error('Khung giờ không hợp lệ');
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
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} không hợp lệ`);
  return parsed;
};

export const validateCalendarImportRows = (rows: Record<string, unknown>[]) => {
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
      const code = requiredText(row.code, 'Mã buổi học');
      if (code.length > 30) throw new Error('Mã buổi học không được vượt quá 30 ký tự');
      const directFormat = Boolean(String(row.start_time ?? '').trim() || String(row.end_time ?? '').trim());
      const suppliedLearnNumber = optionalNonNegativeInteger(row.learn_number, 'Số thứ tự bài');
      if (suppliedLearnNumber !== undefined && suppliedLearnNumber < 1) throw new Error('Số thứ tự bài phải lớn hơn 0');
      const learnNumber = suppliedLearnNumber ?? (learnNumbersByCode.get(code) ?? 0) + 1;
      learnNumbersByCode.set(code, learnNumber);
      let startTime: string;
      let endTime: string;
      if (directFormat) {
        startTime = parseDirectDateTime(row.start_time, 'start_time');
        endTime = parseDirectDateTime(row.end_time, 'end_time');
      } else {
        const date = parseLiveDate(row.live_date);
        const time = parseTimeRange(row.time_range);
        startTime = `${date}T${time.start}:00.000Z`;
        endTime = `${date}T${time.end}:00.000Z`;
      }
      if (new Date(startTime) >= new Date(endTime)) {
        throw new Error('Giờ kết thúc phải sau giờ bắt đầu');
      }

      // Format tạo lịch trực tiếp chỉ xác định bài học nội bộ bằng code và
      // learn_number. Package/Course đã quản lý tại bài học; Lesson ID HMO
      // được gán ở nghiệp vụ đồng bộ sau khi lịch đã được tạo.
      const courseIds = directFormat ? [] : parseIds(
        row.course_ids,
        'Course ID',
        'INVALID_COURSE_ID'
      );
      const lessonIds = directFormat ? [] : parseIds(
        row.lesson_ids,
        'Lesson ID',
        'INVALID_LESSON_ID'
      );
      const packageIds = directFormat ? [] : parsePackageIds(row.package_ids);
      const teacher = directFormat
        ? limitedText(row.teacher, 'Giáo viên', 150)
        : normalizeOptionalTeacher(row.teacher_email);
      const assistantTeacher = normalizeAssignment(row.assistant_email);
      const subject = limitedText(row.subject, 'Môn', 100, true);
      const lessonName = limitedText(row.lesson_name, 'Tên bài giảng', 400, true);
      const lessonExercise = limitedText(row.lesson_baitap, 'Nhiệm vụ học tập', 500);
      const systemType = String(row.system_type || (directFormat ? '' : 'topclass')).trim().toLowerCase();
      if (systemType !== 'topclass' && systemType !== 'topuni') throw new Error('system_type chỉ nhận topclass hoặc topuni');

      importRows.push({
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
          lesson_count: optionalNonNegativeInteger(row.lesson_count, 'lesson_count'),
          lesson_baitap: lessonExercise,
          start_time: startTime,
          end_time: endTime,
          lesson_status: 0,
        },
      });
    } catch (error: any) {
      const invalidId = error.invalidId;
      errors.push({
        row: excelRow,
        field: error.field || 'row',
        errorCode: error.errorCode || 'INVALID_ROW',
        message: error.message || 'Dữ liệu không hợp lệ',
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
  worksheet['!cols'] = CALENDAR_FILE_COLUMNS.map((column) => ({
    wch: [
      'lesson_name',
      'lesson_document',
      'lesson_baitap',
      'archive_document',
      'content_homework',
      'sharepoint_link',
    ].includes(column.key) ? 32 : 18,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Calendar');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

export const getCalendarFileContentType = (format: CalendarFileFormat) => (
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

export const buildCalendarTemplate = (format: CalendarFileFormat) => {
  const headers = [
    'code', 'subject', 'start_time', 'end_time', 'learn_number', 'teacher',
    'lesson_name', 'lesson_document', 'evg_banner', 'evg_stream',
    'lesson_count', 'system_type', 'key',
  ];
  const sample = [
    'tongon2dinhluonghsav2027', 'Định lượng', '2026-08-17 21:00:00',
    '2026-08-17 22:00:00', 1, 'Phạm Thái Sơn',
    'Nhập môn HSA - phần Tư duy định lượng',
    '[{"link":"https://example.com/tai-lieu.pdf","title":"Tài liệu","type":"pdf"}]',
    '', '', '', 'topuni', 'tu_2627_tongon2dinhluonghsav2027_1',
  ];

  if (format === 'csv') {
    return Buffer.from(
      `\uFEFF${[
        headers.map(escapeCsvValue).join(','),
        sample.map(escapeCsvValue).join(','),
      ].join('\n')}`,
      'utf8'
    );
  }

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    sample,
  ]);
  worksheet['!cols'] = [
    { wch: 32 },
    { wch: 20 },
    { wch: 22 },
    { wch: 22 },
    { wch: 14 },
    { wch: 24 },
    { wch: 38 },
    { wch: 38 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 38 },
  ];
  worksheet['!autofilter'] = {
    ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}2`,
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Calendar');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
