import { Request, Response, NextFunction } from 'express';
import * as livestreamService from './livestream.service';
import FieldPermissionService from '../roles/field-permission.service';
import {
  buildCalendarFile,
  buildCalendarTemplate,
  getCalendarFileContentType,
  parseCalendarImportFile,
  validateCalendarImportRows,
} from './livestream.io';

const getChangeActor = (req: Request): livestreamService.CalendarChangeActor => ({
  userId: Number(req.user?.userId),
  username: String(req.user?.username || ''),
});

export const createSingle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    console.log(req.body);
    const result = await livestreamService.createSingle(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const createBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.createBulk(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// Hàm mới: Cập nhật nhiều lịch học cùng lúc (Bulk Update)
export const updateBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.updateBulk(req.body);
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
    const result = await livestreamService.deleteSession(Number(id));
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.getCalendar(req.query);
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
        can_modify: livestreamService.isSessionModifiable(source, now),
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
    const rows = await livestreamService.getCalendarRowsForExport(req.query.ids);
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
    const { calendars, errors } = validateCalendarImportRows(rows);
    if (errors.length) {
      res.status(400).json({
        success: false,
        message: 'File import có dữ liệu không hợp lệ',
        errors,
      });
      return;
    }
    const result = await livestreamService.createBulk({ calendars });
    res.status(201).json({
      success: true,
      message: 'Import lịch học thành công',
      data: result,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
