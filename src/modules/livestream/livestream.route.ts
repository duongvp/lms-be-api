import { Router } from 'express';
import multer from 'multer';
import * as livestreamController from './livestream.controller';
import authMiddleware from '../auth/auth.middleware';
import prisma from '../../lib/prisma';
import { Prisma } from '@prisma/client';

const router = Router();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = authMiddleware;
const authorizeCalendarList = (req: any, res: any, next: any) => {
  const programCode = String(req.query.code_exact || req.query.code || '').trim();
  const isAdmin = req.user?.permissions?.includes('*') || req.user?.roles?.includes('admin');
  // Admin được phép rà lịch nhiều chương trình theo khoảng thời gian. Các vai
  // trò khác vẫn buộc phải chọn chương trình để không vượt phạm vi phân quyền.
  if (!programCode && isAdmin) return next();
  return authorizeProgram('calendar.view', () => programCode)(req, res, next);
};
const calendarCodesByIds = async (ids: unknown[]) => {
  const validIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!validIds.length) return [];
  const rows = await prisma.$queryRaw<Array<{ program_code: string | null }>>(Prisma.sql`
    SELECT COALESCE(session_lesson.subject_code, legacy_lesson.subject_code) AS program_code
    FROM calendar AS calendar_row
    LEFT JOIN lessons AS session_lesson
      ON session_lesson.id = calendar_row.session_id AND session_lesson.status <> 0
    LEFT JOIN lessons AS legacy_lesson
      ON calendar_row.session_id IS NULL
     AND legacy_lesson.subject_code = calendar_row.code
     AND legacy_lesson.learn_number = calendar_row.learn_number
     AND legacy_lesson.status <> 0
    WHERE calendar_row.id IN (${Prisma.join(validIds)})
  `);
  return rows.map((row) => row.program_code).filter((code): code is string => Boolean(code));
};
const calendarCodeById = async (req: any) => calendarCodesByIds([req.params.id]);
const calendarCodesFromUpdates = async (updates: any[]) => {
  const ids = updates.map((item) => Number(item?.id)).filter((id) => Number.isInteger(id) && id > 0);
  const keys = updates.map((item) => String(item?.key || '').trim()).filter(Boolean);
  const rows = await prisma.calendar.findMany({
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
const calendarCreateCodes = async (items: any[]) => {
  const directCodes = items
    .map((item) => item?.program_code || item?.subject_code)
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  const lessonIds = items
    .map((item) => item?.session_id || item?.sessionId || item?.lesson_id)
    .filter((id) => id !== undefined && id !== null && String(id).trim() !== '');
  const parsedIds = lessonIds.flatMap((id) => {
    try { return [BigInt(String(id))]; } catch { return []; }
  });
  const lessons = parsedIds.length ? await prisma.lessons.findMany({
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

router.get(
  '/',
  authorize(['calendar.view']),
  authorizeCalendarList,
  livestreamController.getCalendar
);
router.get('/export', authorize(['calendar.export']), livestreamController.exportFile);
router.get('/template', authorize(['calendar.import']), livestreamController.importTemplate);
router.get('/programs', authorize(['calendar.view']), livestreamController.getPrograms);
router.get('/programs/:code/lessons', authorize(['calendar.view']), authorizeProgram('calendar.view', (req) => String(req.params.code)), livestreamController.getProgramLessons);
router.get(
  '/programs/:code/lessons/:lessonId/hmo-sections',
  authorize(['calendar.view']),
  authorizeProgram('calendar.view', (req) => String(req.params.code)),
  livestreamController.getProgramLessonHocmaiSections
);
router.post(
  '/import',
  authorize(['calendar.import']),
  upload.single('file'),
  livestreamController.importFile
);
router.post(
  '/import/update',
  authorize(['calendar.update']),
  upload.single('file'),
  livestreamController.updateImportFile
);
router.post(
  '/mapping/preview',
  authorize(['calendar.update']),
  authorizePrograms('calendar.update', (req) => calendarCodesFromUpdates(req.body?.updates || [])),
  livestreamController.previewMappingUpdates
);
router.put(
  '/mapping',
  authorize(['calendar.update']),
  authorizePrograms('calendar.update', (req) => calendarCodesFromUpdates(req.body?.updates || [])),
  livestreamController.updateMappings
);
router.post(
  '/mapping/import/preview',
  authorize(['calendar.update']),
  upload.single('file'),
  authorizeProgram('calendar.update', (req) => String(req.body?.program_code || '')),
  livestreamController.previewMappingImport
);
router.put(
  '/mapping/import',
  authorize(['calendar.update']),
  authorizeProgram('calendar.update', (req) => String(req.body?.program_code || '')),
  authorizePrograms('calendar.update', (req) => calendarCodesByIds(
    (req.body?.updates || []).map((item: any) => item?.id)
  )),
  livestreamController.importMappings
);
router.post(
  '/single',
  authorize(['calendar.create']),
  authorizePrograms('calendar.create', (req) => calendarCreateCodes([req.body || {}])),
  authorizeTeachingAssignment('calendar.teacher.manage'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(Object.keys(req.body || {}))),
  livestreamController.createSingle
);
router.post(
  '/bulk',
  authorize(['calendar.create']),
  authorizePrograms('calendar.create', (req) => calendarCreateCodes(req.body?.calendars || [])),
  authorizeTeachingAssignment('calendar.teacher.manage'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    (req.body?.calendars || []).flatMap((item: any) => Object.keys(item || {}))
  )),
  livestreamController.createBulk
);
router.post(
  '/auto-schedule/preview',
  authorize(['calendar.create']),
  authorizeProgram('calendar.create', (req) => String(req.body?.program_code || req.body?.code || '')),
  livestreamController.previewAutoSchedule
);
router.post(
  '/auto-schedule/commit',
  authorize(['calendar.create']),
  authorizeProgram('calendar.create', (req) => String(req.body?.program_code || req.body?.code || '')),
  authorizeTeachingAssignment('calendar.teacher.manage'),
  livestreamController.commitAutoSchedule
);

// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put(
  '/bulk',
  authorize(['calendar.update']),
  authorizePrograms('calendar.update', (req) => calendarCodesByIds(req.body?.ids || [])),
  authorizeTeachingAssignment('calendar.teacher.manage'),
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
  authorizePrograms('calendar.update', calendarCodeById),
  authorizeTeachingAssignment('calendar.teacher.manage'),
  authorizeFields('calendar', (req) => normalizeCalendarFields(
    Object.keys(req.body?.new_session || {})
  )),
  livestreamController.rescheduleSession
);
router.put(
  '/:id',
  authorize(['calendar.update']),
  authorizePrograms('calendar.update', async (req) => [
    ...await calendarCodeById(req),
    ...await calendarCreateCodes([req.body || {}]),
  ]),
  authorizeTeachingAssignment('calendar.teacher.manage'),
  authorizeFields('calendar', (req) => normalizeCalendarFields([
    ...Object.keys(req.body || {}),
    ...Object.keys(req.body?.new_session || {}),
  ])),
  livestreamController.updateSchedule
);
router.put(
  '/:id/cancel',
  authorize(['calendar.update']),
  authorizePrograms('calendar.update', calendarCodeById),
  authorizeFields('calendar', () => ['lesson_status']),
  livestreamController.cancelSession
);
router.delete(
  '/:id',
  authorize(['calendar.delete']),
  authorizePrograms('calendar.delete', calendarCodeById),
  livestreamController.deleteSession
);


export default router;
