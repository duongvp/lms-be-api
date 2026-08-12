"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overview = void 0;
const dashboard_service_1 = require("./dashboard.service");
const authorization_service_1 = require("../../services/authorization.service");
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
