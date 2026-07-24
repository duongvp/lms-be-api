"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const lesson_controller_1 = __importDefault(require("./lesson.controller"));
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
});
router.get('/', lesson_controller_1.default.list);
router.patch('/bulk', lesson_controller_1.default.bulkUpdate);
router.patch('/reorder', lesson_controller_1.default.reorder);
router.get('/export', lesson_controller_1.default.exportFile);
router.get('/template', lesson_controller_1.default.template);
router.post('/import', upload.single('file'), lesson_controller_1.default.importFile);
router.get('/:id', lesson_controller_1.default.detail);
router.post('/', lesson_controller_1.default.create);
router.put('/:id', lesson_controller_1.default.update);
router.delete('/:id', lesson_controller_1.default.remove);
exports.default = router;
