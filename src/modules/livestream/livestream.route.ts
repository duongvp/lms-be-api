import { Router } from 'express';
import multer from 'multer';
import * as livestreamController from './livestream.controller';
import authMiddleware from '../auth/auth.middleware';

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const configuredImportFileSize = Number(process.env.CALENDAR_IMPORT_MAX_FILE_SIZE_MB);
const importFileSizeMb = Number.isFinite(configuredImportFileSize)
  && configuredImportFileSize > 0
  ? configuredImportFileSize
  : 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: importFileSizeMb * 1024 * 1024,
  },
});

const containsTeachingAssignment = (value: any): boolean => {
  if (!value || typeof value !== 'object') return false;
  if ('teacher' in value || 'assistant_teacher' in value) return true;
  if (Array.isArray(value)) return value.some(containsTeachingAssignment);
  return Object.values(value).some(containsTeachingAssignment);
};

const authorizeTeachingAssignment = (permission: string) => (
  req: any,
  res: any,
  next: any
) => {
  if (!containsTeachingAssignment(req.body)) return next();
  const permissions = req.user?.permissions || [];
  const roles = req.user?.roles || [];
  if (
    permissions.includes('*')
    || permissions.includes(permission)
    || roles.includes('admin')
  ) return next();
  return res.status(403).json({
    success: false,
    message: 'Không có quyền phân công giáo viên hoặc trợ giảng',
  });
};

const normalizeCalendarFields = (fields: string[]) => Array.from(new Set(
  fields
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
      if (field === 'room') return 'channel_name';
      if (field === 'subject_name') return 'subject';
      return field;
    })
));

router.use(authenticate);

router.get('/', authorize(['calendar.view']), livestreamController.getCalendar);
router.get('/export', authorize(['calendar.export']), livestreamController.exportFile);
router.get('/template', authorize(['calendar.import']), livestreamController.importTemplate);
router.post(
  '/import',
  authorize(['calendar.import']),
  upload.single('file'),
  livestreamController.importFile
);
router.post(
  '/single',
  authorize(['calendar.create']),
  authorizeTeachingAssignment('calendar.teacher.assign'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body || {}))),
  livestreamController.createSingle
);
router.post(
  '/bulk',
  authorize(['calendar.create']),
  authorizeTeachingAssignment('calendar.teacher.assign'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    (req.body?.calendars || []).flatMap((item: any) => Object.keys(item || {}))
  )),
  livestreamController.createBulk
);

// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put(
  '/bulk',
  authorize(['calendar.update']),
  authorizeTeachingAssignment('calendar.teacher.update'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    Array.isArray(req.body?.update_data)
      ? req.body.update_data.flatMap((item: any) => Object.keys(item || {}))
      : Object.keys(req.body?.update_data || {})
  )),
  livestreamController.updateBulk
);
router.put(
  '/:id/reschedule',
  authorize(['calendar.update']),
  authorizeTeachingAssignment('calendar.teacher.update'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    Object.keys(req.body?.new_session || {})
  )),
  livestreamController.rescheduleSession
);
router.put(
  '/:id',
  authorize(['calendar.update']),
  authorizeTeachingAssignment('calendar.teacher.update'),
  authorizeFields('calendar', (req) => normalizeCalendarFields([
    ...Object.keys(req.body || {}),
    ...Object.keys(req.body?.new_session || {}),
  ])),
  livestreamController.updateSchedule
);
router.put(
  '/:id/cancel',
  authorize(['calendar.update']),
  authorizeFields('calendar', () => ['lesson_status']),
  livestreamController.cancelSession
);
router.delete(
  '/:id',
  authorize(['calendar.delete']),
  livestreamController.deleteSession
);


export default router;
