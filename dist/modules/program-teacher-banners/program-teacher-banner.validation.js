"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePayload = exports.validateQuery = exports.validateId = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const int = (value, field) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed))
        throw new ApiError_1.default(`${field} không hợp lệ`, 400);
    return parsed;
};
const validateId = (value) => {
    const id = int(value, 'id');
    if (id <= 0)
        throw new ApiError_1.default('id không hợp lệ', 400);
    return id;
};
exports.validateId = validateId;
const validateQuery = (query) => {
    const page = query.page === undefined ? 1 : int(query.page, 'page');
    const limit = query.limit === undefined ? 20 : int(query.limit, 'limit');
    if (page < 1 || limit < 1 || limit > 100)
        throw new ApiError_1.default('Phân trang không hợp lệ', 400);
    const status = query.status === undefined || query.status === '' ? undefined : int(query.status, 'status');
    if (status !== undefined && status !== 0 && status !== 1)
        throw new ApiError_1.default('status không hợp lệ', 400);
    return { page, limit, search: String(query.search || '').trim().slice(0, 120) || undefined, program_code: String(query.program_code || '').trim().slice(0, 50) || undefined, status };
};
exports.validateQuery = validateQuery;
const validatePayload = (body) => {
    const program_code = String(body?.program_code || '').trim();
    const banner_url = String(body?.banner_url || '').trim();
    const teacher_profile_id = int(body?.teacher_profile_id, 'teacher_profile_id');
    const status = body?.status === undefined ? 1 : int(body.status, 'status');
    if (!program_code || program_code.length > 50)
        throw new ApiError_1.default('Mã chương trình không hợp lệ', 400);
    if (teacher_profile_id <= 0)
        throw new ApiError_1.default('Giáo viên không hợp lệ', 400);
    if (!banner_url || banner_url.length > 500)
        throw new ApiError_1.default('URL banner không hợp lệ', 400);
    try {
        const url = new URL(banner_url);
        if (!['http:', 'https:'].includes(url.protocol))
            throw new Error();
    }
    catch {
        throw new ApiError_1.default('Banner phải là URL HTTP/HTTPS hợp lệ', 400);
    }
    if (status !== 0 && status !== 1)
        throw new ApiError_1.default('Trạng thái không hợp lệ', 400);
    return { program_code, teacher_profile_id, banner_url, status: status };
};
exports.validatePayload = validatePayload;
