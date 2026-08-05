import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import { overview } from './dashboard.controller';

const router = Router();

router.use(authMiddleware.authenticate);
router.get('/overview', authMiddleware.authorize(['dashboard_view']), overview);

export default router;
