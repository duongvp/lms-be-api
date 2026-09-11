import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import { hmoLessonSyncIssues, overview, runHmoLessonSync } from './dashboard.controller';

const router = Router();

router.use(authMiddleware.authenticate);
router.get('/overview', authMiddleware.authorize(['dashboard_view']), overview);
router.get('/hmo-lesson-sync/issues', authMiddleware.authorize(['dashboard_view']), hmoLessonSyncIssues);
router.post('/hmo-lesson-sync/run', authMiddleware.authorize(['calendar.update']), runHmoLessonSync);

export default router;
