"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const apiResponse_1 = require("../../utils/apiResponse");
const lesson_service_1 = require("./lesson.service");
const lesson_validation_1 = require("./lesson.validation");
const lesson_io_1 = require("./lesson.io");
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const lesson_secondary_auth_1 = require("./lesson-secondary-auth");
const lesson_repository_1 = require("./lesson.repository");
const authorization_service_1 = require("../../services/authorization.service");
const reauthenticate = async (req, res) => {
    try {
        return (0, apiResponse_1.SuccessResponse)(res, 'Xác thực cấp 2 thành công', (0, lesson_secondary_auth_1.issueLessonSecondaryToken)(req, req.body?.password));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const reauthStatus = async (_req, res) => ((0, apiResponse_1.SuccessResponse)(res, 'Phiên xác thực cấp 2 còn hiệu lực', { valid: true }));
const list = async (req, res) => {
    try {
        const query = (0, lesson_validation_1.validateLessonListQuery)(req.query);
        if (!query.subject_code) {
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình', 400);
        }
        const result = await (0, lesson_service_1.getLessons)(query);
        const data = await field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'lessons', result.data);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', { ...result, data });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const subjects = async (_req, res) => {
    try {
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, lesson_service_1.getLessonSubjects)());
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const programs = async (req, res) => {
    try {
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, lesson_service_1.getLessonPrograms)((0, authorization_service_1.getProgramScopeFilter)(req.user, 'lessons.view')));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const createProgram = async (req, res) => {
    try {
        const payload = (0, lesson_validation_1.validateLessonPayload)({
            ...req.body,
            learn_number: 1,
        });
        const result = await (0, lesson_service_1.createNewProgram)(payload);
        return res.status(201).json({
            success: true,
            message: 'Đã tạo Chương trình và bài học đầu tiên',
            data: result,
        });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const courseMappings = async (req, res) => {
    try {
        const programCode = String(req.query.program_code || '').trim();
        if (!programCode)
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình', 400);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', await (0, lesson_service_1.getCourseMappingsByProgram)(programCode));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const updateCourseMappings = async (req, res) => {
    try {
        const payload = (0, lesson_validation_1.validateLessonCourseMappingPayload)(req.body);
        return (0, apiResponse_1.SuccessResponse)(res, 'Updated', await (0, lesson_service_1.changeLessonCourseMappings)(payload));
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const detail = async (req, res) => {
    try {
        const id = (0, lesson_validation_1.validateLessonId)(req.params.id);
        const result = await (0, lesson_service_1.getLessonDetail)(id);
        const visibleResult = await field_permission_service_1.default.filterVisibleRecord(req.user?.roleIds || [], 'lessons', result);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', visibleResult);
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
        const result = await (0, lesson_service_1.exportLessons)(query, (rows) => (field_permission_service_1.default.filterVisibleRecords(req.user?.roleIds || [], 'lessons', rows)));
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
        const programCode = String(req.query.program_code || '').trim();
        if (!programCode)
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình trước khi tải file mẫu', 400);
        const program = await (0, lesson_repository_1.findLessonProgramByCode)(programCode);
        if (!program)
            return (0, apiResponse_1.ErrorResponse)(res, 'Chương trình không tồn tại hoặc chưa có đề cương', 404);
        const result = (0, lesson_service_1.getLessonImportTemplate)(format);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        return res.send(result.buffer);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const programTemplate = async (req, res) => {
    try {
        const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
        const result = (0, lesson_service_1.getProgramImportTemplate)(format);
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="program-import-template.${format}"`);
        return res.send(result.buffer);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const getGoogleSheetCsv = async (sheetUrl) => {
    let parsed;
    try {
        parsed = new URL(sheetUrl);
    }
    catch {
        throw new Error('Link Google Sheets không hợp lệ');
    }
    if (parsed.hostname !== 'docs.google.com')
        throw new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
    const match = parsed.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match)
        throw new Error('Link Google Sheets không hợp lệ');
    const gid = parsed.searchParams.get('gid') || '0';
    const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    const response = await fetch(exportUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok)
        throw new Error('Không thể đọc Google Sheets. Hãy kiểm tra quyền chia sẻ công khai của sheet.');
    return Buffer.from(await response.arrayBuffer());
};
const importFile = async (req, res) => {
    try {
        const file = req.file;
        const sheetUrl = String(req.body?.sheet_url || '').trim();
        if (!file && !sheetUrl)
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn file hoặc dán link Google Sheets', 400);
        const extension = file?.originalname.split('.').pop()?.toLowerCase();
        if (file && extension !== 'xlsx' && extension !== 'csv') {
            return (0, apiResponse_1.ErrorResponse)(res, 'Chỉ hỗ trợ file .xlsx hoặc .csv', 400);
        }
        let programCode = String(req.body?.program_code || '').trim();
        if (!programCode && String(req.body?.create_program || '') !== 'true') {
            return (0, apiResponse_1.ErrorResponse)(res, 'Vui lòng chọn Chương trình trước khi import', 400);
        }
        const creatingProgram = String(req.body?.create_program || '') === 'true';
        const existingProgram = programCode ? await (0, lesson_repository_1.findLessonProgramByCode)(programCode) : null;
        if (!creatingProgram && !existingProgram) {
            return (0, apiResponse_1.ErrorResponse)(res, 'Chương trình không tồn tại hoặc chưa có đề cương', 404);
        }
        if (creatingProgram && existingProgram) {
            return (0, apiResponse_1.ErrorResponse)(res, 'Mã chương trình đã tồn tại', 409);
        }
        const program = existingProgram;
        const mode = req.body?.mode === 'skip' ? 'skip' : 'overwrite';
        const importBuffer = file?.buffer ?? await getGoogleSheetCsv(sheetUrl);
        const importName = file?.originalname ?? 'google-sheet.csv';
        const rawRows = (0, lesson_io_1.parseLessonImportFile)(importBuffer, importName).map((row) => (creatingProgram ? row : {
            ...row, grade: program.grade, system_type: program.system_type,
            subject_code: program.subject_code, subject_name: program.subject_name,
        }));
        const { validRows, errors } = (0, lesson_validation_1.validateLessonImportRows)(rawRows);
        if (creatingProgram && validRows.length) {
            const programs = Array.from(new Set(validRows.map((row) => row.subject_code)));
            programs.forEach((code) => (0, authorization_service_1.assertProgramAccess)(req.user, 'lessons.import', code));
            const existingPrograms = await Promise.all(programs.map(async (code) => ({
                code,
                existing: await (0, lesson_repository_1.findLessonProgramByCode)(code),
            })));
            for (const { code, existing } of existingPrograms) {
                if (existing) {
                    const firstRow = validRows.find((row) => row.subject_code === code);
                    errors.push({ row: firstRow.row_number, field: 'subject_code', message: `Mã chương trình ${code} đã tồn tại` });
                }
            }
        }
        const resolvedProgramCode = creatingProgram ? '' : program.subject_code;
        if (resolvedProgramCode)
            (0, authorization_service_1.assertProgramAccess)(req.user, 'lessons.import', resolvedProgramCode);
        const sequenceErrors = errors.length ? [] : await (0, lesson_service_1.validateLessonImportSequence)(validRows, mode, creatingProgram);
        const allErrors = [...errors, ...sequenceErrors];
        if (allErrors.length) {
            return res.status(400).json({
                success: false,
                message: 'File import có dữ liệu không hợp lệ',
                errors: allErrors,
            });
        }
        const result = creatingProgram
            ? await (0, lesson_service_1.importNewProgramLessonRows)(validRows)
            : await (0, lesson_service_1.importLessonRows)(validRows, mode);
        return (0, apiResponse_1.SuccessResponse)(res, 'Imported', { ...result, program: validRows[0] ? {
                grade: validRows[0].grade, system_type: validRows[0].system_type,
                subject_code: validRows[0].subject_code, subject_name: validRows[0].subject_name,
            } : undefined });
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
    reauthenticate,
    reauthStatus,
    list,
    subjects,
    programs,
    createProgram,
    courseMappings,
    updateCourseMappings,
    detail,
    create,
    update,
    bulkUpdate,
    reorder,
    exportFile,
    template,
    programTemplate,
    importFile,
    remove,
};
