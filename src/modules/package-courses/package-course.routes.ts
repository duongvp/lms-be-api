import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import * as packageCourseController from './package-course.controller';

const router = Router();
router.use(authMiddleware.authenticate);
router.get(
  '/',
  authMiddleware.authorize(['calendar.view', 'calendar.create', 'lessons.view']),
  packageCourseController.list
);

export default router;
