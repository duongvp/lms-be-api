import { Router, type Request, type RequestHandler } from 'express';
import * as XLSX from 'xlsx-js-style';
import authMiddleware from '../auth/auth.middleware';
import { isProgramAllowed } from '../../services/authorization.service';
import ApiError from '../../utils/ApiError';
import FieldPermissionService from '../roles/field-permission.service';
import prisma from '../../lib/prisma';
import { loadEvgRecordingTimes } from '../../integrations/evg-recordings.service';
import { calendarDetailReportService as service, type DetailCapabilities, type DetailEvent } from './calendar-detail-report.service';
import { detailId, parseDetailFilters } from './calendar-detail-report.validation';
import { buildDetailWorkbook, buildRestrictionWorkbook } from './calendar-detail-report.io';

export const DETAIL_PERMISSIONS = {
  view: 'calendar.report.detail.view', chat: 'calendar.report.chat.view', moderation: 'calendar.report.moderation.view', export: 'calendar.report.detail.export',
};
/** Scope resolution is shared with the existing calendar routes (linked lesson subject_code). */
export const createCalendarDetailReportRouter = (resolveCodes: (req: Request) => Promise<string[]>) => {
  const router = Router({ mergeParams: true });
  const guard = (permission: string): RequestHandler[] => [authMiddleware.authorize([permission]), authMiddleware.authorizePrograms(permission, resolveCodes)];
  router.use((req, _res, next) => { try { detailId(req.params.calendarId, 'ID lịch'); next(); } catch (e) { next(e); } });
  router.use(...guard('calendar.view'), ...guard(DETAIL_PERMISSIONS.view));
  router.use(async (req, _res, next) => {
    try {
      if (!req.user?.permissions?.includes('*') && !req.user?.roles?.includes('admin')) {
        const fields = { username: true, student_hmid: true, name: true, room_id: true };
        const calendarFields = { code: true, learn_number: true, lesson_name: true, teacher: true, assistant_teacher: true, start_time: true, end_time: true };
        const [students, calendars] = await Promise.all([
          FieldPermissionService.filterVisibleRecords(req.user?.roleIds || [], 'users', [fields]),
          FieldPermissionService.filterVisibleRecords(req.user?.roleIds || [], 'calendar', [calendarFields]),
        ]);
        if (Object.keys(students[0]).length !== Object.keys(fields).length || Object.keys(calendars[0]).length !== Object.keys(calendarFields).length)
          throw new ApiError('Chính sách trường dữ liệu chưa cho phép xem thông tin cần thiết của báo cáo chi tiết', 403);
      }
      next();
    } catch (e) { next(e); }
  });
  // Cache only the scope resolution on this request; all permissions are checked independently.
  const capabilities = async (req: Request): Promise<DetailCapabilities> => {
    const codes = await resolveCodes(req);
    return { chat: codes.every(c => isProgramAllowed(req.user, DETAIL_PERMISSIONS.chat, c)),
      moderation: codes.every(c => isProgramAllowed(req.user, DETAIL_PERMISSIONS.moderation, c)),
      activities: codes.every(c => isProgramAllowed(req.user, 'quiz.view', c)) };
  };
  const handle = (run: (req: Request) => Promise<unknown>): RequestHandler => async (req, res, next) => {
    try { res.json({ success: true, data: await run(req) }); } catch (e) { next(e); }
  };
  const ids = (req: Request) => ({ calendarId: detailId(req.params.calendarId), studentId: req.params.studentId == null ? undefined : detailId(req.params.studentId, 'ID học sinh') });
  router.get('/live-times', handle(async req => {
    const calendar = await prisma.calendar.findUnique({ where: { id: ids(req).calendarId } });
    if (!calendar) throw new ApiError('Không tìm thấy lịch học', 404);
    return (await loadEvgRecordingTimes([calendar])).get(calendar.id);
  }));
  router.get('/students', handle(async req => service.students(ids(req).calendarId, parseDetailFilters(req.query), await capabilities(req))));
  router.get('/overview', handle(async req => {
    const { rows: _rows, ...data } = await service.students(ids(req).calendarId, parseDetailFilters({ ...req.query, limit: 1 }), await capabilities(req)); return data;
  }));
  router.get('/students/:studentId', handle(async req => service.student(ids(req).calendarId, ids(req).studentId!, parseDetailFilters(req.query), await capabilities(req))));
  for (const path of ['/timeline', '/students/:studentId/events']) router.get(path, handle(async req => service.events(ids(req).calendarId, ids(req).studentId, parseDetailFilters(req.query), await capabilities(req))));
  const exportHandler: RequestHandler = async (req, res, next) => {
    try {
      const { calendarId, studentId } = ids(req), filters = parseDetailFilters(req.query), caps = await capabilities(req);
      const kind = studentId == null ? 'students' : 'events';
      let rows;
      if (kind === 'students') rows = (await service.students(calendarId, filters, caps, true)).rows;
      else {
        // Explicit source is required so a denied sensitive source cannot be silently omitted from an export.
        if (filters.source === 'all') throw new ApiError('Chọn nguồn nhật ký cụ thể để xuất Excel', 400);
        const result: DetailEvent[] = [];
        let cursor: string | undefined;
        do {
          const page = await service.events(calendarId, studentId, { ...filters, cursor, limit: 100 }, caps);
          if (filters.source === 'moderation' && page.hidden_rules_available === false) throw new ApiError('Nguồn ẩn/khôi phục chat chưa có; không thể xuất lịch sử đầy đủ', 422);
          result.push(...page.rows);
          if (result.length > 20000) throw new ApiError('Excel vượt 20.000 bản ghi; hãy thu hẹp khoảng thời gian', 422);
          cursor = page.next_cursor ?? undefined;
        } while (cursor);
        rows = result;
      }
      const workbook = buildDetailWorkbook(kind, rows, `calendar_id=${calendarId}; student_id=${studentId ?? 'all'}; filters=${JSON.stringify(req.query)}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="chi-tiet-buoi-${calendarId}.xlsx"`);
      res.send(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    } catch (e) { next(e); }
  };
  router.get('/students/:studentId/export-restrictions', ...guard('calendar.export'), ...guard(DETAIL_PERMISSIONS.export), ...guard(DETAIL_PERMISSIONS.moderation), async (req, res, next) => {
    try {
      const { calendarId, studentId } = ids(req);
      const data = await service.student(calendarId, studentId!, parseDetailFilters(req.query), await capabilities(req));
      const wb = buildRestrictionWorkbook(data.restriction_records as Parameters<typeof buildRestrictionWorkbook>[0], `calendar_id=${calendarId}; enrollment_id=${studentId}; cùng code+bài, mọi ngày`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="han-che-hien-luu-${studentId}.xlsx"`);
      res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    } catch (e) { next(e); }
  });
  for (const path of ['/export/students', '/students/:studentId/export']) router.get(path, ...guard('calendar.export'), ...guard(DETAIL_PERMISSIONS.export), exportHandler);
  return router;
};
