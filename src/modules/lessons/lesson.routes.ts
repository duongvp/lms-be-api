import { Router } from 'express';
import multer from 'multer';
import lessonController from './lesson.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.get('/', lessonController.list);
router.patch('/bulk', lessonController.bulkUpdate);
router.patch('/reorder', lessonController.reorder);
router.get('/export', lessonController.exportFile);
router.get('/template', lessonController.template);
router.post('/import', upload.single('file'), lessonController.importFile);
router.get('/:id', lessonController.detail);
router.post('/', lessonController.create);
router.put('/:id', lessonController.update);
router.delete('/:id', lessonController.remove);

export default router;
