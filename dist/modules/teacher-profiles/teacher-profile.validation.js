"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTeacherProfileStatusPayload = exports.validateTeacherProfilePayload = exports.validateTeacherProfileListQuery = exports.validateTeacherProfileId = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const teacher_profile_types_1 = require("./teacher-profile.types");
const parseInteger = (value, field) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new ApiError_1.default(`${field} không hợp lệ`, 400);
    }
    return parsed;
};
const parseString = (value, field, maxLength) => {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string') {
        throw new ApiError_1.default(`${field} không hợp lệ`, 400);
    }
    const parsed = value.trim();
    if (parsed.length > maxLength) {
        throw new ApiError_1.default(`${field} không được vượt quá ${maxLength} ký tự`, 400);
    }
    return parsed;
};
const parseTeacherType = (value) => {
    const parsed = parseInteger(value, 'teacher_type');
    if (parsed !== teacher_profile_types_1.TEACHER_TYPES.TEACHER && parsed !== teacher_profile_types_1.TEACHER_TYPES.TEACHING_ASSISTANT) {
        throw new ApiError_1.default('teacher_type chỉ nhận giá trị 1 (Giáo viên) hoặc 2 (Trợ giảng)', 400);
    }
    return parsed;
};
const parseStatus = (value) => {
    const parsed = parseInteger(value, 'status');
    if (parsed !== 0 && parsed !== 1) {
        throw new ApiError_1.default('status chỉ nhận giá trị 0 hoặc 1', 400);
    }
    return parsed;
};
const validateTeacherProfileId = (value) => {
    const id = parseInteger(value, 'id');
    if (!id || id <= 0)
        throw new ApiError_1.default('id không hợp lệ', 400);
    return id;
};
exports.validateTeacherProfileId = validateTeacherProfileId;
const validateTeacherProfileListQuery = (query) => {
    const page = parseInteger(query.page, 'page') ?? 1;
    const limit = parseInteger(query.limit, 'limit') ?? 20;
    if (page < 1)
        throw new ApiError_1.default('page phải lớn hơn 0', 400);
    if (limit < 1 || limit > 100) {
        throw new ApiError_1.default('limit phải nằm trong khoảng 1-100', 400);
    }
    return {
        page,
        limit,
        search: parseString(query.search, 'search', 120) || undefined,
        teacher_type: query.teacher_type === undefined
            ? undefined
            : parseTeacherType(query.teacher_type),
        status: query.status === undefined ? undefined : parseStatus(query.status),
    };
};
exports.validateTeacherProfileListQuery = validateTeacherProfileListQuery;
const validateTeacherProfilePayload = (body, isUpdate = false) => {
    const payload = {};
    if (isUpdate && body.username !== undefined) {
        throw new ApiError_1.default('Không hỗ trợ thay đổi mã nhân sự vì lịch học đang dùng mã này làm khóa nghiệp vụ', 400);
    }
    if (!isUpdate || body.username !== undefined) {
        const username = parseString(body.username, 'username', 120);
        if (!username)
            throw new ApiError_1.default('Vui lòng cung cấp mã nhân sự', 400);
        if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
            throw new ApiError_1.default('Mã nhân sự chỉ được chứa chữ, số và các ký tự . _ @ -', 400);
        }
        payload.username = username;
    }
    if (!isUpdate || body.display_name !== undefined) {
        payload.display_name = parseString(body.display_name, 'display_name', 100) || null;
    }
    if (!isUpdate || body.teacher_type !== undefined) {
        payload.teacher_type = parseTeacherType(body.teacher_type ?? teacher_profile_types_1.TEACHER_TYPES.TEACHER);
    }
    if (!isUpdate || body.status !== undefined) {
        payload.status = parseStatus(body.status ?? 1);
    }
    if (isUpdate) {
        if (Object.keys(payload).length === 0) {
            throw new ApiError_1.default('Không có dữ liệu cập nhật', 400);
        }
    }
    return payload;
};
exports.validateTeacherProfilePayload = validateTeacherProfilePayload;
const validateTeacherProfileStatusPayload = (body) => ({
    status: parseStatus(body?.status),
});
exports.validateTeacherProfileStatusPayload = validateTeacherProfileStatusPayload;
