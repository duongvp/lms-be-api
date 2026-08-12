import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import controller from './room-config.controller';

const router = Router();
const { authenticate, authorize, authorizeProgram, authorizeProgramForAny } = authMiddleware;

router.use(authenticate);

router.get('/', authorize(['room_config.view', 'calendar.view', 'lessons.view']), controller.list);
router.get('/:code/:learn_number', authorize(['room_config.view', 'calendar.view', 'lessons.view']), authorizeProgramForAny(['room_config.view', 'calendar.view', 'lessons.view'], (req) => String(req.params.code)), controller.detail);
router.post('/', authorize(['room_config.create', 'room_config.update']), authorizeProgramForAny(['room_config.create', 'room_config.update'], (req) => String(req.body?.code || '')), controller.save);
router.put('/:code/:learn_number', authorize(['room_config.update']), authorizeProgram('room_config.update', (req) => String(req.params.code)), controller.save);
router.post('/import', authorize(['room_config.import', 'room_config.create']), authorizeProgramForAny(['room_config.import', 'room_config.create'], (req) => String(req.body?.program_code || '')), controller.importBulk);

export default router;
