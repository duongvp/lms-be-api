"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const room_config_controller_1 = __importDefault(require("./room-config.controller"));
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeProgram, authorizeProgramForAny } = auth_middleware_1.default;
router.use(authenticate);
router.get('/', authorize(['room_config.view', 'calendar.view', 'lessons.view']), room_config_controller_1.default.list);
router.get('/:code/:learn_number', authorize(['room_config.view', 'calendar.view', 'lessons.view']), authorizeProgramForAny(['room_config.view', 'calendar.view', 'lessons.view'], (req) => String(req.params.code)), room_config_controller_1.default.detail);
router.post('/', authorize(['room_config.create', 'room_config.update']), authorizeProgramForAny(['room_config.create', 'room_config.update'], (req) => String(req.body?.code || '')), room_config_controller_1.default.save);
router.put('/:code/:learn_number', authorize(['room_config.update']), authorizeProgram('room_config.update', (req) => String(req.params.code)), room_config_controller_1.default.save);
router.post('/import', authorize(['room_config.import', 'room_config.create']), authorizeProgramForAny(['room_config.import', 'room_config.create'], (req) => String(req.body?.program_code || '')), room_config_controller_1.default.importBulk);
exports.default = router;
