import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import * as packageCourseController from './package-course.controller';

const router = Router();
router.use(authMiddleware.authenticate);
router.get(
  '/',
  authMiddleware.authorize(['calendar.view', 'calendar.create']),
  packageCourseController.list
);

export default router;
