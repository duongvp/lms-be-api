"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCalendarDetailReportRouter = exports.DETAIL_PERMISSIONS = void 0;
const express_1 = require("express");
const XLSX = __importStar(require("xlsx-js-style"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const authorization_service_1 = require("../../services/authorization.service");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
const evg_recordings_service_1 = require("../../integrations/evg-recordings.service");
const calendar_detail_report_service_1 = require("./calendar-detail-report.service");
const calendar_detail_report_validation_1 = require("./calendar-detail-report.validation");
const calendar_detail_report_io_1 = require("./calendar-detail-report.io");
exports.DETAIL_PERMISSIONS = {
    view: 'calendar.report.detail.view', chat: 'calendar.report.chat.view', moderation: 'calendar.report.moderation.view', export: 'calendar.report.detail.export',
};
/** Scope resolution is shared with the existing calendar routes (linked lesson subject_code). */
const createCalendarDetailReportRouter = (resolveCodes) => {
    const router = (0, express_1.Router)({ mergeParams: true });
    const guard = (permission) => [auth_middleware_1.default.authorize([permission]), auth_middleware_1.default.authorizePrograms(permission, resolveCodes)];
    router.use((req, _res, next) => { try {
        (0, calendar_detail_report_validation_1.detailId)(req.params.calendarId, 'ID lịch');
        next();
    }
    catch (e) {
        next(e);
    } });
    router.use(...guard('calendar.view'), ...guard(exports.DETAIL_PERMISSIONS.view));
    router.use(async (req, _res, next) => {
        try {
            if (!req.user?.permissions?.includes('*') && !req.user?.roles?.includes('admin')) {
                const fields = { username: true, student_hmid: true, name: true, room_id: true };
                const calendarFields = { code: true, learn_number: true, lesson_name: true, teacher: true, assistant_teacher: true, start_time: true, end_time: true };
                const [students, calendars] = await Promise.all([
                    field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'users', [fields]),
                    field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'calendar', [calendarFields]),
                ]);
                if (Object.keys(students[0]).length !== Object.keys(fields).length || Object.keys(calendars[0]).length !== Object.keys(calendarFields).length)
                    throw new ApiError_1.default('Chính sách trường dữ liệu chưa cho phép xem thông tin cần thiết của báo cáo chi tiết', 403);
            }
            next();
        }
        catch (e) {
            next(e);
        }
    });
    // Cache only the scope resolution on this request; all permissions are checked independently.
    const capabilities = async (req) => {
        const codes = await resolveCodes(req);
        return { chat: codes.every(c => (0, authorization_service_1.isProgramAllowed)(req.user, exports.DETAIL_PERMISSIONS.chat, c)),
            moderation: codes.every(c => (0, authorization_service_1.isProgramAllowed)(req.user, exports.DETAIL_PERMISSIONS.moderation, c)),
            activities: codes.every(c => (0, authorization_service_1.isProgramAllowed)(req.user, 'quiz.view', c)) };
    };
    const handle = (run) => async (req, res, next) => {
        try {
            res.json({ success: true, data: await run(req) });
        }
        catch (e) {
            next(e);
        }
    };
    const ids = (req) => ({ calendarId: (0, calendar_detail_report_validation_1.detailId)(req.params.calendarId), studentId: req.params.studentId == null ? undefined : (0, calendar_detail_report_validation_1.detailId)(req.params.studentId, 'ID học sinh') });
    router.get('/live-times', handle(async (req) => {
        const calendar = await prisma_1.default.calendar.findUnique({ where: { id: ids(req).calendarId } });
        if (!calendar)
            throw new ApiError_1.default('Không tìm thấy lịch học', 404);
        return (await (0, evg_recordings_service_1.loadEvgRecordingTimes)([calendar])).get(calendar.id);
    }));
    router.get('/students', handle(async (req) => calendar_detail_report_service_1.calendarDetailReportService.students(ids(req).calendarId, (0, calendar_detail_report_validation_1.parseDetailFilters)(req.query), await capabilities(req))));
    router.get('/overview', handle(async (req) => {
        const { rows: _rows, ...data } = await calendar_detail_report_service_1.calendarDetailReportService.students(ids(req).calendarId, (0, calendar_detail_report_validation_1.parseDetailFilters)({ ...req.query, limit: 1 }), await capabilities(req));
        return data;
    }));
    router.get('/students/:studentId', handle(async (req) => calendar_detail_report_service_1.calendarDetailReportService.student(ids(req).calendarId, ids(req).studentId, (0, calendar_detail_report_validation_1.parseDetailFilters)(req.query), await capabilities(req))));
    for (const path of ['/timeline', '/students/:studentId/events'])
        router.get(path, handle(async (req) => calendar_detail_report_service_1.calendarDetailReportService.events(ids(req).calendarId, ids(req).studentId, (0, calendar_detail_report_validation_1.parseDetailFilters)(req.query), await capabilities(req))));
    const exportHandler = async (req, res, next) => {
        try {
            const { calendarId, studentId } = ids(req), filters = (0, calendar_detail_report_validation_1.parseDetailFilters)(req.query), caps = await capabilities(req);
            const kind = studentId == null ? 'students' : 'events';
            let rows;
            if (kind === 'students')
                rows = (await calendar_detail_report_service_1.calendarDetailReportService.students(calendarId, filters, caps, true)).rows;
            else {
                // Explicit source is required so a denied sensitive source cannot be silently omitted from an export.
                if (filters.source === 'all')
                    throw new ApiError_1.default('Chọn nguồn nhật ký cụ thể để xuất Excel', 400);
                const result = [];
                let cursor;
                do {
                    const page = await calendar_detail_report_service_1.calendarDetailReportService.events(calendarId, studentId, { ...filters, cursor, limit: 100 }, caps);
                    if (filters.source === 'moderation' && page.hidden_rules_available === false)
                        throw new ApiError_1.default('Nguồn ẩn/khôi phục chat chưa có; không thể xuất lịch sử đầy đủ', 422);
                    result.push(...page.rows);
                    if (result.length > 20000)
                        throw new ApiError_1.default('Excel vượt 20.000 bản ghi; hãy thu hẹp khoảng thời gian', 422);
                    cursor = page.next_cursor ?? undefined;
                } while (cursor);
                rows = result;
            }
            const workbook = (0, calendar_detail_report_io_1.buildDetailWorkbook)(kind, rows, `calendar_id=${calendarId}; student_id=${studentId ?? 'all'}; filters=${JSON.stringify(req.query)}`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="chi-tiet-buoi-${calendarId}.xlsx"`);
            res.send(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
        }
        catch (e) {
            next(e);
        }
    };
    router.get('/students/:studentId/export-restrictions', ...guard('calendar.export'), ...guard(exports.DETAIL_PERMISSIONS.export), ...guard(exports.DETAIL_PERMISSIONS.moderation), async (req, res, next) => {
        try {
            const { calendarId, studentId } = ids(req);
            const data = await calendar_detail_report_service_1.calendarDetailReportService.student(calendarId, studentId, (0, calendar_detail_report_validation_1.parseDetailFilters)(req.query), await capabilities(req));
            const wb = (0, calendar_detail_report_io_1.buildRestrictionWorkbook)(data.restriction_records, `calendar_id=${calendarId}; enrollment_id=${studentId}; cùng code+bài, mọi ngày`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="han-che-hien-luu-${studentId}.xlsx"`);
            res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
        }
        catch (e) {
            next(e);
        }
    });
    for (const path of ['/export/students', '/students/:studentId/export'])
        router.get(path, ...guard('calendar.export'), ...guard(exports.DETAIL_PERMISSIONS.export), exportHandler);
    return router;
};
exports.createCalendarDetailReportRouter = createCalendarDetailReportRouter;
