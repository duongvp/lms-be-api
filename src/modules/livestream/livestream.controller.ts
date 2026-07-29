import { Request, Response, NextFunction } from 'express';
import * as livestreamService from './livestream.service';
import FieldPermissionService from '../roles/field-permission.service';

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
