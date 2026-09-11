import { NextFunction, Request, Response } from 'express';
import { getDashboardOverview, getLatestHmoLessonSyncIssues } from './dashboard.service';
import { getProgramScopeFilter } from '../../services/authorization.service';
import { startHmoLessonSync } from '../hmo-lesson-sync/hmo-lesson-sync.service';

export const overview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const data = await getDashboardOverview(
      { from, to },
      getProgramScopeFilter(req.user, 'dashboard_view')
    );
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const runHmoLessonSync = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await startHmoLessonSync('manual', String(req.user?.username || ''));
    res.status(result.started ? 202 : 409).json({ success: result.started, data: result, message: result.message });
  } catch (error) { next(error); }
};

export const hmoLessonSyncIssues = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLatestHmoLessonSyncIssues(
      String(req.query.program_code || '').trim() || undefined,
      String(req.query.error_code || '').trim() || undefined,
      getProgramScopeFilter(req.user, 'dashboard_view')
    );
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
};
