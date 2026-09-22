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
exports.buildBannerExport = exports.buildBannerTemplate = exports.parseBannerFile = void 0;
const XLSX = __importStar(require("xlsx"));
const normalizedHeader = (value) => String(value || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const aliases = {
    code: 'program_code', 'ma chuong trinh': 'program_code', 'chuong trinh': 'program_code', 'program code': 'program_code',
    teacher: 'teacher', 'giao vien': 'teacher', 'ten giao vien': 'teacher', 'ma giao vien': 'teacher',
    banner: 'banner_url', 'banner url': 'banner_url', 'url banner': 'banner_url',
};
const parseBannerFile = (buffer, filename) => {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx'].includes(extension || ''))
        throw new Error('Chỉ hỗ trợ file .csv hoặc .xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet)
        return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', blankrows: false })
        .map((row, index) => {
        const mapped = {};
        Object.entries(row).forEach(([header, value]) => {
            const key = aliases[normalizedHeader(header)];
            if (key)
                mapped[key] = value;
        });
        return { row: index + 2, program_code: String(mapped.program_code || '').trim(), teacher: String(mapped.teacher || '').trim(), banner_url: String(mapped.banner_url || '').trim() };
    });
};
exports.parseBannerFile = parseBannerFile;
const buildBannerTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
        ['code', 'teacher', 'banner_url'],
        ['toan-10-2027', 'Nguyễn Văn A', 'https://example.com/banner.png'],
    ]);
    sheet['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 70 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Banner');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
exports.buildBannerTemplate = buildBannerTemplate;
const buildBannerExport = (rows) => {
    const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
        code: row.program_code,
        teacher: row.username,
        teacher_name: row.display_name || '',
        banner_url: row.banner_url,
        status: row.status ? 'Hoạt động' : 'Tắt',
    })), { header: ['code', 'teacher', 'teacher_name', 'banner_url', 'status'] });
    sheet['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 30 }, { wch: 70 }, { wch: 14 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Banner');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
exports.buildBannerExport = buildBannerExport;
