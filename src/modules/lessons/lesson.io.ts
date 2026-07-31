import * as XLSX from 'xlsx';
import { LessonExportFormat } from './lesson.types';

type LessonExportColumn = {
  key: string;
  header: string;
};

const LESSON_BASIC_COLUMNS: LessonExportColumn[] = [
  { key: 'grade', header: 'Khối' },
  { key: 'subject_name', header: 'Môn học' },
  { key: 'learn_number', header: 'Số thứ tự bài' },
  { key: 'lesson_name', header: 'Tên bài học' },
];

const LESSON_CONTENT_COLUMNS: LessonExportColumn[] = [
  { key: 'evg_banner', header: 'Banner' },
  { key: 'evg_stream', header: 'EVG Stream' },
  { key: 'lesson_link', header: 'Link bài học' },
  { key: 'lesson_baitap', header: 'Bài tập' },
  { key: 'lesson_tomtat', header: 'Tóm tắt' },
  { key: 'lesson_phuongphap', header: 'Phương pháp' },
  { key: 'lesson_luuy', header: 'Lưu ý' },
  { key: 'lesson_ketqua', header: 'Kết quả' },
  { key: 'status', header: 'Trạng thái' },
];

// Giữ export này cho các nơi đang dùng danh sách cột cũ. Các cột tài liệu được
// tạo động ở bên dưới vì mỗi bài học có thể có nhiều tài liệu.
export const LESSON_EXPORT_COLUMNS = [
  ...LESSON_BASIC_COLUMNS,
  { key: 'lesson_document', header: 'Tài liệu bài học' },
  ...LESSON_CONTENT_COLUMNS,
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
  'evg banner': 'evg_banner',
  evg_banner: 'evg_banner',
  banner: 'evg_banner',
  'evg stream': 'evg_stream',
  evg_stream: 'evg_stream',
  stream: 'evg_stream',
  'lesson link': 'lesson_link',
  lesson_link: 'lesson_link',
  'link bài học': 'lesson_link',
  'link bai hoc': 'lesson_link',
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

type LessonDocument = {
  title: string;
  type: string;
  link: string;
};

const parseLessonDocuments = (value: unknown): LessonDocument[] => {
  const text = String(value ?? '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
          title: String(item.title ?? '').trim(),
          type: String(item.type ?? 'pdf').trim(),
          link: String(item.link ?? '').trim(),
        }));
    }
  } catch {
    // Dữ liệu cũ chỉ có một đường dẫn/tên file.
  }

  return [{ title: 'Tài liệu bài học', type: 'pdf', link: text }];
};

const documentColumn = (index: number, field: keyof LessonDocument): LessonExportColumn => {
  const labels: Record<keyof LessonDocument, string> = {
    title: 'Tiêu đề',
    type: 'Loại',
    link: 'Đường dẫn',
  };
  return {
    key: `lesson_document_${index}_${field}`,
    header: `Tài liệu ${index} - ${labels[field]}`,
  };
};

const buildDocumentColumns = (count: number) => Array.from(
  { length: Math.max(count, 1) },
  (_, offset) => offset + 1
).flatMap((index) => [
  documentColumn(index, 'title'),
  documentColumn(index, 'type'),
  documentColumn(index, 'link'),
]);

const getExportColumns = (rows: any[], minimumDocumentCount = 1) => {
  const maximumDocumentCount = rows.reduce(
    (maximum, row) => Math.max(maximum, parseLessonDocuments(row.lesson_document).length),
    minimumDocumentCount
  );
  return [
    ...LESSON_BASIC_COLUMNS,
    ...buildDocumentColumns(maximumDocumentCount),
    ...LESSON_CONTENT_COLUMNS,
  ];
};

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

const DOCUMENT_HEADER_PATTERN = /^(?:tài liệu|tai lieu|document)\s*(\d+)\s*[-–—_:./]*\s*(tiêu đề|tieu de|title|loại|loai|type|đường dẫn|duong dan|link|url)$/i;

