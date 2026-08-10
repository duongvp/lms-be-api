import { NextFunction, Request, Response } from 'express';
import { getDashboardOverview } from './dashboard.service';

export const overview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const data = await getDashboardOverview({ from, to });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
