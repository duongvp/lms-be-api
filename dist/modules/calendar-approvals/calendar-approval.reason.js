"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvalSubmissionReason = approvalSubmissionReason;
exports.approvalTitle = approvalTitle;
exports.approvalSubmissionTitle = approvalSubmissionTitle;
const calendar_approval_access_1 = require("./calendar-approval.access");
const calendar_approval_types_1 = require("./calendar-approval.types");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
// Keep approval context separate from business payload.reason/change_reason.
function approvalSubmissionReason(req, res, operation) {
    (0, calendar_approval_access_1.requirePermission)(req.user, calendar_approval_types_1.PERMISSIONS.submit);
    const raw = req.header('X-Calendar-Approval-Reason');
    if (raw === undefined) {
        res.status(409).json({ success: false, code: 'APPROVAL_REASON_REQUIRED', operation, message: 'Vui lòng nhập lý do gửi yêu cầu duyệt.' });
        return;
    }
    let reason;
    try {
        reason = decodeURIComponent(raw).trim();
    }
    catch {
        throw new ApiError_1.default('Lý do gửi duyệt không hợp lệ.', 422);
    }
    if (!reason || reason.length > 1000)
        throw new ApiError_1.default('Vui lòng nhập lý do gửi duyệt từ 1 đến 1000 ký tự.', 422);
    return reason;
}
function approvalTitle(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 255)
        throw new ApiError_1.default('Vui lòng nhập tiêu đề yêu cầu từ 1 đến 255 ký tự.', 422);
    return value.trim();
}
function approvalSubmissionTitle(req) {
    const raw = req.header('X-Calendar-Approval-Title');
    if (raw === undefined)
        return null;
    let value;
    try {
        value = decodeURIComponent(raw);
    }
    catch {
        throw new ApiError_1.default('Tiêu đề yêu cầu không hợp lệ.', 422);
    }
    return approvalTitle(value);
}
