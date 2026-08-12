import { Router } from 'express';
import multer from 'multer';
import authMiddleware from '../auth/auth.middleware';
import quizController from './quiz.controller';
import { getQuizEditableBodyFields } from './quiz.validation';
import prisma from '../../lib/prisma';

const router = Router();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = authMiddleware;
const quizCodesByIds = async (quizIds: unknown[]) => (
  (await prisma.quiz_content.findMany({
    where: { quiz_id: { in: quizIds.map(String) } },
    select: { code: true },
  })).map((item) => item.code)
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(authenticate);
router.get('/', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quizController.list);
router.get('/options', authorize(['quiz.view']), quizController.options);
router.get('/classes', authorize(['quiz.view']), quizController.classes);
router.get('/lessons', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quizController.lessons);
router.get('/index-suggestion', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quizController.indexSuggestion);
router.get('/export', authorize(['quiz.export']), authorizeProgram('quiz.export', (req) => String(req.query.code || '')), quizController.exportFile);
router.get('/template', authorize(['quiz.import']), authorizeProgram('quiz.import', (req) => String(req.query.code || '')), quizController.template);
router.post('/import', authorize(['quiz.import']), upload.single('file'), authorizeProgram('quiz.import', (req) => String(req.body?.code || '')), quizController.importFile);
router.patch(
  '/bulk',
  authorize(['quiz.update']),
  authorizePrograms('quiz.update', (req) => quizCodesByIds(req.body?.quiz_ids || [])),
  authorizeFields('quiz', (req) => Object.keys(req.body?.data || {})),
  quizController.bulkUpdate
);
router.patch(
  '/reorder',
  authorize(['quiz.update']),
  authorizeProgram('quiz.update', (req) => String(req.body?.code || '')),
  authorizeFields('quiz', () => ['quiz_index']),
  quizController.reorder
);
router.get('/:quizId/submissions', authorize(['quiz.grade']), authorizePrograms('quiz.grade', (req) => quizCodesByIds([req.params.quizId])), quizController.submissions);
router.get('/:quizId/analytics', authorize(['quiz.grade']), authorizePrograms('quiz.grade', (req) => quizCodesByIds([req.params.quizId])), quizController.analytics);
router.post(
  '/:quizId/restore',
  authorize(['quiz.update']),
  authorizePrograms('quiz.update', (req) => quizCodesByIds([req.params.quizId])),
  authorizeFields('quiz', () => ['quiz_status']),
  quizController.restore
);
router.get('/:quizId', authorize(['quiz.view']), authorizePrograms('quiz.view', (req) => quizCodesByIds([req.params.quizId])), quizController.detail);
router.post(
  '/',
  authorize(['quiz.create']),
  authorizeProgram('quiz.create', (req) => String(req.body?.code || '')),
  authorizeFields('quiz', getQuizEditableBodyFields),
  quizController.create
);
router.put(
  '/:quizId',
  authorize(['quiz.update']),
  authorizePrograms('quiz.update', async (req) => [
    ...await quizCodesByIds([req.params.quizId]),
    ...(req.body?.code ? [String(req.body.code)] : []),
  ]),
  authorizeFields('quiz', getQuizEditableBodyFields),
  quizController.update
);
router.delete('/:quizId', authorize(['quiz.delete']), authorizePrograms('quiz.delete', (req) => quizCodesByIds([req.params.quizId])), quizController.remove);

export default router;
