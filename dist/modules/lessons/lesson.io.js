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
exports.getLessonExportContentType = exports.buildLessonExportBuffer = exports.parseLessonImportFile = exports.buildLessonTemplateBuffer = exports.buildLessonCsvBuffer = exports.buildLessonWorkbookBuffer = exports.LESSON_EXPORT_COLUMNS = void 0;
const XLSX = __importStar(require("xlsx"));
exports.LESSON_EXPORT_COLUMNS = [
    { key: 'grade', header: 'Grade' },
    { key: 'subject_name', header: 'Subject' },
    { key: 'learn_number', header: 'Learn Number' },
    { key: 'lesson_name', header: 'Lesson Name' },
    { key: 'lesson_document', header: 'Lesson Document' },
    { key: 'evg_banner', header: 'EVG Banner' },
    { key: 'evg_stream', header: 'EVG Stream' },
    { key: 'lesson_link', header: 'Lesson Link' },
    { key: 'lesson_baitap', header: 'Lesson Bài tập' },
    { key: 'lesson_tomtat', header: 'Lesson Tóm tắt' },
    { key: 'lesson_phuongphap', header: 'Lesson Phương pháp' },
    { key: 'lesson_luuy', header: 'Lesson Lưu ý' },
    { key: 'lesson_ketqua', header: 'Lesson Kết quả' },
    { key: 'status', header: 'Status' },
];
const HEADER_ALIASES = {
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
const normalizeHeader = (value) => String(value ?? '').trim().toLocaleLowerCase('vi-VN');
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
const normalizeImportRows = (rows) => rows.map((row) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
        const mappedKey = HEADER_ALIASES[normalizeHeader(key)];
        if (mappedKey)
            normalized[mappedKey] = value;
    });
    return normalized;
});
const toSheetRows = (rows) => rows.map((row) => (Object.fromEntries(exports.LESSON_EXPORT_COLUMNS.map((column) => [column.header, row[column.key] ?? '']))));
const buildLessonWorkbookBuffer = (rows) => {
    const worksheet = XLSX.utils.json_to_sheet(toSheetRows(rows), {
        header: exports.LESSON_EXPORT_COLUMNS.map((column) => column.header),
    });
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
const buildLessonCsvBuffer = (rows) => {
    const lines = [
        exports.LESSON_EXPORT_COLUMNS.map((column) => escapeCsvValue(column.header)).join(','),
        ...rows.map((row) => exports.LESSON_EXPORT_COLUMNS.map((column) => escapeCsvValue(row[column.key])).join(',')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};
exports.buildLessonCsvBuffer = buildLessonCsvBuffer;
const buildLessonTemplateBuffer = (format) => {
    const example = [{
            grade: 6,
            subject_name: 'Toán',
            learn_number: '',
            lesson_name: 'Bài học mẫu',
            lesson_document: '[{"link":"https://example.com/tai-lieu.pdf","title":"Phiếu học tập","type":"pdf"}]',
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
    return format === 'csv' ? (0, exports.buildLessonCsvBuffer)(example) : (0, exports.buildLessonWorkbookBuffer)(example);
};
exports.buildLessonTemplateBuffer = buildLessonTemplateBuffer;
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
