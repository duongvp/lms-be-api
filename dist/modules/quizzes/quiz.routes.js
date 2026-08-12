"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const quiz_controller_1 = __importDefault(require("./quiz.controller"));
const quiz_validation_1 = require("./quiz.validation");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields, authorizeProgram, authorizePrograms } = auth_middleware_1.default;
const quizCodesByIds = async (quizIds) => ((await prisma_1.default.quiz_content.findMany({
    where: { quiz_id: { in: quizIds.map(String) } },
    select: { code: true },
})).map((item) => item.code));
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
router.use(authenticate);
router.get('/', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quiz_controller_1.default.list);
router.get('/options', authorize(['quiz.view']), quiz_controller_1.default.options);
router.get('/classes', authorize(['quiz.view']), quiz_controller_1.default.classes);
router.get('/lessons', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quiz_controller_1.default.lessons);
router.get('/index-suggestion', authorize(['quiz.view']), authorizeProgram('quiz.view', (req) => String(req.query.code || '')), quiz_controller_1.default.indexSuggestion);
router.get('/export', authorize(['quiz.export']), authorizeProgram('quiz.export', (req) => String(req.query.code || '')), quiz_controller_1.default.exportFile);
router.get('/template', authorize(['quiz.import']), authorizeProgram('quiz.import', (req) => String(req.query.code || '')), quiz_controller_1.default.template);
router.post('/import', authorize(['quiz.import']), upload.single('file'), authorizeProgram('quiz.import', (req) => String(req.body?.code || '')), quiz_controller_1.default.importFile);
router.patch('/bulk', authorize(['quiz.update']), authorizePrograms('quiz.update', (req) => quizCodesByIds(req.body?.quiz_ids || [])), authorizeFields('quiz', (req) => Object.keys(req.body?.data || {})), quiz_controller_1.default.bulkUpdate);
router.patch('/reorder', authorize(['quiz.update']), authorizeProgram('quiz.update', (req) => String(req.body?.code || '')), authorizeFields('quiz', () => ['quiz_index']), quiz_controller_1.default.reorder);
router.get('/:quizId/submissions', authorize(['quiz.grade']), authorizePrograms('quiz.grade', (req) => quizCodesByIds([req.params.quizId])), quiz_controller_1.default.submissions);
router.get('/:quizId/analytics', authorize(['quiz.grade']), authorizePrograms('quiz.grade', (req) => quizCodesByIds([req.params.quizId])), quiz_controller_1.default.analytics);
router.post('/:quizId/restore', authorize(['quiz.update']), authorizePrograms('quiz.update', (req) => quizCodesByIds([req.params.quizId])), authorizeFields('quiz', () => ['quiz_status']), quiz_controller_1.default.restore);
router.get('/:quizId', authorize(['quiz.view']), authorizePrograms('quiz.view', (req) => quizCodesByIds([req.params.quizId])), quiz_controller_1.default.detail);
router.post('/', authorize(['quiz.create']), authorizeProgram('quiz.create', (req) => String(req.body?.code || '')), authorizeFields('quiz', quiz_validation_1.getQuizEditableBodyFields), quiz_controller_1.default.create);
router.put('/:quizId', authorize(['quiz.update']), authorizePrograms('quiz.update', async (req) => [
    ...await quizCodesByIds([req.params.quizId]),
    ...(req.body?.code ? [String(req.body.code)] : []),
]), authorizeFields('quiz', quiz_validation_1.getQuizEditableBodyFields), quiz_controller_1.default.update);
router.delete('/:quizId', authorize(['quiz.delete']), authorizePrograms('quiz.delete', (req) => quizCodesByIds([req.params.quizId])), quiz_controller_1.default.remove);
exports.default = router;
