import { Router } from 'express';
import authMiddleware from '../auth/auth.middleware';
import controller from './room-config.controller';

const router = Router();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizeProgramForAny } = authMiddleware;

router.use(authenticate);

router.get('/', authorize(['room_config.view']), controller.list);
router.get('/:code/:learn_number', authorize(['room_config.view']), authorizeProgram('room_config.view', (req) => String(req.params.code)), controller.detail);
router.post('/', authorize(['room_config.create', 'room_config.update']), authorizeProgramForAny(['room_config.create', 'room_config.update'], (req) => String(req.body?.code || '')), authorizeFields('room_config', (req) => Object.keys(req.body || {})), controller.save);
router.put('/:code/:learn_number', authorize(['room_config.update']), authorizeProgram('room_config.update', (req) => String(req.params.code)), authorizeFields('room_config', (req) => Object.keys(req.body || {})), controller.save);
router.post('/import', authorize(['room_config.import', 'room_config.create']), authorizeProgramForAny(['room_config.import', 'room_config.create'], (req) => String(req.body?.program_code || '')), authorizeFields('room_config', () => ['code', 'learn_number', 'config']), controller.importBulk);

export default router;
