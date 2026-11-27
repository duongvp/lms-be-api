"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const report_service_1 = require("./report.service");
const report_domain_1 = require("./report-domain");
const report_common_1 = require("./report-common");
const report_export_1 = require("./report-export");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.default.authenticate);
const run = (fn) => async (req, res, next) => { try {
    res.json({ success: true, data: (0, report_domain_1.json)(await fn(req)) });
}
catch (e) {
    next(e);
} };
router.get('/options', auth_middleware_1.default.authorize(['teaching_report.view']), run(req => (0, report_service_1.reportOptions)(req.user, req.query)));
router.get('/', auth_middleware_1.default.authorize(['teaching_report.view']), run(req => (0, report_service_1.report)(req.user, req.query)));
router.get('/export', auth_middleware_1.default.authorize(['teaching_report.view']), auth_middleware_1.default.authorize(['teaching_report.export']), async (req, res, next) => {
    try {
        const data = await (0, report_service_1.reportData)(req.user, req.query);
        const codes = [...new Set(data.sessions.map(s => s.code))];
        if (codes.length)
            (0, report_common_1.check)(req.user, 'teaching_report.export', codes);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="bao-cao-giang-day.xlsx"');
        res.send((0, report_export_1.teachingReportWorkbook)(data));
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
