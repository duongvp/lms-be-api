import { Router } from 'express';
import moduleController from './module.controller';

const router = Router();

router.get('/', moduleController.getModules);
router.get('/:code/fields', moduleController.getModuleFields);

export default router;
