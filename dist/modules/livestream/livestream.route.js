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
const calendar_approval_routes_1 = require("../calendar-approvals/calendar-approval.routes");
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const livestreamController = __importStar(require("./livestream.controller"));
const calendar_registration_audit_route_1 = __importDefault(require("./calendar-registration-audit.route"));
const calendar_detail_report_route_1 = require("./calendar-detail-report.route");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = auth_middleware_1.default;
const authorizeCalendarList = (req, res, next) => {
    const programCode = String(req.query.code_exact || req.query.code || '').trim();
    const isAdmin = req.user?.permissions?.includes('*') || req.user?.roles?.includes('admin');
    // Admin được phép rà lịch nhiều chương trình theo khoảng thời gian. Các vai
    // trò khác vẫn buộc phải chọn chương trình để không vượt phạm vi phân quyền.
    if (!programCode && isAdmin)
        return next();
    return authorizeProgram('calendar.view', () => programCode)(req, res, next);
};
const calendarCodesByIds = async (ids) => {
    const validIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (!validIds.length)
        return [];
    const rows = await prisma_1.default.$queryRaw(client_1.Prisma.sql `
    SELECT COALESCE(session_lesson.subject_code, legacy_lesson.subject_code,
      CASE WHEN calendar_row.session_id IS NULL OR calendar_row.deleted_at IS NOT NULL THEN calendar_row.code END) AS program_code
    FROM calendar AS calendar_row
    LEFT JOIN lessons AS session_lesson
      ON session_lesson.id = calendar_row.session_id AND session_lesson.status <> 0
    LEFT JOIN lessons AS legacy_lesson
      ON calendar_row.session_id IS NULL
     AND legacy_lesson.subject_code = calendar_row.code
     AND legacy_lesson.learn_number = calendar_row.learn_number
     AND legacy_lesson.status <> 0
    WHERE calendar_row.id IN (${client_1.Prisma.join(validIds)})
  `);
    return rows.map((row) => row.program_code).filter((code) => Boolean(code));
};
const calendarCodeById = async (req) => calendarCodesByIds([req.params.id]);
const calendarCodesFromUpdates = async (updates) => {
    const ids = updates.map((item) => Number(item?.id)).filter((id) => Number.isInteger(id) && id > 0);
    const keys = updates.map((item) => String(item?.key || '').trim()).filter(Boolean);
    const rows = await prisma_1.default.calendar.findMany({
        where: {
            OR: [
                ...(ids.length ? [{ id: { in: ids } }] : []),
                ...(keys.length ? [{ key: { in: keys } }] : []),
            ],
        },
        select: { id: true },
    });
    return [...await calendarCreateCodes(updates), ...await calendarCodesByIds(rows.map((item) => item.id))];
};
const calendarCreateCodes = async (items) => {
    const directCodes = items
        .map((item) => item?.program_code || item?.subject_code)
        .map((code) => String(code || '').trim())
        .filter(Boolean);
    const lessonIds = items
        .map((item) => item?.session_id || item?.sessionId || item?.lesson_id)
        .filter((id) => id !== undefined && id !== null && String(id).trim() !== '');
    const parsedIds = lessonIds.flatMap((id) => {
        try {
            return [BigInt(String(id))];
        }
        catch {
            return [];
        }
    });
    const lessons = parsedIds.length ? await prisma_1.default.lessons.findMany({
        where: { id: { in: parsedIds }, status: { not: 0 } },
        select: { subject_code: true },
    }) : [];
    // code is accepted only as the legacy subject_code fallback when no lesson id is available.
    const legacyCodes = items
        .filter((item) => !item?.session_id && !item?.sessionId && !item?.lesson_id && !item?.program_code && !item?.subject_code)
        .map((item) => String(item?.code || '').trim()).filter(Boolean);
    return Array.from(new Set([...directCodes, ...lessons.map((lesson) => lesson.subject_code), ...legacyCodes]));
};
const configuredImportFileSize = Number(process.env.CALENDAR_IMPORT_MAX_FILE_SIZE_MB);
const importFileSizeMb = Number.isFinite(configuredImportFileSize)
    && configuredImportFileSize > 0
    ? configuredImportFileSize
    : 10;
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: importFileSizeMb * 1024 * 1024,
    },
});
const containsTeachingAssignment = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    if ('teacher' in value || 'assistant_teacher' in value)
        return true;
    if (Array.isArray(value))
        return value.some(containsTeachingAssignment);
    return Object.values(value).some(containsTeachingAssignment);
};
const authorizeTeachingAssignment = (permission) => (req, res, next) => {
    if (!containsTeachingAssignment(req.body))
        return next();
    const permissions = req.user?.permissions || [];
    const roles = req.user?.roles || [];
    if (permissions.includes('*')
        || permissions.includes(permission)
        || roles.includes('admin'))
        return next();
    return res.status(403).json({
        success: false,
        message: 'Không có quyền phân công giáo viên hoặc trợ giảng',
    });
};
const normalizeCalendarFields = (fields) => Array.from(new Set(fields
    .filter((field) => ![
    'calendar_source',
    'lesson_id',
    'session_id',
    'sessionId',
    'package_lesson_mappings',
    'grade',
    'reason',
    'change_reason',
    'send_notification',
    'update_mode',
    'mode',
    'course_end_time',
    'allow_past',
    'allow_shared_staff_schedule',
].includes(field))
    .map((field) => {
    if (field === 'room')
        return 'channel_name';
    if (field === 'subject_name')
        return 'subject';
    return field;
})));
// Empty staff values on a new record do not assign or clear anyone.
// Updates still check explicit empty values, since they can remove existing staff.
const calendarCreateFields = (items) => normalizeCalendarFields(items.flatMap(item => Object.keys(item || {}).filter(field => field !== 'system_type' && (!['teacher', 'assistant_teacher'].includes(field)
    || (Array.isArray(item[field]) ? item[field].some((value) => String(value || '').trim()) : String(item[field] || '').trim())))));
