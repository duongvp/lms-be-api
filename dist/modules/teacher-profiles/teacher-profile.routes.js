"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const teacher_profile_controller_1 = __importDefault(require("./teacher-profile.controller"));
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields } = auth_middleware_1.default;
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
router.use(authenticate);
router.get('/', authorize(['teacher_profile.view']), teacher_profile_controller_1.default.list);
router.get('/export', authorize(['teacher_profile.export']), teacher_profile_controller_1.default.exportFile);
router.get('/template', authorize(['teacher_profile.import']), teacher_profile_controller_1.default.template);
router.post('/import', authorize(['teacher_profile.import']), upload.single('file'), teacher_profile_controller_1.default.importFile);
router.get('/:id', authorize(['teacher_profile.view']), teacher_profile_controller_1.default.detail);
router.post('/', authorize(['teacher_profile.create']), authorizeFields('teacher_profile', (req) => Object.keys(req.body || {})), teacher_profile_controller_1.default.create);
router.put('/:id', authorize(['teacher_profile.update']), authorizeFields('teacher_profile', (req) => Object.keys(req.body || {}).filter((field) => field !== 'username')), teacher_profile_controller_1.default.update);
router.patch('/:id/status', authorize(['teacher_profile.status']), authorizeFields('teacher_profile', () => ['status']), teacher_profile_controller_1.default.updateStatus);
router.delete('/:id', authorize(['teacher_profile.delete']), teacher_profile_controller_1.default.remove);
exports.default = router;
