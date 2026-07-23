"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const module_controller_1 = __importDefault(require("./module.controller"));
const router = (0, express_1.Router)();
router.get('/', module_controller_1.default.getModules);
router.get('/:code/fields', module_controller_1.default.getModuleFields);
exports.default = router;
