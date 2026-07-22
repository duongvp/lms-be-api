import { Request, Response, NextFunction } from 'express';
import * as livestreamService from './livestream.service';

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
    const result = await livestreamService.updateSchedule(Number(id), data, update_mode);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const cancelSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await livestreamService.cancelSession(Number(id));
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
export const getCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await livestreamService.getCalendar(req.query);
    res.status(200).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, message: err.message });
  }
};
