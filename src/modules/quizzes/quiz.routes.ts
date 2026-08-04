import { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../auth/auth.middleware';
import quizController from './quiz.controller';
import { getQuizEditableBodyFields } from './quiz.validation';

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate);
router.get('/', authorize(['quiz.view']), quizController.list);
router.get('/options', authorize(['quiz.view']), quizController.options);
router.get('/classes', authorize(['quiz.view']), quizController.classes);
router.get('/lessons', authorize(['quiz.view']), quizController.lessons);
router.get('/index-suggestion', authorize(['quiz.view']), quizController.indexSuggestion);
router.get('/export', authorize(['quiz.export']), quizController.exportFile);
router.get('/template', authorize(['quiz.import']), quizController.template);
router.post('/import', authorize(['quiz.import']), upload.single('file'), quizController.importFile);
router.patch(
  '/bulk',
  authorize(['quiz.update']),
  authorizeFields('quiz', (req) => Object.keys(req.body?.data || {})),
  quizController.bulkUpdate
);
router.patch(
  '/reorder',
  authorize(['quiz.update']),
  authorizeFields('quiz', () => ['quiz_index']),
  quizController.reorder
);
router.get('/:quizId/submissions', authorize(['quiz.grade']), quizController.submissions);
router.get('/:quizId/analytics', authorize(['quiz.grade']), quizController.analytics);
router.post(
  '/:quizId/restore',
  authorize(['quiz.update']),
  authorizeFields('quiz', () => ['quiz_status']),
  quizController.restore
);
router.get('/:quizId', authorize(['quiz.view']), quizController.detail);
router.post(
  '/',
  authorize(['quiz.create']),
  authorizeFields('quiz', getQuizEditableBodyFields),
  quizController.create
);
router.put(
  '/:quizId',
  authorize(['quiz.update']),
  authorizeFields('quiz', getQuizEditableBodyFields),
  quizController.update
);
router.delete('/:quizId', authorize(['quiz.delete']), quizController.remove);

export default router;
