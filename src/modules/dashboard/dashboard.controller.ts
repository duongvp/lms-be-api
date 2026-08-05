import { NextFunction, Request, Response } from 'express';
import { getDashboardOverview } from './dashboard.service';

export const overview = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getDashboardOverview();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
