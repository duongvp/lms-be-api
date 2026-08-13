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
import { importCalendarFromSheet } from './calendar-import.service';
import { getProgramScopeFilter } from '../../services/authorization.service';

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

export const importFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn file import' });
      return;
    }
    const rows = parseCalendarImportFile(req.file.buffer, req.file.originalname);
    const { importRows, errors } = validateCalendarImportRows(rows);
    const programCode = String(req.body?.program_code || '').trim();
    if (!programCode) {
      res.status(400).json({ success: false, message: 'Vui lòng chọn Chương trình trước khi import' });
      return;
    }
    await livestreamService.assertSchedulingProgramExists(programCode);
    importRows.forEach((row) => {
      if (String(row.calendar.code) !== programCode) {
        errors.push({
          row: row.row,
          field: 'Mã buổi học',
          errorCode: 'INVALID_ROW',
          message: `Dòng import không thuộc Chương trình ${programCode}`,
        });
      }
    });
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
