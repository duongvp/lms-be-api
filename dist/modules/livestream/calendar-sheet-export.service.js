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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarSheetExportTask = void 0;
const livestreamService = __importStar(require("./livestream.service"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const calendar_export_fields_1 = require("./calendar-export-fields");
const livestream_io_1 = require("./livestream.io");
const google_sheet_write_1 = require("../../integrations/google-sheet-write");
const calendarSheetExportTask = (options = {}) => {
    const sheetUrl = String(options.sheetUrl || process.env.CALENDAR_EXPORT_SHEET_URL || google_sheet_write_1.DEFAULT_CALENDAR_SHEET_URL).trim();
    const topuniSheetUrl = String(options.topuniSheetUrl || process.env.CALENDAR_EXPORT_TOPUNI_SHEET_URL || google_sheet_write_1.DEFAULT_TOPUNI_SHEET_URL).trim();
    (0, google_sheet_write_1.validateSheetExport)(sheetUrl);
    (0, google_sheet_write_1.validateSheetExport)(topuniSheetUrl);
    const targets = [(0, google_sheet_write_1.spreadsheetIdFromUrl)(sheetUrl), (0, google_sheet_write_1.spreadsheetIdFromUrl)(topuniSheetUrl)];
    if (targets[0] === targets[1])
        throw new Error('Topclass và Topuni cần hai sheet đích khác nhau.');
    return { targets, task: async (onProgress) => {
            const rows = await livestreamService.getCalendarRowsForExport(undefined, options.scope);
            if (!rows.length)
                throw new Error('Không có lịch học được phép xuất.');
            const groups = [
                { systemType: 'topclass', sheetUrl, rows: rows.filter((row) => row.system_type === 'topclass') },
                { systemType: 'topuni', sheetUrl: topuniSheetUrl, rows: rows.filter((row) => row.system_type === 'topuni') },
            ];
            if (groups.reduce((count, group) => count + group.rows.length, 0) !== rows.length)
                throw new Error('Có chương trình chưa xác định hệ Topclass/Topuni. Vui lòng kiểm tra trước khi xuất.');
            const destinations = [];
            for (const [index, group] of groups.entries()) {
                try {
                    const visibleRows = options.roleIds ? (0, calendar_export_fields_1.applyCalendarExportVisibility)(group.rows, await field_permission_service_1.default.filterVisibleRecords(options.roleIds, 'calendar', (0, calendar_export_fields_1.calendarExportPermissionProbes)(group.rows))) : group.rows;
                    const result = await (0, google_sheet_write_1.writeCalendarWorkbookToSheet)((0, livestream_io_1.buildOperationalCalendarWorkbook)(visibleRows), group.sheetUrl, (progress, message) => onProgress((index * 100 + progress) / groups.length, `${group.systemType === 'topuni' ? 'Topuni' : 'Topclass'}: ${message}`), (0, livestream_io_1.googleCalendarTabTitles)(visibleRows));
                    destinations.push({ ...result, systemType: group.systemType, rowCount: group.rows.length });
                }
                catch (error) {
                    const completed = destinations.length ? `Đã cập nhật ${destinations.map((item) => item.systemType === 'topuni' ? 'Topuni' : 'Topclass').join(', ')}. ` : '';
                    throw new Error(`${completed}${group.systemType === 'topuni' ? 'Topuni' : 'Topclass'}: ${error instanceof Error ? error.message : 'Không thể xuất dữ liệu.'}`);
                }
            }
            return { sheetUrl: destinations[0].sheetUrl, sheetCount: destinations.reduce((count, result) => count + result.sheetCount, 0), rowCount: rows.length, destinations };
        } };
};
exports.calendarSheetExportTask = calendarSheetExportTask;
