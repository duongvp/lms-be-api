"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const apiResponse_1 = require("../../utils/apiResponse");
const lesson_service_1 = require("./lesson.service");
const lesson_validation_1 = require("./lesson.validation");
const lesson_io_1 = require("./lesson.io");
const list = async (req, res) => {
    try {
        const query = (0, lesson_validation_1.validateLessonListQuery)(req.query);
        const result = await (0, lesson_service_1.getLessons)(query);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const detail = async (req, res) => {
    try {
        const id = (0, lesson_validation_1.validateLessonId)(req.params.id);
        const result = await (0, lesson_service_1.getLessonDetail)(id);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const create = async (req, res) => {
    try {
        const payload = (0, lesson_validation_1.validateLessonPayload)(req.body);
        const result = await (0, lesson_service_1.createNewLesson)(payload);
        return res.status(201).json({ success: true, message: 'Created', data: result });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const update = async (req, res) => {
    try {
        const id = (0, lesson_validation_1.validateLessonId)(req.params.id);
        const payload = (0, lesson_validation_1.validateLessonPayload)(req.body, true);
        const result = await (0, lesson_service_1.updateExistingLesson)(id, payload);
        return (0, apiResponse_1.SuccessResponse)(res, 'Updated', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const bulkUpdate = async (req, res) => {
    try {
        const payload = (0, lesson_validation_1.validateLessonBulkUpdatePayload)(req.body);
        const result = await (0, lesson_service_1.bulkUpdateExistingLessons)(payload);
        return (0, apiResponse_1.SuccessResponse)(res, 'Bulk updated', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const reorder = async (req, res) => {
    try {
        const payload = (0, lesson_validation_1.validateLessonReorderPayload)(req.body);
        const result = await (0, lesson_service_1.reorderExistingLessons)(payload);
        return (0, apiResponse_1.SuccessResponse)(res, 'Reordered', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const exportFile = async (req, res) => {
    try {
        const query = (0, lesson_validation_1.validateLessonExportQuery)(req.query);
        const result = await (0, lesson_service_1.exportLessons)(query);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        return res.send(result.buffer);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const template = async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
        const result = (0, lesson_service_1.getLessonImportTemplate)(format);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        return res.send(result.buffer);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const importFile = async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn file import', 400);
        }
        const extension = file.originalname.split('.').pop()?.toLowerCase();
        if (extension !== 'xlsx' && extension !== 'csv') {
            return (0, apiResponse_1.ErrorResponse)(res, 'Chỉ hỗ trợ file .xlsx hoặc .csv', 400);
        }
        const mode = req.body?.mode === 'skip' ? 'skip' : 'overwrite';
        const rawRows = (0, lesson_io_1.parseLessonImportFile)(file.buffer, file.originalname);
        const { validRows, errors } = (0, lesson_validation_1.validateLessonImportRows)(rawRows);
        const sequenceErrors = errors.length ? [] : await (0, lesson_service_1.validateLessonImportSequence)(validRows, mode);
        const allErrors = [...errors, ...sequenceErrors];
        if (allErrors.length) {
            return res.status(400).json({
                success: false,
                message: 'File import có dữ liệu không hợp lệ',
                errors: allErrors,
            });
        }
        const result = await (0, lesson_service_1.importLessonRows)(validRows, mode);
        return (0, apiResponse_1.SuccessResponse)(res, 'Imported', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const remove = async (req, res) => {
    try {
        const id = (0, lesson_validation_1.validateLessonId)(req.params.id);
        const result = await (0, lesson_service_1.deleteExistingLesson)(id);
        return (0, apiResponse_1.SuccessResponse)(res, 'Deleted', result);
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
    bulkUpdate,
    reorder,
    exportFile,
    template,
    importFile,
    remove,
};
