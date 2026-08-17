"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLessonExportContentType = exports.buildLessonExportBuffer = exports.parseLessonImportFile = exports.buildProgramImportTemplateBuffer = exports.buildLessonTemplateBuffer = exports.buildLessonCsvBuffer = exports.buildLessonWorkbookBuffer = exports.LESSON_EXPORT_COLUMNS = void 0;
const XLSX = __importStar(require("xlsx"));
const LESSON_BASIC_COLUMNS = [
    { key: 'learn_number', header: 'Số thứ tự bài' },
    { key: 'lesson_name', header: 'Tên bài học' },
    { key: 'status', header: 'Trạng thái' },
];
const PROGRAM_IMPORT_COLUMNS = [
    { key: 'system_type', header: 'Hệ thống' },
    { key: 'grade', header: 'Khối' },
    { key: 'subject_name', header: 'Môn học' },
    { key: 'subject_code', header: 'Mã chương trình' },
    ...LESSON_BASIC_COLUMNS,
];
exports.LESSON_EXPORT_COLUMNS = LESSON_BASIC_COLUMNS;
const HEADER_ALIASES = {
    grade: 'grade',
    khối: 'grade',
    khoi: 'grade',
    subject: 'subject_name',
    'môn học': 'subject_name',
    'mon hoc': 'subject_name',
    subject_name: 'subject_name',
    'mã môn học': 'subject_code',
    'ma mon hoc': 'subject_code',
    'mã chương trình': 'subject_code',
    'ma chuong trinh': 'subject_code',
    'program code': 'subject_code',
    program_code: 'subject_code',
    'subject code': 'subject_code',
    subject_code: 'subject_code',
    system_type: 'system_type',
    'hệ thống': 'system_type',
    'he thong': 'system_type',
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
const normalizeHeader = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN');
const parseLessonDocuments = (value) => {
    const text = String(value ?? '').trim();
    if (!text)
        return [];
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
    }
    catch {
        // Dữ liệu cũ chỉ có một đường dẫn/tên file.
    }
    return [{ title: 'Tài liệu bài học', type: 'pdf', link: text }];
};
const documentColumn = (index, field) => {
    const labels = {
        title: 'Tiêu đề',
        type: 'Loại',
        link: 'Đường dẫn',
    };
    return {
        key: `lesson_document_${index}_${field}`,
        header: `Tài liệu ${index} - ${labels[field]}`,
    };
};
const buildDocumentColumns = (count) => Array.from({ length: Math.max(count, 1) }, (_, offset) => offset + 1).flatMap((index) => [
    documentColumn(index, 'title'),
    documentColumn(index, 'type'),
    documentColumn(index, 'link'),
]);
const getExportColumns = () => LESSON_BASIC_COLUMNS;
const parseCsvLine = (line) => {
    const values = [];
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
const parseCsvBuffer = (buffer) => {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length)
        return [];
    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
};
const DOCUMENT_HEADER_PATTERN = /^(?:tài liệu|tai lieu|document)\s*(\d+)\s*[-–—_:./]*\s*(tiêu đề|tieu de|title|loại|loai|type|đường dẫn|duong dan|link|url)$/i;
const normalizeDocumentField = (value) => {
    const normalized = normalizeHeader(value);
    if (normalized === 'tiêu đề' || normalized === 'tieu de' || normalized === 'title')
        return 'title';
    if (normalized === 'loại' || normalized === 'loai' || normalized === 'type')
        return 'type';
    return 'link';
};
const normalizeImportRows = (rows) => rows.map((row) => {
    const normalized = {};
    const documents = new Map();
    Object.entries(row).forEach(([key, value]) => {
        const normalizedHeader = normalizeHeader(key);
        const mappedKey = HEADER_ALIASES[normalizedHeader];
        if (mappedKey)
            normalized[mappedKey] = value;
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
const toExportRow = (row, columns) => {
    return Object.fromEntries(columns.map((column) => [column.header, row[column.key] ?? '']));
};
const buildLessonWorkbookBuffer = (rows, minimumDocumentCount = 1, columns = getExportColumns()) => {
    const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => toExportRow(row, columns)), {
        header: columns.map((column) => column.header),
    });
    worksheet['!cols'] = columns.map((column) => ({
        wch: column.key.endsWith('_link') ? 42 : Math.max(14, column.header.length + 2),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Lessons');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
exports.buildLessonWorkbookBuffer = buildLessonWorkbookBuffer;
const escapeCsvValue = (value) => {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text))
        return `"${text.replace(/"/g, '""')}"`;
    return text;
};
const buildLessonCsvBuffer = (rows, minimumDocumentCount = 1, columns = getExportColumns()) => {
    const lines = [
        columns.map((column) => escapeCsvValue(column.header)).join(','),
        ...rows.map((row) => {
            const exportRow = toExportRow(row, columns);
            return columns.map((column) => escapeCsvValue(exportRow[column.header])).join(',');
        }),
    ];
    return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};
exports.buildLessonCsvBuffer = buildLessonCsvBuffer;
const buildLessonTemplateBuffer = (format) => {
    const example = [{
            learn_number: '',
            lesson_name: 'Bài học mẫu',
            status: 1,
        }];
    return format === 'csv'
        ? (0, exports.buildLessonCsvBuffer)(example)
        : (0, exports.buildLessonWorkbookBuffer)(example);
};
exports.buildLessonTemplateBuffer = buildLessonTemplateBuffer;
const buildProgramImportTemplateBuffer = (format) => {
    const example = [{
            system_type: 'topuni', grade: 12, subject_name: 'Toán', subject_code: 'toan-12-2027',
            learn_number: 1, lesson_name: 'Bài học mẫu', status: 1,
        }];
    return format === 'csv'
        ? (0, exports.buildLessonCsvBuffer)(example, 1, PROGRAM_IMPORT_COLUMNS)
        : (0, exports.buildLessonWorkbookBuffer)(example, 1, PROGRAM_IMPORT_COLUMNS);
};
exports.buildProgramImportTemplateBuffer = buildProgramImportTemplateBuffer;
const parseLessonImportFile = (buffer, originalName) => {
    const extension = originalName.split('.').pop()?.toLowerCase();
    if (extension === 'csv') {
        return normalizeImportRows(parseCsvBuffer(buffer));
    }
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName)
        return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        blankrows: false,
    });
    if (extension !== 'xlsx') {
        return rows;
    }
    return normalizeImportRows(rows);
};
exports.parseLessonImportFile = parseLessonImportFile;
const buildLessonExportBuffer = (rows, format) => (format === 'csv' ? (0, exports.buildLessonCsvBuffer)(rows) : (0, exports.buildLessonWorkbookBuffer)(rows));
exports.buildLessonExportBuffer = buildLessonExportBuffer;
const getLessonExportContentType = (format) => (format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
exports.getLessonExportContentType = getLessonExportContentType;
