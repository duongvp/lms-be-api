"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hmoLessonSyncIssues = exports.runHmoLessonSync = exports.overview = void 0;
const dashboard_service_1 = require("./dashboard.service");
const authorization_service_1 = require("../../services/authorization.service");
const hmo_lesson_sync_service_1 = require("../hmo-lesson-sync/hmo-lesson-sync.service");
const overview = async (req, res, next) => {
    try {
        const from = req.query.from ? new Date(String(req.query.from)) : undefined;
        const to = req.query.to ? new Date(String(req.query.to)) : undefined;
        const data = await (0, dashboard_service_1.getDashboardOverview)({ from, to }, (0, authorization_service_1.getProgramScopeFilter)(req.user, 'dashboard_view'));
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.overview = overview;
const runHmoLessonSync = async (req, res, next) => {
    try {
        const result = await (0, hmo_lesson_sync_service_1.startHmoLessonSync)('manual', String(req.user?.username || ''));
        res.status(result.started ? 202 : 409).json({ success: result.started, data: result, message: result.message });
    }
    catch (error) {
        next(error);
    }
};
exports.runHmoLessonSync = runHmoLessonSync;
const hmoLessonSyncIssues = async (req, res, next) => {
    try {
        const data = await (0, dashboard_service_1.getLatestHmoLessonSyncIssues)(String(req.query.program_code || '').trim() || undefined, String(req.query.error_code || '').trim() || undefined, (0, authorization_service_1.getProgramScopeFilter)(req.user, 'dashboard_view'));
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.hmoLessonSyncIssues = hmoLessonSyncIssues;