const normalizeDocumentField = (value: string): keyof LessonDocument => {
  const normalized = normalizeHeader(value);
  if (normalized === 'tiêu đề' || normalized === 'tieu de' || normalized === 'title') return 'title';
  if (normalized === 'loại' || normalized === 'loai' || normalized === 'type') return 'type';
  return 'link';
};

const normalizeImportRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const normalized: Record<string, unknown> = {};
  const documents = new Map<number, Partial<LessonDocument>>();

  Object.entries(row).forEach(([key, value]) => {
    const normalizedHeader = normalizeHeader(key);
    const mappedKey = HEADER_ALIASES[normalizedHeader];
    if (mappedKey) normalized[mappedKey] = value;

    const documentHeader = normalizedHeader.match(DOCUMENT_HEADER_PATTERN);
    if (documentHeader) {
      const index = Number(documentHeader[1]);
      const document = documents.get(index) ?? {};
      document[normalizeDocumentField(documentHeader[2])] = String(value ?? '').trim();
      documents.set(index, document);
    }
  });

  if (documents.size) {
    const documentList = [...documents.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, document]) => ({
        title: String(document.title ?? '').trim(),
        type: String(document.type || 'pdf').trim(),
        link: String(document.link ?? '').trim(),
      }))
      .filter((document) => document.title || document.link);
    normalized.lesson_document = documentList.length ? JSON.stringify(documentList) : '';
  }

  return normalized;
});

const toExportRow = (row: any, columns: LessonExportColumn[]) => {
  const documents = parseLessonDocuments(row.lesson_document);
  const values: Record<string, unknown> = { ...row };
  documents.forEach((document, offset) => {
    const index = offset + 1;
    values[`lesson_document_${index}_title`] = document.title;
    values[`lesson_document_${index}_type`] = document.type;
    values[`lesson_document_${index}_link`] = document.link;
  });
  return Object.fromEntries(columns.map((column) => [column.header, values[column.key] ?? '']));
};

export const buildLessonWorkbookBuffer = (rows: any[], minimumDocumentCount = 1) => {
  const columns = getExportColumns(rows, minimumDocumentCount);
  const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => toExportRow(row, columns)), {
    header: columns.map((column) => column.header),
  });
  worksheet['!cols'] = columns.map((column) => ({
    wch: column.key.endsWith('_link') ? 42 : Math.max(14, column.header.length + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lessons');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const escapeCsvValue = (value: unknown) => {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export const buildLessonCsvBuffer = (rows: any[], minimumDocumentCount = 1) => {
  const columns = getExportColumns(rows, minimumDocumentCount);
  const lines = [
    columns.map((column) => escapeCsvValue(column.header)).join(','),
    ...rows.map((row) => {
      const exportRow = toExportRow(row, columns);
      return columns.map((column) => escapeCsvValue(exportRow[column.header])).join(',');
    }),
  ];
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};

export const buildLessonTemplateBuffer = (format: LessonExportFormat) => {
  const example = [{
    grade: 6,
    subject_name: 'Toán',
    learn_number: '',
    lesson_name: 'Bài học mẫu',
    lesson_document: JSON.stringify([
      { title: 'Phiếu học tập', type: 'pdf', link: 'https://example.com/phieu-hoc-tap.pdf' },
      { title: 'Video hướng dẫn', type: 'video', link: 'https://example.com/video' },
    ]),
    evg_banner: '',
    evg_stream: '',
    lesson_link: '',
    lesson_baitap: '',
    lesson_tomtat: '',
    lesson_phuongphap: '',
    lesson_luuy: '',
    lesson_ketqua: '',
    status: 1,
  }];
  return format === 'csv'
    ? buildLessonCsvBuffer(example, 3)
    : buildLessonWorkbookBuffer(example, 3);
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
