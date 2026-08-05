"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overview = void 0;
const dashboard_service_1 = require("./dashboard.service");
const overview = async (_req, res, next) => {
    try {
        const data = await (0, dashboard_service_1.getDashboardOverview)();
        res.status(200).json({ success: true, data });
    }
    catch (error) {
        next(error);
    }
};
exports.overview = overview;
