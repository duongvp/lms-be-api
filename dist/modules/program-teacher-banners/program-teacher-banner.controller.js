"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importFile = exports.exportFile = exports.template = exports.options = exports.remove = exports.update = exports.create = exports.detail = exports.list = void 0;
const apiResponse_1 = require("../../utils/apiResponse");
const program_teacher_banner_service_1 = require("./program-teacher-banner.service");
const program_teacher_banner_validation_1 = require("./program-teacher-banner.validation");
const program_teacher_banner_io_1 = require("./program-teacher-banner.io");
const actor = (req) => String(req.user?.username || 'system');
const handle = (res, error) => (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
const list = async (req, res) => { try {
    return (0, apiResponse_1.SuccessResponse)(res, 'Lấy danh sách banner thành công', await (0, program_teacher_banner_service_1.listBanners)((0, program_teacher_banner_validation_1.validateQuery)(req.query)));
}
catch (e) {
    return handle(res, e);
} };
exports.list = list;
const detail = async (req, res) => { try {
    return (0, apiResponse_1.SuccessResponse)(res, 'Lấy banner thành công', await (0, program_teacher_banner_service_1.getBanner)((0, program_teacher_banner_validation_1.validateId)(req.params.id)));
}
catch (e) {
    return handle(res, e);
} };
exports.detail = detail;
const create = async (req, res) => { try {
    return res.status(201).json({ success: true, message: 'Đã thêm banner', data: await (0, program_teacher_banner_service_1.createBanner)((0, program_teacher_banner_validation_1.validatePayload)(req.body), actor(req)) });
}
catch (e) {
    return handle(res, e);
} };
exports.create = create;
const update = async (req, res) => { try {
    return (0, apiResponse_1.SuccessResponse)(res, 'Đã cập nhật banner', await (0, program_teacher_banner_service_1.updateBanner)((0, program_teacher_banner_validation_1.validateId)(req.params.id), (0, program_teacher_banner_validation_1.validatePayload)(req.body), actor(req)));
}
catch (e) {
    return handle(res, e);
} };
exports.update = update;
const remove = async (req, res) => { try {
    return (0, apiResponse_1.SuccessResponse)(res, 'Đã xóa banner', await (0, program_teacher_banner_service_1.deleteBanner)((0, program_teacher_banner_validation_1.validateId)(req.params.id)));
}
catch (e) {
    return handle(res, e);
} };
exports.remove = remove;
const options = async (req, res) => { try {
    const teacherId = req.query.teacher_profile_id ? (0, program_teacher_banner_validation_1.validateId)(req.query.teacher_profile_id) : undefined;
    return (0, apiResponse_1.SuccessResponse)(res, 'Lấy lựa chọn thành công', await (0, program_teacher_banner_service_1.getBannerOptions)(String(req.query.program_code || '').trim() || undefined, teacherId));
}
catch (e) {
    return handle(res, e);
} };
exports.options = options;
const template = async (_req, res) => { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="mau-import-banner.xlsx"'); return res.send((0, program_teacher_banner_io_1.buildBannerTemplate)()); };
exports.template = template;
const exportFile = async (req, res) => { try {
    const rows = await (0, program_teacher_banner_service_1.getBannersForExport)(String(req.query.search || ''));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="banner-chuong-trinh-giao-vien.xlsx"');
    return res.send((0, program_teacher_banner_io_1.buildBannerExport)(rows));
}
catch (e) {
    return handle(res, e);
} };
exports.exportFile = exportFile;
const importFile = async (req, res) => { try {
    if (!req.file)
        return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn file', 400);
    const result = await (0, program_teacher_banner_service_1.importBanners)((0, program_teacher_banner_io_1.parseBannerFile)(req.file.buffer, req.file.originalname), req.body?.mode === 'overwrite' ? 'overwrite' : 'skip', actor(req));
    if (!result.imported)
        return res.status(400).json({ success: false, message: 'File có dữ liệu không hợp lệ', errors: result.errors });
    return (0, apiResponse_1.SuccessResponse)(res, 'Import banner thành công', result);
}
catch (e) {
    return handle(res, e);
} };
exports.importFile = importFile;
