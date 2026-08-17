"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const apiResponse_1 = require("../../utils/apiResponse");
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const quiz_service_1 = require("./quiz.service");
const quiz_validation_1 = require("./quiz.validation");
const quiz_io_1 = require("./quiz.io");
const quiz_constants_1 = require("./quiz.constants");
const authorization_service_1 = require("../../services/authorization.service");
const visibleRecord = (req, record) => (field_permission_service_1.default.filterVisibleRecord(req.user?.roleIds || [], 'quiz', record));
const visibleRecords = (req, records) => (field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'quiz', records));
const list = async (req, res) => {
    try {
        if (!String(req.query.code || '').trim())
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình', 400);
        const result = await (0, quiz_service_1.getQuizzes)((0, quiz_validation_1.validateQuizListQuery)(req.query), (0, authorization_service_1.getProgramScopeFilter)(req.user, 'quiz.view'));
        const data = await visibleRecords(req, result.data);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', { ...result, data });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const options = async (_req, res) => (0, apiResponse_1.SuccessResponse)(res, 'Success', (0, quiz_service_1.getQuizOptions)());
const classes = async (req, res) => {
    try {
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, quiz_service_1.getQuizClassOptions)((0, authorization_service_1.getProgramScopeFilter)(req.user, 'quiz.view')));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const lessons = async (req, res) => {
    try {
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, quiz_service_1.getQuizLessonOptions)((0, quiz_validation_1.validateQuizClassCode)(req.query.code)));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const indexSuggestion = async (req, res) => {
    try {
        const result = await (0, quiz_service_1.getQuizIndexSuggestion)((0, quiz_validation_1.validateQuizIndexSuggestionQuery)(req.query));
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', {
            ...result,
            duplicate: result.duplicate ? await visibleRecord(req, result.duplicate) : null,
        });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const detail = async (req, res) => {
    try {
        const result = await (0, quiz_service_1.getQuizDetail)((0, quiz_validation_1.validateQuizId)(req.params.quizId));
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await visibleRecord(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const create = async (req, res) => {
    try {
        const payload = (0, quiz_validation_1.validateQuizPayload)(req.body);
        const result = await (0, quiz_service_1.createNewQuiz)(payload, String(req.user?.username || req.user?.userId || 'system'));
        return res.status(201).json({ success: true, message: 'Created', data: await visibleRecord(req, result) });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const update = async (req, res) => {
    try {
        const quizId = (0, quiz_validation_1.validateQuizId)(req.params.quizId);
        const payload = (0, quiz_validation_1.validateQuizPayload)(req.body, true);
        const result = await (0, quiz_service_1.updateExistingQuiz)(quizId, payload);
        return (0, apiResponse_1.SuccessResponse)(res, 'Updated', await visibleRecord(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const remove = async (req, res) => {
    try {
        const result = await (0, quiz_service_1.disableExistingQuiz)((0, quiz_validation_1.validateQuizId)(req.params.quizId));
        return (0, apiResponse_1.SuccessResponse)(res, 'Disabled', await visibleRecord(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const restore = async (req, res) => {
    try {
        const result = await (0, quiz_service_1.restoreExistingQuiz)((0, quiz_validation_1.validateQuizId)(req.params.quizId));
        return (0, apiResponse_1.SuccessResponse)(res, 'Restored', await visibleRecord(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const bulkUpdate = async (req, res) => {
    try {
        const payload = (0, quiz_validation_1.validateQuizBulkPayload)(req.body);
        const result = await (0, quiz_service_1.bulkUpdateExistingQuizzes)(payload);
        return (0, apiResponse_1.SuccessResponse)(res, 'Bulk updated', await visibleRecords(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const reorder = async (req, res) => {
    try {
        const result = await (0, quiz_service_1.reorderExistingQuizzes)((0, quiz_validation_1.validateQuizReorderPayload)(req.body));
        return (0, apiResponse_1.SuccessResponse)(res, 'Reordered', await visibleRecords(req, result));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const exportFile = async (req, res) => {
    try {
        const query = (0, quiz_validation_1.validateQuizExportQuery)(req.query);
        if (!query.code)
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình', 400);
        const result = await (0, quiz_service_1.exportQuizzes)(query, (rows) => visibleRecords(req, rows), (0, authorization_service_1.getProgramScopeFilter)(req.user, 'quiz.export'));
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
        (0, authorization_service_1.assertProgramAccess)(req.user, 'quiz.import', (0, quiz_validation_1.validateQuizClassCode)(req.query.code));
        const result = (0, quiz_service_1.getQuizImportTemplate)(format);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
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
        if (!req.file)
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn file import', 400);
        const extension = req.file.originalname.split('.').pop()?.toLowerCase();
        if (extension !== 'xlsx' && extension !== 'csv')
            return (0, apiResponse_1.ErrorResponse)(res, 'Chỉ hỗ trợ file .xlsx hoặc .csv', 400);
        await field_permission_service_1.default.assertEditableFields(req.user?.roleIds || [], 'quiz', [...quiz_constants_1.QUIZ_MUTABLE_FIELDS]);
        const code = (0, quiz_validation_1.validateQuizClassCode)(req.body?.code);
        (0, authorization_service_1.assertProgramAccess)(req.user, 'quiz.import', code);
        const rawRows = (0, quiz_io_1.parseQuizImportFile)(req.file.buffer, req.file.originalname).map((row) => ({ ...row, code }));
        if (!rawRows.length)
            return (0, apiResponse_1.ErrorResponse)(res, 'File import không có dữ liệu', 400);
        const { validRows, errors } = (0, quiz_validation_1.validateQuizImportRows)(rawRows);
        if (errors.length) {
            return res.status(400).json({ success: false, message: 'File import có dữ liệu không hợp lệ', errors });
        }
        const result = await (0, quiz_service_1.importQuizRows)(validRows, (0, quiz_validation_1.parseQuizImportMode)(req.body?.mode), String(req.user?.username || req.user?.userId || 'system'));
        return (0, apiResponse_1.SuccessResponse)(res, 'Imported', result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
exports.default = {
    list, options, classes, lessons, indexSuggestion, detail, create, update, remove, restore, bulkUpdate, reorder,
    exportFile, template, importFile,
};
