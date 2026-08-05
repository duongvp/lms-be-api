"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const dashboard_controller_1 = require("./dashboard.controller");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.default.authenticate);
router.get('/overview', auth_middleware_1.default.authorize(['dashboard_view']), dashboard_controller_1.overview);
exports.default = router;
