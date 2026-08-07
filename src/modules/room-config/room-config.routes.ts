import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import controller from './room-config.controller';

const router = Router();
const { authenticate, authorize } = authMiddleware;

router.use(authenticate);

router.get('/', authorize(['room_config.view', 'calendar.view', 'lessons.view']), controller.list);
router.get('/:code/:learn_number', authorize(['room_config.view', 'calendar.view', 'lessons.view']), controller.detail);
router.post('/', authorize(['room_config.create', 'room_config.update']), controller.save);
router.put('/:code/:learn_number', authorize(['room_config.update']), controller.save);
router.post('/import', authorize(['room_config.import', 'room_config.create']), controller.importBulk);

export default router;
