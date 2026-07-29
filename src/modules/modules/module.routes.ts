import { Router } from 'express';
import moduleController from './module.controller';
import authMiddleware from '../auth/auth.middleware';

const router = Router();
router.use(authMiddleware.authenticate);

router.get('/', moduleController.getModules);
router.get('/:code/fields', moduleController.getModuleFields);

export default router;
