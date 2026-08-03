import { Router } from 'express';
import multer from 'multer';
import lessonController from './lesson.controller';
import authMiddleware from '../auth/auth.middleware';

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.use(authenticate);
router.get('/', authorize(['lessons.view']), lessonController.list);
router.get('/options/subjects', authorize(['lessons.view']), lessonController.subjects);
router.patch(
  '/bulk',
  authorize(['lessons.update']),
  authorizeFields('lessons', (req) => Object.keys(req.body?.data || {})),
  lessonController.bulkUpdate
);
router.patch(
  '/reorder',
  authorize(['lessons.update']),
  authorizeFields('lessons', () => ['learn_number']),
  lessonController.reorder
);
router.get('/export', authorize(['lessons.export']), lessonController.exportFile);
router.get('/template', authorize(['lessons.import']), lessonController.template);
router.post(
  '/import',
  authorize(['lessons.import']),
  upload.single('file'),
  lessonController.importFile
);
router.get('/:id', authorize(['lessons.view']), lessonController.detail);
router.post(
  '/',
  authorize(['lessons.create']),
  authorizeFields('lessons', (req) => Object.keys(req.body || {})),
  lessonController.create
);
router.put(
  '/:id',
  authorize(['lessons.update']),
  authorizeFields('lessons', (req) => Object.keys(req.body || {})),
  lessonController.update
);
router.delete('/:id', authorize(['lessons.delete']), lessonController.remove);

export default router;
