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
exports.getTeacherProfileFileContentType = exports.buildTeacherProfileTemplate = exports.buildTeacherProfileFile = exports.validateTeacherProfileImportRows = exports.parseTeacherProfileFile = void 0;
const XLSX = __importStar(require("xlsx"));
const StyledXLSX = __importStar(require("xlsx-js-style"));
const teacher_profile_validation_1 = require("./teacher-profile.validation");
const teacher_profile_types_1 = require("./teacher-profile.types");
const COLUMNS = [
    'Mã nhân sự (*)',
    'Họ và tên',
    'Quyền xem Stream Key (1: Giáo viên, 0: Trợ giảng)',
    'Trạng thái (1: Hoạt động, 0: Ngừng hoạt động)',
];
const normalizeHeader = (value) => String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
const HEADER_ALIASES = {
    'ma nhan su': 'username',
    'ma nhan su (*)': 'username',
    username: 'username',
    'ten dang nhap': 'username',
    'ho va ten': 'display_name',
    'ten hien thi': 'display_name',
    'display name': 'display_name',
    'quyen xem stream key': 'can_view_stream_key',
    'quyen xem stream key (1: giao vien, 0: tro giang)': 'can_view_stream_key',
    'can view stream key': 'can_view_stream_key',
    'trang thai': 'status',
    'trang thai (1: hoat dong, 0: ngung hoat dong)': 'status',
    status: 'status',
};
const mapHeader = (value) => {
    const normalized = normalizeHeader(value);
    if (HEADER_ALIASES[normalized])
        return HEADER_ALIASES[normalized];
    if (normalized.startsWith('ma nhan su'))
        return 'username';
    if (normalized.startsWith('quyen xem stream key'))
        return 'can_view_stream_key';
    if (normalized.startsWith('trang thai'))
        return 'status';
    return undefined;
};
const normalizeRows = (rows) => rows.map((row) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
        const mapped = mapHeader(key);
        if (mapped)
            normalized[mapped] = value;
    });
    return normalized;
});
const parseTeacherProfileFile = (buffer, filename) => {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension !== 'xlsx' && extension !== 'csv') {
        throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv');
    }
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet)
        return [];
    return normalizeRows(XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        blankrows: false,
    }));
};
exports.parseTeacherProfileFile = parseTeacherProfileFile;
const parseCanViewStreamKey = (value) => {
    const normalized = normalizeHeader(value);
    if (normalized === '1') {
        return teacher_profile_types_1.STREAM_KEY_ACCESS.TEACHER;
    }
    if (normalized === '0') {
        return teacher_profile_types_1.STREAM_KEY_ACCESS.TEACHING_ASSISTANT;
    }
    throw new Error('Quyền xem Stream Key chỉ nhận 1 (Giáo viên) hoặc 0 (Trợ giảng)');
};
const parseStatus = (value) => {
    const normalized = normalizeHeader(value);
    if (normalized === '1')
        return 1;
    if (normalized === '0')
        return 0;
    throw new Error('Trạng thái chỉ nhận 1 (Hoạt động) hoặc 0 (Ngừng hoạt động)');
};
const validateTeacherProfileImportRows = (rows) => {
    const data = [];
    const errors = [];
    const seen = new Set();
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
            const payload = (0, teacher_profile_validation_1.validateTeacherProfilePayload)({
                username: row.username,
                display_name: row.display_name,
                can_view_stream_key: parseCanViewStreamKey(row.can_view_stream_key),
                status: parseStatus(row.status),
            });
            const normalizedUsername = payload.username.toLowerCase();
            if (seen.has(normalizedUsername)) {
                throw new Error(`Mã nhân sự "${payload.username}" bị trùng trong file`);
            }
            seen.add(normalizedUsername);
            data.push({
                row: excelRow,
                username: payload.username,
                display_name: payload.display_name ?? null,
                can_view_stream_key: payload.can_view_stream_key,
                status: payload.status,
            });
        }
        catch (error) {
            errors.push({
                row: excelRow,
                field: 'row',
                message: error.message || 'Dữ liệu không hợp lệ',
            });
        }
    });
    return { data, errors };
};
exports.validateTeacherProfileImportRows = validateTeacherProfileImportRows;
const toExportRows = (rows) => rows.map((row) => [
    String(row.username ?? ''),
    row.display_name ?? '',
    Number(row.can_view_stream_key),
    Number(row.status),
]);
const applyWorksheetFormatting = (worksheet, rowCount) => {
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
        if (!cell)
            continue;
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
            if (!cell)
                continue;
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
const buildTeacherProfileFile = (rows, format) => {
    const exportRows = toExportRows(rows);
    const worksheet = StyledXLSX.utils.aoa_to_sheet([[...COLUMNS], ...exportRows]);
    applyWorksheetFormatting(worksheet, exportRows.length);
    const workbook = StyledXLSX.utils.book_new();
    StyledXLSX.utils.book_append_sheet(workbook, worksheet, 'Giáo viên & Trợ giảng');
    const output = StyledXLSX.write(workbook, {
        type: 'buffer',
        bookType: format === 'csv' ? 'csv' : 'xlsx',
        cellStyles: format === 'xlsx',
    });
    return format === 'csv'
        ? Buffer.concat([Buffer.from('\uFEFF'), output])
        : output;
};
exports.buildTeacherProfileFile = buildTeacherProfileFile;
const buildTeacherProfileTemplate = (format) => (0, exports.buildTeacherProfileFile)([
    {
        username: 'gv001',
        display_name: 'Nguyễn Văn A',
        can_view_stream_key: teacher_profile_types_1.STREAM_KEY_ACCESS.TEACHER,
        status: 1,
    },
    {
        username: 'tg001',
        display_name: 'Trần Thị B',
        can_view_stream_key: teacher_profile_types_1.STREAM_KEY_ACCESS.TEACHING_ASSISTANT,
        status: 1,
    },
], format);
exports.buildTeacherProfileTemplate = buildTeacherProfileTemplate;
const getTeacherProfileFileContentType = (format) => format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
exports.getTeacherProfileFileContentType = getTeacherProfileFileContentType;
