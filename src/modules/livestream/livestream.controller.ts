import { Request, Response, NextFunction } from 'express';
import * as livestreamService from './livestream.service';
import FieldPermissionService from '../roles/field-permission.service';
import {
  buildCalendarFile,
  buildCalendarTemplate,
  getCalendarFileContentType,
  parseCalendarMappingImportFile,
  parseCalendarImportFile,
  validateCalendarImportRows,
} from './livestream.io';
import { previewAutoSchedule as buildAutoSchedulePreview } from './auto-schedule.service';
import {
  importCalendarFromSheet,
  updateCalendarsFromSheet,
} from './calendar-import.service';
import { assertProgramAccess, getProgramScopeFilter } from '../../services/authorization.service';

const getChangeActor = (req: Request): livestreamService.CalendarChangeActor => ({
  userId: Number(req.user?.userId),
  username: String(req.user?.username || ''),
});

export const createSingle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    console.log(req.body);
    const result = await livestreamService.createSingle(req.body, getChangeActor(req));
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const createBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.createBulk(req.body, getChangeActor(req));
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const previewAutoSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: buildAutoSchedulePreview(req.body) });
  } catch (error) {
    next(error);
  }
};

export const getProgramLessons = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await livestreamService.getProgramLessonsForScheduling(String(req.params.code || ''));
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getPrograms = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      data: await livestreamService.getSchedulingPrograms(
        getProgramScopeFilter(req.user, 'calendar.view')
      ),
    });
  } catch (error) {
    next(error);
  }
};

export const getProgramLessonHocmaiSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await livestreamService.getHocmaiSectionsForProgramLesson(
      String(req.params.code || ''),
      String(req.params.lessonId || '')
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const commitAutoSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const preview = buildAutoSchedulePreview(req.body);
    const calendars = preview.calendars.map(({ auto_schedule, ...calendar }) => calendar);
    const data = await livestreamService.createBulk({ calendars }, getChangeActor(req));
    res.status(201).json({ success: true, data: { ...preview, calendars: data } });
  } catch (error) {
    next(error);
  }
};

// Hàm mới: Cập nhật nhiều lịch học cùng lúc (Bulk Update)
export const updateBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = ['cancel', 'makeup'].includes(String(req.body?.operation || ''))
      ? await livestreamService.bulkRescheduleSessions(req.body, getChangeActor(req))
      : await livestreamService.updateBulk(req.body, getChangeActor(req));
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const backfillMissingTeachingUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;
    const result = await livestreamService.backfillMissingCalendarTeachingUsers(ids);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { update_mode, ...data } = req.body;
    const result = await livestreamService.updateSchedule(
      Number(id),
      data,
      update_mode,
      getChangeActor(req)
    );
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const rescheduleSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await livestreamService.rescheduleSession(
      Number(id),
      req.body,
      getChangeActor(req)
    );
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const cancelSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await livestreamService.cancelSession(
      Number(id),
      req.body,
      getChangeActor(req)
    );
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await livestreamService.deleteSession(Number(id), getChangeActor(req));
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.getCalendar(
      req.query,
      getProgramScopeFilter(req.user, 'calendar.view'),
      Boolean(req.user?.permissions?.includes('*') || req.user?.roles?.includes('admin'))
    );
    const data = await FieldPermissionService.filterVisibleRecords(
      req.user?.roleIds || [],
      'calendar',
      result.data as any[]
    );
    const now = new Date();
    const dataWithSystemMetadata = data.map((record, index) => {
      const source = result.data[index] as any;
      return {
        ...record,
        // id/can_modify là metadata phục vụ thao tác, không phải cột dữ liệu.
        id: source.id,
        session_id: source.session_id == null ? null : String(source.session_id),
        can_modify: livestreamService.isSessionModifiable(source, now),
        package_lesson_mappings: source.package_lesson_mappings || [],
      };
    });
    res.status(200).json({
      success: true,
      data: { ...result, data: dataWithSystemMetadata },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const exportFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const rows = await livestreamService.getCalendarRowsForExport(
      req.query.ids,
      getProgramScopeFilter(req.user, 'calendar.export')
    );
    const buffer = buildCalendarFile(rows, format);
    res.setHeader('Content-Type', getCalendarFileContentType(format));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="calendar-export-${Date.now()}.${format}"`
    );
    res.send(buffer);
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const importTemplate = async (req: Request, res: Response): Promise<void> => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  res.setHeader('Content-Type', getCalendarFileContentType(format));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="calendar-import-template.${format}"`
  );
  res.send(buildCalendarTemplate(format));
};

const getGoogleSheetCsv = async (sheetUrl: string) => {
  let parsed: URL;
  try { parsed = new URL(sheetUrl); } catch { throw new Error('Link Google Sheets không hợp lệ'); }
  if (parsed.hostname !== 'docs.google.com') throw new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
  const match = parsed.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Link Google Sheets không hợp lệ');
  const gid = parsed.searchParams.get('gid') || '0';
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) throw new Error('Không thể đọc Google Sheets. Hãy kiểm tra quyền chia sẻ công khai.');
  return Buffer.from(await response.arrayBuffer());
};

