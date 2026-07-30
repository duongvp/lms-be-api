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
exports.importFile = exports.importTemplate = exports.exportFile = exports.getCalendar = exports.deleteSession = exports.cancelSession = exports.rescheduleSession = exports.updateSchedule = exports.updateBulk = exports.createBulk = exports.createSingle = void 0;
const livestreamService = __importStar(require("./livestream.service"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const livestream_io_1 = require("./livestream.io");
const getChangeActor = (req) => ({
    userId: Number(req.user?.userId),
    username: String(req.user?.username || ''),
});
const createSingle = async (req, res, next) => {
    try {
        console.log(req.body);
        const result = await livestreamService.createSingle(req.body);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createSingle = createSingle;
const createBulk = async (req, res, next) => {
    try {
        const result = await livestreamService.createBulk(req.body);
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createBulk = createBulk;
// Hàm mới: Cập nhật nhiều lịch học cùng lúc (Bulk Update)
const updateBulk = async (req, res, next) => {
    try {
        const result = await livestreamService.updateBulk(req.body);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateBulk = updateBulk;
const updateSchedule = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { update_mode, ...data } = req.body;
        const result = await livestreamService.updateSchedule(Number(id), data, update_mode, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateSchedule = updateSchedule;
const rescheduleSession = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await livestreamService.rescheduleSession(Number(id), req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.rescheduleSession = rescheduleSession;
const cancelSession = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await livestreamService.cancelSession(Number(id), req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.cancelSession = cancelSession;
const deleteSession = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await livestreamService.deleteSession(Number(id));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.deleteSession = deleteSession;
const getCalendar = async (req, res, next) => {
    try {
        const result = await livestreamService.getCalendar(req.query);
        const data = await field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'calendar', result.data);
        const now = new Date();
        const dataWithSystemMetadata = data.map((record, index) => {
            const source = result.data[index];
            return {
                ...record,
                // id/can_modify là metadata phục vụ thao tác, không phải cột dữ liệu.
                id: source.id,
                can_modify: livestreamService.isSessionModifiable(source, now),
            };
        });
        res.status(200).json({
            success: true,
            data: { ...result, data: dataWithSystemMetadata },
        });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.getCalendar = getCalendar;
const exportFile = async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
        const rows = await livestreamService.getCalendarRowsForExport(req.query.ids);
        const buffer = (0, livestream_io_1.buildCalendarFile)(rows, format);
        res.setHeader('Content-Type', (0, livestream_io_1.getCalendarFileContentType)(format));
        res.setHeader('Content-Disposition', `attachment; filename="calendar-export-${Date.now()}.${format}"`);
        res.send(buffer);
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.exportFile = exportFile;
const importTemplate = async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    res.setHeader('Content-Type', (0, livestream_io_1.getCalendarFileContentType)(format));
    res.setHeader('Content-Disposition', `attachment; filename="calendar-import-template.${format}"`);
    res.send((0, livestream_io_1.buildCalendarTemplate)(format));
};
exports.importTemplate = importTemplate;
const importFile = async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn file import' });
            return;
        }
        const rows = (0, livestream_io_1.parseCalendarImportFile)(req.file.buffer, req.file.originalname);
        const { calendars, errors } = (0, livestream_io_1.validateCalendarImportRows)(rows);
        if (errors.length) {
            res.status(400).json({
                success: false,
                message: 'File import có dữ liệu không hợp lệ',
                errors,
            });
            return;
        }
        const result = await livestreamService.createBulk({ calendars });
        res.status(201).json({
            success: true,
            message: 'Import lịch học thành công',
            data: result,
        });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.importFile = importFile;
