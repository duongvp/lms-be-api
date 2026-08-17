"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const lesson_controller_1 = __importDefault(require("./lesson.controller"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const lesson_secondary_auth_1 = require("./lesson-secondary-auth");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = auth_middleware_1.default;
// Khối/môn/mã chương trình là ngữ cảnh nghiệp vụ, không nằm trong quyền dữ liệu
// của màn Quản lý đề cương. Chỉ hai field người dùng thao tác trực tiếp được kiểm tra.
const CURRICULUM_EDITABLE_FIELDS = new Set(['learn_number', 'lesson_name']);
const curriculumEditableFields = (payload) => Object.keys((payload || {}))
    .filter((fieldCode) => CURRICULUM_EDITABLE_FIELDS.has(fieldCode));
const lessonCodesByIds = async (ids) => ((await prisma_1.default.lessons.findMany({
    where: { id: { in: ids.map((id) => BigInt(String(id))) } },
    select: { subject_code: true },
})).map((item) => item.subject_code));
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});
router.use(authenticate);
router.post('/reauth', authorize(['lessons.view']), lesson_controller_1.default.reauthenticate);
router.use(lesson_secondary_auth_1.requireLessonSecondaryAuth);
router.get('/reauth', authorize(['lessons.view']), lesson_controller_1.default.reauthStatus);
router.get('/', authorize(['lessons.view']), authorizeProgram('lessons.view', (req) => String(req.query.subject_code || req.query.course_code || '')), lesson_controller_1.default.list);
router.get('/options/subjects', authorize(['lessons.view']), lesson_controller_1.default.subjects);
router.get('/options/programs', authorize(['lessons.view']), lesson_controller_1.default.programs);
router.post('/options/programs', authorize(['lessons.create']), authorizeProgram('lessons.create', (req) => String(req.body?.subject_code || '')), authorizeFields('lessons', (req) => curriculumEditableFields(req.body)), lesson_controller_1.default.createProgram);
router.get('/course-mappings', authorize(['lessons.view']), authorizeProgram('lessons.view', (req) => String(req.query.program_code || '')), lesson_controller_1.default.courseMappings);
router.put('/course-mappings', authorize(['lessons.update']), authorizeProgram('lessons.update', (req) => String(req.body?.program_code || '')), lesson_controller_1.default.updateCourseMappings);
router.patch('/bulk', authorize(['lessons.update']), authorizePrograms('lessons.update', (req) => lessonCodesByIds(req.body?.ids || [])), authorizeFields('lessons', (req) => curriculumEditableFields(req.body?.data)), lesson_controller_1.default.bulkUpdate);
router.patch('/reorder', authorize(['lessons.update']), authorizeProgram('lessons.update', (req) => String(req.body?.subject_code || '')), authorizeFields('lessons', () => ['learn_number']), lesson_controller_1.default.reorder);
router.get('/export', authorize(['lessons.export']), authorizePrograms('lessons.export', async (req) => {
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    return ids.length ? lessonCodesByIds(ids) : [String(req.query.subject_code || req.query.course_code || '')];
}), lesson_controller_1.default.exportFile);
router.get('/template', authorize(['lessons.import']), authorizeProgram('lessons.import', (req) => String(req.query.program_code || '')), lesson_controller_1.default.template);
router.get('/program-template', authorize(['lessons.import']), lesson_controller_1.default.programTemplate);
router.post('/import', authorize(['lessons.import']), upload.single('file'), lesson_controller_1.default.importFile);
router.get('/:id', authorize(['lessons.view']), authorizePrograms('lessons.view', (req) => lessonCodesByIds([req.params.id])), lesson_controller_1.default.detail);
router.post('/', authorize(['lessons.create']), authorizeProgram('lessons.create', (req) => String(req.body?.subject_code || '')), authorizeFields('lessons', (req) => curriculumEditableFields(req.body)), lesson_controller_1.default.create);
router.put('/:id', authorize(['lessons.update']), authorizePrograms('lessons.update', (req) => lessonCodesByIds([req.params.id])), authorizeFields('lessons', (req) => curriculumEditableFields(req.body)), lesson_controller_1.default.update);
router.delete('/:id', authorize(['lessons.delete']), authorizePrograms('lessons.delete', (req) => lessonCodesByIds([req.params.id])), lesson_controller_1.default.remove);
exports.default = router;
