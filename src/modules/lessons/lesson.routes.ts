import { Router } from 'express';
import multer from 'multer';
import lessonController from './lesson.controller';
import authMiddleware from '../auth/auth.middleware';
import { requireLessonSecondaryAuth } from './lesson-secondary-auth';
import prisma from '../../lib/prisma';

const router = Router();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = authMiddleware;
// Khối/môn/mã chương trình là ngữ cảnh nghiệp vụ, không nằm trong quyền dữ liệu
// của màn Quản lý đề cương. Chỉ hai field người dùng thao tác trực tiếp được kiểm tra.
const CURRICULUM_EDITABLE_FIELDS = new Set(['learn_number', 'lesson_name']);
const curriculumEditableFields = (payload: unknown) => Object.keys((payload || {}) as Record<string, unknown>)
  .filter((fieldCode) => CURRICULUM_EDITABLE_FIELDS.has(fieldCode));
const lessonCodesByIds = async (ids: unknown[]) => (
  (await prisma.lessons.findMany({
    where: { id: { in: ids.map((id) => BigInt(String(id))) } },
    select: { subject_code: true },
  })).map((item) => item.subject_code)
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.use(authenticate);
router.post('/reauth', authorize(['lessons.view']), lessonController.reauthenticate);
router.use(requireLessonSecondaryAuth);
router.get('/reauth', authorize(['lessons.view']), lessonController.reauthStatus);
router.get('/', authorize(['lessons.view']), authorizeProgram('lessons.view', (req) => String(req.query.subject_code || req.query.course_code || '')), lessonController.list);
router.get('/options/subjects', authorize(['lessons.view']), lessonController.subjects);
router.get('/options/programs', authorize(['lessons.view']), lessonController.programs);
router.post(
  '/options/programs',
  authorize(['lessons.create']),
  authorizeProgram('lessons.create', (req) => String(req.body?.subject_code || '')),
  authorizeFields('lessons', (req) => curriculumEditableFields(req.body)),
  lessonController.createProgram
);
router.get('/course-mappings', authorize(['lessons.view']), authorizeProgram('lessons.view', (req) => String(req.query.program_code || '')), lessonController.courseMappings);
router.put('/course-mappings', authorize(['lessons.update']), authorizeProgram('lessons.update', (req) => String(req.body?.program_code || '')), lessonController.updateCourseMappings);
router.patch(
  '/bulk',
  authorize(['lessons.update']),
  authorizePrograms('lessons.update', (req) => lessonCodesByIds(req.body?.ids || [])),
  authorizeFields('lessons', (req) => curriculumEditableFields(req.body?.data)),
  lessonController.bulkUpdate
);
router.patch(
  '/reorder',
  authorize(['lessons.update']),
  authorizeProgram('lessons.update', (req) => String(req.body?.subject_code || '')),
  authorizeFields('lessons', () => ['learn_number']),
  lessonController.reorder
);
router.get('/export', authorize(['lessons.export']), authorizePrograms('lessons.export', async (req) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  return ids.length ? lessonCodesByIds(ids) : [String(req.query.subject_code || req.query.course_code || '')];
}), lessonController.exportFile);
router.get('/template', authorize(['lessons.import']), authorizeProgram('lessons.import', (req) => String(req.query.program_code || '')), lessonController.template);
router.get('/program-template', authorize(['lessons.import']), lessonController.programTemplate);
router.post(
  '/import',
  authorize(['lessons.import']),
  upload.single('file'),
  lessonController.importFile
);
router.get('/:id', authorize(['lessons.view']), authorizePrograms('lessons.view', (req) => lessonCodesByIds([req.params.id])), lessonController.detail);
router.post(
  '/',
  authorize(['lessons.create']),
  authorizeProgram('lessons.create', (req) => String(req.body?.subject_code || '')),
  authorizeFields('lessons', (req) => curriculumEditableFields(req.body)),
  lessonController.create
);
router.put(
  '/:id',
  authorize(['lessons.update']),
  authorizePrograms('lessons.update', (req) => lessonCodesByIds([req.params.id])),
  authorizeFields('lessons', (req) => curriculumEditableFields(req.body)),
  lessonController.update
);
router.delete('/:id', authorize(['lessons.delete']), authorizePrograms('lessons.delete', (req) => lessonCodesByIds([req.params.id])), lessonController.remove);

export default router;
