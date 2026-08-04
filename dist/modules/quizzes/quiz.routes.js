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
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields } = auth_middleware_1.default;
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
router.use(authenticate);
router.get('/', authorize(['quiz.view']), quiz_controller_1.default.list);
router.get('/options', authorize(['quiz.view']), quiz_controller_1.default.options);
router.get('/classes', authorize(['quiz.view']), quiz_controller_1.default.classes);
router.get('/lessons', authorize(['quiz.view']), quiz_controller_1.default.lessons);
router.get('/index-suggestion', authorize(['quiz.view']), quiz_controller_1.default.indexSuggestion);
router.get('/export', authorize(['quiz.export']), quiz_controller_1.default.exportFile);
router.get('/template', authorize(['quiz.import']), quiz_controller_1.default.template);
router.post('/import', authorize(['quiz.import']), upload.single('file'), quiz_controller_1.default.importFile);
router.patch('/bulk', authorize(['quiz.update']), authorizeFields('quiz', (req) => Object.keys(req.body?.data || {})), quiz_controller_1.default.bulkUpdate);
router.patch('/reorder', authorize(['quiz.update']), authorizeFields('quiz', () => ['quiz_index']), quiz_controller_1.default.reorder);
router.get('/:quizId/submissions', authorize(['quiz.grade']), quiz_controller_1.default.submissions);
router.get('/:quizId/analytics', authorize(['quiz.grade']), quiz_controller_1.default.analytics);
router.post('/:quizId/restore', authorize(['quiz.update']), authorizeFields('quiz', () => ['quiz_status']), quiz_controller_1.default.restore);
router.get('/:quizId', authorize(['quiz.view']), quiz_controller_1.default.detail);
router.post('/', authorize(['quiz.create']), authorizeFields('quiz', quiz_validation_1.getQuizEditableBodyFields), quiz_controller_1.default.create);
router.put('/:quizId', authorize(['quiz.update']), authorizeFields('quiz', quiz_validation_1.getQuizEditableBodyFields), quiz_controller_1.default.update);
router.delete('/:quizId', authorize(['quiz.delete']), quiz_controller_1.default.remove);
exports.default = router;
