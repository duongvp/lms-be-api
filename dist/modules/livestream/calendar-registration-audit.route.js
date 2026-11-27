"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const authorization_service_1 = require("../../services/authorization.service");
const calendar_registration_audit_service_1 = require("./calendar-registration-audit.service");
const router = (0, express_1.Router)();
// Mounted under the authenticated calendar router. Check the same update
// permission as student sync, then independently enforce raw program scopes.
router.use(auth_middleware_1.default.authorize(['calendar.update']));
router.post('/', async (req, res, next) => {
    try {
        const data = await (0, calendar_registration_audit_service_1.startRegistrationAudit)(req.body?.ids, req.body?.registered_at, Number(req.user?.userId), (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.update'));
        res.status(202).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
});
router.get('/:jobId', (req, res, next) => {
    try {
        const data = (0, calendar_registration_audit_service_1.getRegistrationAudit)(String(req.params.jobId), Number(req.user?.userId), (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.update'), req.query.page ?? 1, req.query.limit ?? 50);
        res.json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:jobId/apply', (req, res, next) => {
    try {
        const data = (0, calendar_registration_audit_service_1.applyRegistrationAudit)(String(req.params.jobId), Number(req.user?.userId), (0, authorization_service_1.getProgramScopeFilter)(req.user, 'calendar.update'));
        res.status(202).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
