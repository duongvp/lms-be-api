import { Router } from 'express';
import * as livestreamController from './livestream.controller';

const router = Router();

router.get('/', livestreamController.getCalendar);
router.post('/single', livestreamController.createSingle);
router.post('/bulk', livestreamController.createBulk);

// Thêm dòng này (Bắt buộc phải đặt trước các route có param /:id)
router.put('/bulk', livestreamController.updateBulk);
router.put('/:id', livestreamController.updateSchedule);
router.put('/:id/cancel', livestreamController.cancelSession);


export default router;