export const importFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const sheetUrl = String(req.body?.sheet_url || '').trim();
    if (!req.file && !sheetUrl) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn file hoặc dán link Google Sheets' });
      return;
    }
    const buffer = req.file?.buffer ?? await getGoogleSheetCsv(sheetUrl);
    const originalName = req.file?.originalname ?? 'google-sheet.csv';
    const rows = parseCalendarImportFile(buffer, originalName);
    const { importRows, errors } = validateCalendarImportRows(rows);
    const programCode = String(req.body?.program_code || '').trim();
    const isAdmin = Boolean(
      req.user?.permissions?.includes('*')
      || req.user?.roles?.some((role: any) => (
        String(role?.code || role?.name || role).toLowerCase() === 'admin'
      ))
    );
    if (!isAdmin && !programCode) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng lọc đúng Chương trình trước khi import lịch học',
      });
      return;
    }
    if (!isAdmin) {
      importRows.forEach((row) => {
        if (row.calendar.code !== programCode) errors.push({
          row: row.row,
          field: 'code',
          errorCode: 'INVALID_ROW',
          message: `Dòng này thuộc Chương trình ${row.calendar.code}; chỉ được import ${programCode}`,
        });
      });
      assertProgramAccess(req.user, 'calendar.import', programCode);
    } else {
      Array.from(new Set(importRows.map((row) => row.calendar.code)))
        .forEach((code) => assertProgramAccess(req.user, 'calendar.import', code));
    }
    if (errors.length) {
      const invalidRows = new Set(errors.map((error) => error.row)).size;
      res.status(400).json({
        success: false,
        status: 'validation_error',
        message: 'File import có dữ liệu không hợp lệ',
        summary: {
          totalRows: rows.length,
          validRows: Math.max(0, rows.length - invalidRows),
          invalidRows,
        },
        errors,
      });
      return;
    }

    const result = await importCalendarFromSheet(importRows, getChangeActor(req));
    if (result.status === 'validation_error') {
      res.status(400).json({
        success: false,
        status: result.status,
        message: 'File import có dữ liệu không hợp lệ',
        summary: result.summary,
        errors: result.errors,
      });
      return;
    }

    res.status(201).json({
      success: true,
      status: result.status,
      message: 'Import lịch học thành công',
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateImportFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const sheetUrl = String(req.body?.sheet_url || '').trim();
    if (!req.file && !sheetUrl) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn file hoặc dán link Google Sheets' });
      return;
    }
    const buffer = req.file?.buffer ?? await getGoogleSheetCsv(sheetUrl);
    const originalName = req.file?.originalname ?? 'google-sheet.csv';
    const rows = parseCalendarImportFile(buffer, originalName);
    const { importRows, errors } = validateCalendarImportRows(rows);
    const programCode = String(req.body?.program_code || '').trim();
    const isAdmin = Boolean(
      req.user?.permissions?.includes('*')
      || req.user?.roles?.some((role: any) => (
        String(role?.code || role?.name || role).toLowerCase() === 'admin'
      ))
    );

    if (!isAdmin && !programCode) {
      res.status(400).json({
        success: false,
        message: 'Vui lòng lọc đúng Chương trình trước khi cập nhật lịch học',
      });
      return;
    }
    if (!isAdmin) {
      importRows.forEach((row) => {
        if (row.calendar.code !== programCode) errors.push({
          row: row.row,
          field: 'code',
          errorCode: 'INVALID_ROW',
          message: `Dòng này thuộc Chương trình ${row.calendar.code}; chỉ được cập nhật ${programCode}`,
        });
      });
      assertProgramAccess(req.user, 'calendar.update', programCode);
    } else {
      Array.from(new Set(importRows.map((row) => row.calendar.code)))
        .forEach((code) => assertProgramAccess(req.user, 'calendar.update', code));
    }

    if (errors.length) {
      const invalidRows = new Set(errors.map((error) => error.row)).size;
      res.status(400).json({
        success: false,
        status: 'validation_error',
        message: 'File cập nhật có dữ liệu không hợp lệ',
        summary: {
          totalRows: rows.length,
          validRows: Math.max(0, rows.length - invalidRows),
          invalidRows,
        },
        errors,
      });
      return;
    }

    const result = await updateCalendarsFromSheet(importRows, getChangeActor(req));
    if (result.status === 'validation_error') {
      res.status(400).json({
        success: false,
        status: result.status,
        message: 'File cập nhật có dữ liệu không hợp lệ',
        summary: result.summary,
        errors: result.errors,
      });
      return;
    }

    res.status(200).json({
      success: true,
      status: result.status,
      message: 'Cập nhật lịch học thành công',
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const previewMappingUpdates = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await livestreamService.previewCalendarMappingUpdates(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await livestreamService.updateCalendarMappings(
      req.body,
      getChangeActor(req)
    );
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const previewMappingImport = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn file import' });
      return;
    }
    const programCode = String(req.body?.program_code || '').trim();
    if (!programCode) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn Chương trình trước khi import' });
      return;
    }
    await livestreamService.assertSchedulingProgramExists(programCode);
    const updates = parseCalendarMappingImportFile(req.file.buffer, req.file.originalname);
    const result = await livestreamService.previewCalendarMappingUpdates({ updates });
    await livestreamService.assertCalendarIdsInProgram(
      result.updates.map((item: any) => Number(item.id)),
      programCode
    );
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const importMappings = async (req: Request, res: Response): Promise<void> => {
  try {
    const programCode = String(req.body?.program_code || '').trim();
    if (!programCode) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn Chương trình trước khi import' });
      return;
    }
    await livestreamService.assertSchedulingProgramExists(programCode);
    const preview = await livestreamService.previewCalendarMappingUpdates(req.body);
    await livestreamService.assertCalendarIdsInProgram(
      preview.updates.map((item: any) => Number(item.id)),
      programCode
    );
    const result = await livestreamService.updateCalendarMappings(req.body, getChangeActor(req));
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
