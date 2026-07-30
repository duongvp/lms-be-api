import { Router } from 'express';
import multer from 'multer';
import * as livestreamController from './livestream.controller';
import authMiddleware from '../auth/auth.middleware';

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const normalizeCalendarFields = (fields: string[]) => Array.from(new Set(
  fields
    .filter((field) => ![
      'lesson_id',
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
  authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body || {}))),
  livestreamController.createSingle
);
router.post(
  '/bulk',
  authorize(['calendar.create']),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    (req.body?.calendars || []).flatMap((item: any) => Object.keys(item || {}))
  )),
  livestreamController.createBulk
);

// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put(
  '/bulk',
  authorize(['calendar.update']),
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
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    Object.keys(req.body?.new_session || {})
  )),
  livestreamController.rescheduleSession
);
router.put(
  '/:id',
  authorize(['calendar.update']),
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
