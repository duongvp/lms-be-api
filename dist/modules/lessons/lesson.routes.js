"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const lesson_controller_1 = __importDefault(require("./lesson.controller"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields } = auth_middleware_1.default;
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});
router.use(authenticate);
router.get('/', authorize(['lessons.view']), lesson_controller_1.default.list);
router.get('/options/subjects', authorize(['lessons.view']), lesson_controller_1.default.subjects);
router.get('/options/programs', authorize(['lessons.view']), lesson_controller_1.default.programs);
router.patch('/bulk', authorize(['lessons.update']), authorizeFields('lessons', (req) => Object.keys(req.body?.data || {})), lesson_controller_1.default.bulkUpdate);
router.patch('/reorder', authorize(['lessons.update']), authorizeFields('lessons', () => ['learn_number']), lesson_controller_1.default.reorder);
router.get('/export', authorize(['lessons.export']), lesson_controller_1.default.exportFile);
router.get('/template', authorize(['lessons.import']), lesson_controller_1.default.template);
router.post('/import', authorize(['lessons.import']), upload.single('file'), lesson_controller_1.default.importFile);
router.get('/:id', authorize(['lessons.view']), lesson_controller_1.default.detail);
router.post('/', authorize(['lessons.create']), authorizeFields('lessons', (req) => Object.keys(req.body || {})), lesson_controller_1.default.create);
router.put('/:id', authorize(['lessons.update']), authorizeFields('lessons', (req) => Object.keys(req.body || {})), lesson_controller_1.default.update);
router.delete('/:id', authorize(['lessons.delete']), lesson_controller_1.default.remove);
exports.default = router;
