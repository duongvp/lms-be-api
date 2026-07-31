import * as XLSX from 'xlsx';
import * as StyledXLSX from 'xlsx-js-style';
import { validateTeacherProfilePayload } from './teacher-profile.validation';
import {
  TEACHER_TYPES,
  TeacherProfileImportError,
  TeacherProfileImportRow,
} from './teacher-profile.types';

export type TeacherProfileFileFormat = 'csv' | 'xlsx';

const COLUMNS = [
  'Mã nhân sự (*)',
  'Họ và tên',
  'Loại nhân sự (1: Giáo viên, 2: Trợ giảng)',
  'Trạng thái (1: Hoạt động, 0: Ngừng hoạt động)',
] as const;

const normalizeHeader = (value: unknown) => String(value ?? '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/đ/g, 'd')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const HEADER_ALIASES: Record<string, string> = {
  'ma nhan su': 'username',
  'ma nhan su (*)': 'username',
  username: 'username',
  'ten dang nhap': 'username',
  'ho va ten': 'display_name',
  'ten hien thi': 'display_name',
  'display name': 'display_name',
  'loai nhan su': 'teacher_type',
  'loai nhan su (1: giao vien, 2: tro giang)': 'teacher_type',
  'teacher type': 'teacher_type',
  'trang thai': 'status',
  'trang thai (1: hoat dong, 0: ngung hoat dong)': 'status',
  status: 'status',
};

const mapHeader = (value: unknown) => {
  const normalized = normalizeHeader(value);
  if (HEADER_ALIASES[normalized]) return HEADER_ALIASES[normalized];
  if (normalized.startsWith('ma nhan su')) return 'username';
  if (normalized.startsWith('loai nhan su')) return 'teacher_type';
  if (normalized.startsWith('trang thai')) return 'status';
  return undefined;
};

const normalizeRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    const mapped = mapHeader(key);
    if (mapped) normalized[mapped] = value;
  });
  return normalized;
});

export const parseTeacherProfileFile = (buffer: Buffer, filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') {
    throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');
  }
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  return normalizeRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    blankrows: false,
  }));
};

const parseTeacherType = (value: unknown) => {
  const normalized = normalizeHeader(value);
  if (normalized === '1') {
    return TEACHER_TYPES.TEACHER;
  }
  if (normalized === '2') {
    return TEACHER_TYPES.TEACHING_ASSISTANT;
  }
  throw new Error('Loại nhân sự chỉ nhận 1 (Giáo viên) hoặc 2 (Trợ giảng)');
};

const parseStatus = (value: unknown) => {
  const normalized = normalizeHeader(value);
  if (normalized === '1') return 1 as const;
  if (normalized === '0') return 0 as const;
  throw new Error('Trạng thái chỉ nhận 1 (Hoạt động) hoặc 0 (Ngừng hoạt động)');
};

export const validateTeacherProfileImportRows = (
  rows: Record<string, unknown>[]
) => {
  const data: TeacherProfileImportRow[] = [];
  const errors: TeacherProfileImportError[] = [];
  const seen = new Set<string>();

  if (!rows.length) {
    return {
      data,
      errors: [{ row: 1, field: 'file', message: 'File không có dữ liệu' }],
    };
  }
  if (rows.length > 2000) {
    return {
      data,
      errors: [{ row: 1, field: 'file', message: 'Mỗi lần chỉ nhập tối đa 2.000 nhân sự' }],
    };
  }

  rows.forEach((row, index) => {
    const excelRow = index + 2;
    try {
      const payload = validateTeacherProfilePayload({
        username: row.username,
        display_name: row.display_name,
        teacher_type: parseTeacherType(row.teacher_type),
        status: parseStatus(row.status),
      });
      const normalizedUsername = payload.username!.toLowerCase();
      if (seen.has(normalizedUsername)) {
        throw new Error(`Mã nhân sự "${payload.username}" bị trùng trong file`);
      }
      seen.add(normalizedUsername);
      data.push({
        row: excelRow,
        username: payload.username!,
        display_name: payload.display_name ?? null,
        teacher_type: payload.teacher_type!,
        status: payload.status!,
      });
    } catch (error: any) {
      errors.push({
        row: excelRow,
        field: 'row',
        message: error.message || 'Dữ liệu không hợp lệ',
      });
    }
  });
  return { data, errors };
};

const toExportRows = (rows: Array<Record<string, any>>) => rows.map((row) => [
  String(row.username ?? ''),
  row.display_name ?? '',
  Number(row.teacher_type),
  Number(row.status),
]);

const applyWorksheetFormatting = (
  worksheet: XLSX.WorkSheet,
  rowCount: number
) => {
  worksheet['!cols'] = [
    { wch: 34 },
    { wch: 30 },
    { wch: 44 },
    { wch: 48 },
  ];
  worksheet['!rows'] = [{ hpt: 25 }];
  worksheet['!autofilter'] = {
    ref: `A1:D${Math.max(rowCount + 1, 1)}`,
  };

  const border = {
    top: { style: 'thin', color: { rgb: 'B7B7B7' } },
    bottom: { style: 'thin', color: { rgb: 'B7B7B7' } },
    left: { style: 'thin', color: { rgb: 'B7B7B7' } },
    right: { style: 'thin', color: { rgb: 'B7B7B7' } },
  };

  for (let column = 0; column < COLUMNS.length; column += 1) {
    const cell = worksheet[StyledXLSX.utils.encode_cell({ r: 0, c: column })];
    if (!cell) continue;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
      fill: { patternType: 'solid', fgColor: { rgb: '17365D' } },
      alignment: {
        horizontal: 'center',
        vertical: 'center',
        wrapText: true,
      },
      border,
    };
  }

  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = 0; column < COLUMNS.length; column += 1) {
      const cell = worksheet[StyledXLSX.utils.encode_cell({ r: row, c: column })];
      if (!cell) continue;
      cell.s = {
        alignment: {
          horizontal: column >= 2 ? 'center' : 'left',
          vertical: 'center',
        },
        border,
      };
    }
  }
};

export const buildTeacherProfileFile = (
  rows: Array<Record<string, any>>,
  format: TeacherProfileFileFormat
) => {
  const exportRows = toExportRows(rows);
  const worksheet = StyledXLSX.utils.aoa_to_sheet([[...COLUMNS], ...exportRows]);
  applyWorksheetFormatting(worksheet, exportRows.length);
  const workbook = StyledXLSX.utils.book_new();
  StyledXLSX.utils.book_append_sheet(workbook, worksheet, 'Giáo viên & Trợ giảng');
  const output = StyledXLSX.write(workbook, {
    type: 'buffer',
    bookType: format === 'csv' ? 'csv' : 'xlsx',
    cellStyles: format === 'xlsx',
  }) as Buffer;
  return format === 'csv'
    ? Buffer.concat([Buffer.from('\uFEFF'), output])
    : output;
};

export const buildTeacherProfileTemplate = (format: TeacherProfileFileFormat) =>
  buildTeacherProfileFile([
    {
      username: 'gv001',
      display_name: 'Nguyễn Văn A',
      teacher_type: TEACHER_TYPES.TEACHER,
      status: 1,
    },
    {
      username: 'tg001',
      display_name: 'Trần Thị B',
      teacher_type: TEACHER_TYPES.TEACHING_ASSISTANT,
      status: 1,
    },
  ], format);

export const getTeacherProfileFileContentType = (format: TeacherProfileFileFormat) =>
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
