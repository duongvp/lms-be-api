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
exports.importMappings = exports.previewMappingImport = exports.updateMappings = exports.previewMappingUpdates = exports.updateImportFile = exports.importFile = exports.importTemplate = exports.exportFile = exports.exportGoogleSheetProgress = exports.exportGoogleSheet = exports.getCalendar = exports.deleteSession = exports.cancelSession = exports.provisionEvgStreamsBulk = exports.provisionEvgStream = exports.swapSessionTimes = exports.rescheduleSession = exports.updateSchedule = exports.applyStudentClassroomAssignment = exports.previewStudentClassroomAssignment = exports.getStudentSyncProgress = exports.syncStudents = exports.resendToHocmai = exports.backfillMissingTeachingUsers = exports.updateBulk = exports.commitAutoSchedule = exports.getProgramLessonsHocmaiSections = exports.getProgramLessonHocmaiSections = exports.getPrograms = exports.getProgramLessons = exports.previewAutoSchedule = exports.createBulk = exports.createSingle = void 0;
const livestreamService = __importStar(require("./livestream.service"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const calendar_sheet_export_service_1 = require("./calendar-sheet-export.service");
const livestream_io_1 = require("./livestream.io");
const google_sheet_csv_1 = require("../../integrations/google-sheet-csv");
const google_sheet_export_job_1 = require("../../integrations/google-sheet-export-job");
const auto_schedule_service_1 = require("./auto-schedule.service");
const calendar_import_service_1 = require("./calendar-import.service");
const authorization_service_1 = require("../../services/authorization.service");
const classroom_assignment_service_1 = require("./classroom-assignment.service");
const calendar_student_sync_service_1 = require("./calendar-student-sync.service");
const getChangeActor = (req) => ({
    userId: Number(req.user?.userId),
    username: String(req.user?.username || ''),
});
const createSingle = async (req, res, next) => {
    try {
        console.log(req.body);
        const result = await livestreamService.createSingle(req.body, getChangeActor(req));
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createSingle = createSingle;
const createBulk = async (req, res, next) => {
    try {
        const result = await livestreamService.createBulk(req.body, getChangeActor(req));
        res.status(201).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.createBulk = createBulk;
const previewAutoSchedule = async (req, res, next) => {
    try {
        res.status(200).json({ success: true, data: (0, auto_schedule_service_1.previewAutoSchedule)(req.body) });
    }
    catch (error) {
        next(error);
    }
};
exports.previewAutoSchedule = previewAutoSchedule;
const getProgramLessons = async (req, res, next) => {
    try {
        const data = await livestreamService.getProgramLessonsForScheduling(String(req.params.code || ''));
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.getProgramLessons = getProgramLessons;
const getPrograms = async (req, res, next) => {
    try {
        res.status(200).json({
            success: true,
            data: await livestreamService.getSchedulingPrograms((0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.view')),
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPrograms = getPrograms;
const getProgramLessonHocmaiSections = async (req, res, next) => {
    try {
        const data = await livestreamService.getHocmaiSectionsForProgramLesson(String(req.params.code || ''), String(req.params.lessonId || ''));
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.getProgramLessonHocmaiSections = getProgramLessonHocmaiSections;
const getProgramLessonsHocmaiSections = async (req, res, next) => {
    try {
        const data = await livestreamService.getHocmaiSectionsForProgramLessons(String(req.params.code || ''), req.body?.lesson_ids);
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.getProgramLessonsHocmaiSections = getProgramLessonsHocmaiSections;
const commitAutoSchedule = async (req, res, next) => {
    try {
        const preview = (0, auto_schedule_service_1.previewAutoSchedule)(req.body);
        const calendars = preview.calendars.map(({ auto_schedule, ...calendar }) => calendar);
        const data = await livestreamService.createBulk({ calendars }, getChangeActor(req));
        res.status(201).json({ success: true, data: { ...preview, calendars: data } });
    }
    catch (error) {
        next(error);
    }
};
exports.commitAutoSchedule = commitAutoSchedule;
// Hàm mới: Cập nhật nhiều lịch học cùng lúc (Bulk Update)
const updateBulk = async (req, res, next) => {
    try {
        const result = ['cancel', 'makeup'].includes(String(req.body?.operation || ''))
            ? await livestreamService.bulkRescheduleSessions(req.body, getChangeActor(req))
            : await livestreamService.updateBulk(req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateBulk = updateBulk;
const backfillMissingTeachingUsers = async (req, res) => {
    try {
        const { ids } = req.body;
        const result = await livestreamService.backfillMissingCalendarTeachingUsers(ids, req.body.additionalUsers);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.backfillMissingTeachingUsers = backfillMissingTeachingUsers;
const resendToHocmai = async (req, res) => {
    try {
        const result = await livestreamService.resendCalendarsToHocmai(req.body?.ids);
        res.status(200).json({
            success: true,
            message: 'Đã đưa lịch học vào hàng đợi gửi HMO',
            data: result,
        });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.resendToHocmai = resendToHocmai;
const syncStudents = async (req, res, next) => {
    try {
        res.status(202).json({
            success: true,
            message: 'Đã bắt đầu đồng bộ học viên',
            data: (0, calendar_student_sync_service_1.startCalendarStudentSync)(req.body?.ids, req.body?.registeredAt, Number(req.user?.userId)),
        });
    }
    catch (error) {
        next(error);
    }
};
exports.syncStudents = syncStudents;
const getStudentSyncProgress = async (req, res, next) => {
    try {
        res.status(200).json({
            success: true,
            data: (0, calendar_student_sync_service_1.getCalendarStudentSyncJob)(String(req.params.jobId || ''), Number(req.user?.userId)),
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getStudentSyncProgress = getStudentSyncProgress;
const previewStudentClassroomAssignment = async (req, res, next) => {
    try {
        const data = await (0, classroom_assignment_service_1.previewClassroomAssignment)(Number(req.params.id), {
            maxStudentsPerClassroom: req.body?.max_students_per_classroom,
        });
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
exports.previewStudentClassroomAssignment = previewStudentClassroomAssignment;
const applyStudentClassroomAssignment = async (req, res, next) => {
    try {
        const data = await (0, classroom_assignment_service_1.applyClassroomAssignment)(Number(req.params.id), {
            username: req.user?.username,
        }, {
            maxStudentsPerClassroom: req.body?.max_students_per_classroom,
        });
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};
exports.applyStudentClassroomAssignment = applyStudentClassroomAssignment;
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
const swapSessionTimes = async (req, res, next) => {
    try {
        const result = await livestreamService.swapSessionTimes(req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.swapSessionTimes = swapSessionTimes;
const provisionEvgStream = async (req, res, next) => {
    try {
        const result = await livestreamService.provisionCalendarEvgStream(Number(req.params.id), String(req.user?.username || ''), req.body?.mode || (req.body?.force === true ? 'overwrite' : 'skip_existing'));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.provisionEvgStream = provisionEvgStream;
const provisionEvgStreamsBulk = async (req, res, next) => {
    try {
        const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number);
        const result = await livestreamService.provisionCalendarsEvgBulk(ids, String(req.user?.username || ''), req.body?.mode || 'skip_existing');
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.provisionEvgStreamsBulk = provisionEvgStreamsBulk;
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
        const result = await livestreamService.deleteSession(Number(id), getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.deleteSession = deleteSession;
const getCalendar = async (req, res, next) => {
    try {
        const result = await livestreamService.getCalendar(req.query, (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.view'), Boolean(req.user?.permissions?.includes('*') || req.user?.roles?.includes('admin')));
        const data = await field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'calendar', result.data);
        const now = new Date();
        const dataWithSystemMetadata = data.map((record, index) => {
            const source = result.data[index];
            return {
                ...record,
                // id/can_modify là metadata phục vụ thao tác, không phải cột dữ liệu.
                id: source.id,
                session_id: source.session_id == null ? null : String(source.session_id),
                can_modify: livestreamService.isSessionModifiable(source, now),
                classroom_assigned: source.classroom_assigned === true,
                classroom_assigned_at: source.classroom_assigned_at || null,
                package_lesson_mappings: source.package_lesson_mappings || [],
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
const exportGoogleSheet = async (req, res) => {
    try {
        const { targets, task } = (0, calendar_sheet_export_service_1.calendarSheetExportTask)({ sheetUrl: req.body.sheetUrl, topuniSheetUrl: req.body.topuniSheetUrl, scope: (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.export'), roleIds: req.user?.roleIds || [] });
        const job = (0, google_sheet_export_job_1.startSheetExportJob)(Number(req.user?.userId), targets, task);
        res.status(202).json({ success: true, data: job });
    }
    catch (err) {
        res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
};
exports.exportGoogleSheet = exportGoogleSheet;
const exportGoogleSheetProgress = async (req, res) => {
    try {
        res.json({ success: true, data: (0, google_sheet_export_job_1.getSheetExportJob)(String(req.params.jobId), Number(req.user?.userId)) });
    }
    catch (err) {
        res.status(err.statusCode || 400).json({ success: false, message: err.message });
    }
};
exports.exportGoogleSheetProgress = exportGoogleSheetProgress;
const exportFile = async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
        const updateTemplate = req.query.purpose === 'update';
        const operationalWorkbook = req.query.purpose === 'all-programs';
        const rows = await livestreamService.getCalendarRowsForExport(req.query.ids, (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.export'), String(req.query.program_code || '').trim() || undefined);
        const buffer = operationalWorkbook
            ? (0, livestream_io_1.buildOperationalCalendarWorkbook)(rows)
            : updateTemplate
                ? (0, livestream_io_1.buildCalendarUpdateFile)(rows)
                : (0, livestream_io_1.buildCalendarFile)(rows, format);
        const responseFormat = updateTemplate || operationalWorkbook ? 'xlsx' : format;
        res.setHeader('Content-Type', (0, livestream_io_1.getCalendarFileContentType)(responseFormat));
        res.setHeader('Content-Disposition', `attachment; filename="calendar-${operationalWorkbook ? 'all-programs' : updateTemplate ? 'update-assistants' : 'export'}-${Date.now()}.${responseFormat}"`);
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
        const sheetUrl = String(req.body?.sheet_url || '').trim();
        if (!req.file && !sheetUrl) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn file hoặc dán link Google Sheets' });
            return;
        }
        const programCode = String(req.body?.program_code || '').trim();
        if (!programCode) {
            res.status(400).json({
                success: false,
                message: 'Vui lòng chọn đúng một Chương trình trước khi import lịch học',
            });
            return;
        }
        (0, authorization_service_1.assertProgramAccess)(req.user, 'calendar.import', programCode);
        const programContext = await livestreamService.getCalendarImportProgramContext(programCode);
        const buffer = req.file?.buffer ?? await (0, google_sheet_csv_1.getPublicGoogleSheetCsv)(sheetUrl);
        const originalName = req.file?.originalname ?? 'google-sheet.csv';
        const rows = (0, livestream_io_1.parseCalendarImportFile)(buffer, originalName);
        const { importRows, errors } = (0, livestream_io_1.validateCalendarImportRows)(rows, programContext);
        if (errors.length) {
            const invalidRows = new Set(errors.map((error) => error.row)).size;
            res.status(400).json({
                success: false,
                status: 'validation_error',
                message: 'File import có dữ liệu không hợp lệ',
                summary: {
                    totalRows: rows.length,
                    validRows: Math.max(0, rows.length - invalidRows),
                    invalidRows,
                },
                errors,
            });
            return;
        }
        const result = await (0, calendar_import_service_1.importCalendarFromSheet)(importRows, getChangeActor(req));
        if (result.status === 'validation_error') {
            res.status(400).json({
                success: false,
                status: result.status,
                message: 'File import có dữ liệu không hợp lệ',
                summary: result.summary,
                errors: result.errors,
            });
            return;
        }
        res.status(201).json({
            success: true,
            status: result.status,
            message: 'Import lịch học thành công',
            data: result,
        });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.importFile = importFile;
const updateImportFile = async (req, res) => {
    try {
        const sheetUrl = String(req.body?.sheet_url || '').trim();
        if (!req.file && !sheetUrl) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn file hoặc dán link Google Sheets' });
            return;
        }
        const programCode = String(req.body?.program_code || '').trim();
        if (!programCode) {
            res.status(400).json({
                success: false,
                message: 'Vui lòng chọn đúng một Chương trình trước khi cập nhật lịch học',
            });
            return;
        }
        (0, authorization_service_1.assertProgramAccess)(req.user, 'calendar.update', programCode);
        const programContext = await livestreamService.getCalendarImportProgramContext(programCode);
        const buffer = req.file?.buffer ?? await (0, google_sheet_csv_1.getPublicGoogleSheetCsv)(sheetUrl);
        const originalName = req.file?.originalname ?? 'google-sheet.csv';
        const rows = (0, livestream_io_1.parseCalendarImportFile)(buffer, originalName);
        const { importRows, errors } = (0, livestream_io_1.validateCalendarImportRows)(rows, programContext);
        if (errors.length) {
            const invalidRows = new Set(errors.map((error) => error.row)).size;
            res.status(400).json({
                success: false,
                status: 'validation_error',
                message: 'File cập nhật có dữ liệu không hợp lệ',
                summary: {
                    totalRows: rows.length,
                    validRows: Math.max(0, rows.length - invalidRows),
                    invalidRows,
                },
                errors,
            });
            return;
        }
        const rawExistingDataMode = String(req.body?.existing_data_mode || req.body?.assistant_conflict_mode || 'skip');
        if (rawExistingDataMode !== 'skip' && rawExistingDataMode !== 'overwrite') {
            res.status(400).json({
                success: false,
                message: 'existing_data_mode chỉ nhận skip hoặc overwrite',
            });
            return;
        }
        const result = await (0, calendar_import_service_1.updateCalendarsFromSheet)(importRows, getChangeActor(req), rawExistingDataMode);
        if (result.status === 'validation_error') {
            res.status(400).json({
                success: false,
                status: result.status,
                message: 'File cập nhật có dữ liệu không hợp lệ',
                summary: result.summary,
                errors: result.errors,
            });
            return;
        }
        res.status(200).json({
            success: true,
            status: result.status,
            message: 'Cập nhật lịch học thành công',
            data: result,
        });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateImportFile = updateImportFile;
const previewMappingUpdates = async (req, res) => {
    try {
        const result = await livestreamService.previewCalendarMappingUpdates(req.body);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.previewMappingUpdates = previewMappingUpdates;
const updateMappings = async (req, res) => {
    try {
        const result = await livestreamService.updateCalendarMappings(req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.updateMappings = updateMappings;
const previewMappingImport = async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn file import' });
            return;
        }
        const programCode = String(req.body?.program_code || '').trim();
        if (!programCode) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn Chương trình trước khi import' });
            return;
        }
        await livestreamService.assertSchedulingProgramExists(programCode);
        const updates = (0, livestream_io_1.parseCalendarMappingImportFile)(req.file.buffer, req.file.originalname);
        const result = await livestreamService.previewCalendarMappingUpdates({ updates });
        await livestreamService.assertCalendarIdsInProgram(result.updates.map((item) => Number(item.id)), programCode);
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.previewMappingImport = previewMappingImport;
const importMappings = async (req, res) => {
    try {
        const programCode = String(req.body?.program_code || '').trim();
        if (!programCode) {
            res.status(400).json({ success: false, message: 'Vui lòng chọn Chương trình trước khi import' });
            return;
        }
        await livestreamService.assertSchedulingProgramExists(programCode);
        const preview = await livestreamService.previewCalendarMappingUpdates(req.body);
        await livestreamService.assertCalendarIdsInProgram(preview.updates.map((item) => Number(item.id)), programCode);
        const result = await livestreamService.updateCalendarMappings(req.body, getChangeActor(req));
        res.status(200).json({ success: true, data: result });
    }
    catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
exports.importMappings = importMappings;
