import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import controller from './teacher-profile.controller';
import multer from 'multer';

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate);
router.get('/', authorize(['teacher_profile.view']), controller.list);
router.get('/export', authorize(['teacher_profile.export']), controller.exportFile);
router.get('/template', authorize(['teacher_profile.import']), controller.template);
router.post(
  '/import',
  authorize(['teacher_profile.import']),
  upload.single('file'),
  controller.importFile
);
router.get('/:id', authorize(['teacher_profile.view']), controller.detail);
router.post(
  '/',
  authorize(['teacher_profile.create']),
  authorizeFields('teacher_profile', (req) => Object.keys(req.body || {})),
  controller.create
);
router.put(
  '/:id',
  authorize(['teacher_profile.update']),
  authorizeFields(
    'teacher_profile',
    (req) => Object.keys(req.body || {}).filter((field) => field !== 'username')
  ),
  controller.update
);
router.patch(
  '/:id/status',
  authorize(['teacher_profile.status']),
  authorizeFields('teacher_profile', () => ['status']),
  controller.updateStatus
);
router.delete('/:id', authorize(['teacher_profile.delete']), controller.remove);

export default router;
