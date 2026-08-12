"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const apiResponse_1 = require("../../utils/apiResponse");
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const teacher_profile_service_1 = require("./teacher-profile.service");
const teacher_profile_validation_1 = require("./teacher-profile.validation");
const serializer_1 = require("../../lib/serializer");
const teacher_profile_io_1 = require("./teacher-profile.io");
const list = async (req, res) => {
    try {
        const result = await (0, teacher_profile_service_1.listTeacherProfiles)((0, teacher_profile_validation_1.validateTeacherProfileListQuery)(req.query));
        const data = await field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'teacher_profile', result.data);
        return (0, apiResponse_1.SuccessResponse)(res, 'Lấy danh sách nhân sự thành công', { ...result, data });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const detail = async (req, res) => {
    try {
        const result = await (0, teacher_profile_service_1.getTeacherProfile)((0, teacher_profile_validation_1.validateTeacherProfileId)(req.params.id));
        const data = await field_permission_service_1.default.filterVisibleRecord(req.user?.roleIds || [], 'teacher_profile', result);
        return (0, apiResponse_1.SuccessResponse)(res, 'Lấy thông tin nhân sự thành công', data);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const create = async (req, res) => {
    try {
        const result = await (0, teacher_profile_service_1.createTeacherProfile)((0, teacher_profile_validation_1.validateTeacherProfilePayload)(req.body));
        return res.status(201).json({
            success: true,
            message: 'Đã thêm nhân sự giảng dạy',
            data: (0, serializer_1.serializeBigInt)(result),
        });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const update = async (req, res) => {
    try {
        const result = await (0, teacher_profile_service_1.updateTeacherProfile)((0, teacher_profile_validation_1.validateTeacherProfileId)(req.params.id), (0, teacher_profile_validation_1.validateTeacherProfilePayload)(req.body, true));
        return (0, apiResponse_1.SuccessResponse)(res, 'Đã cập nhật nhân sự giảng dạy', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const updateStatus = async (req, res) => {
    try {
        const { status } = (0, teacher_profile_validation_1.validateTeacherProfileStatusPayload)(req.body);
        const result = await (0, teacher_profile_service_1.updateTeacherProfileStatus)((0, teacher_profile_validation_1.validateTeacherProfileId)(req.params.id), status);
        return (0, apiResponse_1.SuccessResponse)(res, 'Đã cập nhật trạng thái nhân sự', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const remove = async (req, res) => {
    try {
        const result = await (0, teacher_profile_service_1.deleteTeacherProfile)((0, teacher_profile_validation_1.validateTeacherProfileId)(req.params.id));
        return (0, apiResponse_1.SuccessResponse)(res, 'Đã xóa nhân sự giảng dạy', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const exportFile = async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
        const query = (0, teacher_profile_validation_1.validateTeacherProfileListQuery)({
            ...req.query,
            page: 1,
            limit: 100,
        });
        const rows = await (0, teacher_profile_service_1.getTeacherProfilesForExport)({
            search: query.search,
            can_view_stream_key: query.can_view_stream_key,
            status: query.status,
        });
        const buffer = (0, teacher_profile_io_1.buildTeacherProfileFile)(rows, format);
        res.setHeader('Content-Type', (0, teacher_profile_io_1.getTeacherProfileFileContentType)(format));
        res.setHeader('Content-Disposition', `attachment; filename="nhan-su-giang-day-${Date.now()}.${format}"`);
        return res.send(buffer);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const template = async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    res.setHeader('Content-Type', (0, teacher_profile_io_1.getTeacherProfileFileContentType)(format));
    res.setHeader('Content-Disposition', `attachment; filename="mau-nhap-nhan-su-giang-day.${format}"`);
    return res.send((0, teacher_profile_io_1.buildTeacherProfileTemplate)(format));
};
const importFile = async (req, res) => {
    try {
        if (!req.file) {
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn file cần nhập', 400);
        }
        const parsedRows = (0, teacher_profile_io_1.parseTeacherProfileFile)(req.file.buffer, req.file.originalname);
        const { data, errors } = (0, teacher_profile_io_1.validateTeacherProfileImportRows)(parsedRows);
        if (errors.length) {
            return res.status(400).json({
                success: false,
                message: 'File có dữ liệu không hợp lệ',
                errors,
            });
        }
        const mode = req.body?.mode === 'overwrite' ? 'overwrite' : 'skip';
        const result = await (0, teacher_profile_service_1.importTeacherProfiles)(data, mode);
        return (0, apiResponse_1.SuccessResponse)(res, 'Nhập danh sách nhân sự thành công', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
exports.default = {
    list,
    detail,
    create,
    update,
    updateStatus,
    remove,
    exportFile,
    template,
    importFile,
};