router.use(authenticate);
router.use('/room-report/calendars/:calendarId', (0, calendar_detail_report_route_1.createCalendarDetailReportRouter)(async (req) => {
    const request = req;
    return request.detailProgramCodes ??= await calendarCodesByIds([req.params.calendarId]);
}));
router.use('/students/registration-audits', calendar_registration_audit_route_1.default);
router.get('/filter-options/headers', authorize(['calendar.view']), authorizeCalendarList, livestreamController.getCalendarHeaderFilterOptions);
router.get('/filter-options/teachers', authorize(['calendar.view']), authorizeCalendarList, livestreamController.getCalendarTeacherFilterOptions);
router.get('/', authorize(['calendar.view']), authorizeCalendarList, livestreamController.getCalendar);
router.get('/export', authorize(['calendar.export']), livestreamController.exportFile);
router.get('/room-report', authorize(['calendar.view']), authorizeCalendarList, livestreamController.getRoomReport);
router.get('/room-report/live-times', authorize(['calendar.view']), authorizeCalendarList, livestreamController.getRoomReportLiveTimes);
router.get('/room-report/export', authorize(['calendar.view']), authorize(['calendar.export']), authorizeCalendarList, livestreamController.exportRoomReport);
router.post('/export/google-sheet', authorize(['calendar.export']), livestreamController.exportGoogleSheet);
router.get('/export/google-sheet/:jobId', authorize(['calendar.export']), livestreamController.exportGoogleSheetProgress);
router.get('/template', authorize(['calendar.import']), livestreamController.importTemplate);
router.get('/classification-options', authorize(['calendar.view']), livestreamController.getClassificationOptions);
router.get('/programs', authorize(['calendar.view']), livestreamController.getPrograms);
router.get('/programs/:code/lessons', authorize(['calendar.view']), authorizeProgram('calendar.view', (req) => String(req.params.code)), livestreamController.getProgramLessons);
router.post('/programs/:code/lessons/hmo-sections/batch', authorize(['calendar.view']), authorizeProgram('calendar.view', (req) => String(req.params.code)), livestreamController.getProgramLessonsHocmaiSections);
router.get('/programs/:code/lessons/:lessonId/hmo-sections', authorize(['calendar.view']), authorizeProgram('calendar.view', (req) => String(req.params.code)), livestreamController.getProgramLessonHocmaiSections);
router.post('/import', authorize(['calendar.import']), upload.single('file'), livestreamController.importFile);
router.post('/import/update', authorize(['calendar.update']), upload.single('file'), livestreamController.updateImportFile);
router.post('/mapping/preview', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesFromUpdates(req.body?.updates || [])), livestreamController.previewMappingUpdates);
router.put('/mapping', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesFromUpdates(req.body?.updates || [])), (0, calendar_approval_routes_1.scheduleApprovalGate)('mapping'), livestreamController.updateMappings);
router.post('/mapping/import/preview', authorize(['calendar.update']), upload.single('file'), authorizeProgram('calendar.update', (req) => String(req.body?.program_code || '')), livestreamController.previewMappingImport);
router.put('/mapping/import', authorize(['calendar.update']), authorizeProgram('calendar.update', (req) => String(req.body?.program_code || '')), authorizePrograms('calendar.update', (req) => calendarCodesByIds((req.body?.updates || []).map((item) => item?.id))), (0, calendar_approval_routes_1.scheduleApprovalGate)('mapping'), livestreamController.importMappings);
router.post('/single', authorize(['calendar.create']), authorizePrograms('calendar.create', (req) => calendarCreateCodes([req.body || {}])), authorizeTeachingAssignment('calendar.teacher.manage'), authorizeFields('calendar', (req) => calendarCreateFields([req.body || {}])), (0, calendar_approval_routes_1.scheduleApprovalGate)('create'), livestreamController.createSingle);
router.post('/bulk', authorize(['calendar.create']), authorizePrograms('calendar.create', (req) => calendarCreateCodes(req.body?.calendars || [])), authorizeTeachingAssignment('calendar.teacher.manage'), authorizeFields('calendar', (req) => calendarCreateFields(req.body?.calendars || [])), (0, calendar_approval_routes_1.scheduleApprovalGate)('createBulk'), livestreamController.createBulk);
router.post('/auto-schedule/preview', authorize(['calendar.create']), authorizeProgram('calendar.create', (req) => String(req.body?.program_code || req.body?.code || '')), livestreamController.previewAutoSchedule);
router.post('/auto-schedule/commit', authorize(['calendar.create']), authorizeProgram('calendar.create', (req) => String(req.body?.program_code || req.body?.code || '')), authorizeTeachingAssignment('calendar.teacher.manage'), (0, calendar_approval_routes_1.scheduleApprovalGate)('auto'), livestreamController.commitAutoSchedule);
// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put('/bulk', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), authorizeTeachingAssignment('calendar.teacher.manage'), authorizeFields('calendar', (req) => normalizeCalendarFields(Array.isArray(req.body?.update_data)
    ? req.body.update_data.flatMap((item) => Object.keys(item || {}))
    : Object.keys(req.body?.update_data || {}))), (0, calendar_approval_routes_1.scheduleApprovalGate)('updateBulk'), livestreamController.updateBulk);
