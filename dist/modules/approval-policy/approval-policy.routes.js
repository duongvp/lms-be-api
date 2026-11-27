"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvalPolicyRoutes = void 0;
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const calendar_approval_access_1 = require("../calendar-approvals/calendar-approval.access");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const calendar_approval_types_1 = require("../calendar-approvals/calendar-approval.types");
const approval_policy_registry_1 = require("./approval-policy.registry");
exports.approvalPolicyRoutes = (0, express_1.Router)();
exports.approvalPolicyRoutes.use(auth_middleware_1.default.authenticate);
exports.approvalPolicyRoutes.get('/modules', (_req, res) => res.json({ success: true, data: approval_policy_registry_1.APPROVAL_MODULES }));
const handle = (fn) => (req, res, next) => { void Promise.resolve(fn(req, res)).catch(next); };
const configurationActor = async (req) => {
    const actor = await (0, calendar_approval_access_1.freshUser)(req.user.userId);
    if (!approval_policy_registry_1.APPROVAL_MODULES.some(module => (0, calendar_approval_access_1.hasPermission)(actor, module.managePermission)))
        throw new ApiError_1.default('Không có quyền cấu hình phê duyệt', 403);
    return actor;
};
exports.approvalPolicyRoutes.get('/accounts/:id', handle(async (req, res) => {
    await configurationActor(req);
    return res.json({ success: true, data: await (0, calendar_approval_access_1.getAccountConfiguration)((0, calendar_approval_types_1.positiveId)(req.params.id)) });
}));
exports.approvalPolicyRoutes.put('/accounts/:id', handle(async (req, res) => res.json({ success: true, data: await (0, calendar_approval_access_1.saveAccountPolicy)(await configurationActor(req), (0, calendar_approval_types_1.positiveId)(req.params.id), req.body) })));
