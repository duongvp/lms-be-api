import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import * as controller from './program-teacher-banner.controller';
import multer from 'multer';

const router = Router();
router.use(authMiddleware.authenticate);
router.get('/', authMiddleware.authorize(['program_teacher_banner.view']), controller.list);
router.get('/options', authMiddleware.authorize(['program_teacher_banner.view']), controller.options);
router.get('/export', authMiddleware.authorize(['program_teacher_banner.import']), controller.exportFile);
router.get('/template', authMiddleware.authorize(['program_teacher_banner.import']), controller.template);
router.post('/import', authMiddleware.authorize(['program_teacher_banner.import']), multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file'), controller.importFile);
router.get('/:id', authMiddleware.authorize(['program_teacher_banner.view']), controller.detail);
router.post('/', authMiddleware.authorize(['program_teacher_banner.create']), controller.create);
router.put('/:id', authMiddleware.authorize(['program_teacher_banner.update']), controller.update);
router.delete('/:id', authMiddleware.authorize(['program_teacher_banner.delete']), controller.remove);
export default router;