// Đối soát enrollment nhân sự theo phân công và phạm vi chương trình.
router.post('/sync-missing-teaching-users', authorize(['calendar.update']), authorize(['calendar.teacher.manage']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), livestreamController.backfillMissingTeachingUsers);
router.post('/hocmai-sync-queue/resend', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), livestreamController.resendToHocmai);
router.post('/:id/hocmai-canceled-status/retry', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), livestreamController.retryCanceledHocmaiStatus);
router.post('/students/sync', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), livestreamController.syncStudents);
router.get('/:id/attendance-reset-students', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), livestreamController.getCalendarAttendanceResetStudents);
router.post('/:id/reset-attendance', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), livestreamController.resetCalendarAttendance);
router.post('/students/sync-attendance', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), livestreamController.syncCalendarAttendance);
router.get('/students/sync/:jobId', authorize(['calendar.update']), livestreamController.getStudentSyncProgress);
router.put('/swap', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds([
    req.body?.first_id,
    req.body?.second_id,
])), authorizeFields('calendar', () => ['start_time', 'end_time']), (0, calendar_approval_routes_1.scheduleApprovalGate)('swap'), livestreamController.swapSessionTimes);
router.post('/evg-stream/bulk', authorize(['calendar.update']), authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])), (0, calendar_approval_routes_1.requireOfficialOperation)(['update']), livestreamController.provisionEvgStreamsBulk);
router.post('/:id/evg-stream', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), (0, calendar_approval_routes_1.requireOfficialOperation)(['update']), livestreamController.provisionEvgStream);
router.post('/:id/classroom-assignment/preview', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), livestreamController.previewStudentClassroomAssignment);
router.post('/:id/classroom-assignment/apply', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), (0, calendar_approval_routes_1.requireOfficialOperation)(['update']), livestreamController.applyStudentClassroomAssignment);
router.put('/:id/reschedule', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), authorizeTeachingAssignment('calendar.teacher.manage'), authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body?.new_session || {}))), (0, calendar_approval_routes_1.scheduleApprovalGate)('reschedule'), livestreamController.rescheduleSession);
router.put('/:id', authorize(['calendar.update']), authorizePrograms('calendar.update', async (req) => [
    ...await calendarCodeById(req),
    ...await calendarCreateCodes([req.body || {}]),
]), authorizeTeachingAssignment('calendar.teacher.manage'), authorizeFields('calendar', (req) => normalizeCalendarFields([
    ...Object.keys(req.body || {}),
    ...Object.keys(req.body?.new_session || {}),
])), (0, calendar_approval_routes_1.scheduleApprovalGate)('update'), livestreamController.updateSchedule);
router.put('/:id/cancel', authorize(['calendar.update']), authorizePrograms('calendar.update', calendarCodeById), authorizeFields('calendar', () => ['lesson_status']), (0, calendar_approval_routes_1.scheduleApprovalGate)('cancel'), livestreamController.cancelSession);
router.post('/:id/restore', authorize(['calendar.delete']), authorizePrograms('calendar.delete', calendarCodeById), (0, calendar_approval_routes_1.scheduleApprovalGate)('restore'), livestreamController.restoreSession);
router.delete('/:id', authorize(['calendar.delete']), authorizePrograms('calendar.delete', calendarCodeById), (0, calendar_approval_routes_1.scheduleApprovalGate)('delete'), livestreamController.deleteSession);
exports.default = router;
