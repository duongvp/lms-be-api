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
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const livestreamController = __importStar(require("./livestream.controller"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields } = auth_middleware_1.default;
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
    'lesson_id',
    'session_id',
    'sessionId',
    'package_lesson_mappings',
    'grade',
    'reason',
    'change_reason',
    'update_mode',
    'mode',
    'course_end_time',
    'allow_past',
].includes(field))
    .map((field) => {
    if (field === 'room')
        return 'channel_name';
    if (field === 'subject_name')
        return 'subject';
    return field;
})));
router.use(authenticate);
router.get('/', authorize(['calendar.view']), livestreamController.getCalendar);
router.get('/export', authorize(['calendar.export']), livestreamController.exportFile);
router.get('/template', authorize(['calendar.import']), livestreamController.importTemplate);
router.get('/programs', authorize(['calendar.view']), livestreamController.getPrograms);
router.get('/programs/:code/lessons', authorize(['calendar.view']), livestreamController.getProgramLessons);
router.get('/programs/:code/lessons/:lessonId/hmo-sections', authorize(['calendar.view']), livestreamController.getProgramLessonHocmaiSections);
router.post('/import', authorize(['calendar.import']), upload.single('file'), livestreamController.importFile);
router.post('/mapping/preview', authorize(['calendar.update']), livestreamController.previewMappingUpdates);
router.put('/mapping', authorize(['calendar.update']), livestreamController.updateMappings);
router.post('/mapping/import/preview', authorize(['calendar.import', 'calendar.update']), upload.single('file'), livestreamController.previewMappingImport);
router.post('/single', authorize(['calendar.create']), authorizeTeachingAssignment('calendar.teacher.assign'), authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body || {}))), livestreamController.createSingle);
router.post('/bulk', authorize(['calendar.create']), authorizeTeachingAssignment('calendar.teacher.assign'), authorizeFields('calendar', (req) => normalizeCalendarFields((req.body?.calendars || []).flatMap((item) => Object.keys(item || {})))), livestreamController.createBulk);
router.post('/auto-schedule/preview', authorize(['calendar.create']), livestreamController.previewAutoSchedule);
router.post('/auto-schedule/commit', authorize(['calendar.create']), authorizeTeachingAssignment('calendar.teacher.assign'), livestreamController.commitAutoSchedule);
// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put('/bulk', authorize(['calendar.update']), authorizeTeachingAssignment('calendar.teacher.update'), authorizeFields('calendar', (req) => normalizeCalendarFields(Array.isArray(req.body?.update_data)
    ? req.body.update_data.flatMap((item) => Object.keys(item || {}))
    : Object.keys(req.body?.update_data || {}))), livestreamController.updateBulk);
router.put('/:id/reschedule', authorize(['calendar.update']), authorizeTeachingAssignment('calendar.teacher.update'), authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body?.new_session || {}))), livestreamController.rescheduleSession);
router.put('/:id', authorize(['calendar.update']), authorizeTeachingAssignment('calendar.teacher.update'), authorizeFields('calendar', (req) => normalizeCalendarFields([
    ...Object.keys(req.body || {}),
    ...Object.keys(req.body?.new_session || {}),
])), livestreamController.updateSchedule);
router.put('/:id/cancel', authorize(['calendar.update']), authorizeFields('calendar', () => ['lesson_status']), livestreamController.cancelSession);
router.delete('/:id', authorize(['calendar.delete']), livestreamController.deleteSession);
exports.default = router;
