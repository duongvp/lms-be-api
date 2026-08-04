"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExistingQuizAnalytics = exports.getQuizSubmissions = exports.importQuizRows = exports.getQuizImportTemplate = exports.exportQuizzes = exports.reorderExistingQuizzes = exports.bulkUpdateExistingQuizzes = exports.restoreExistingQuiz = exports.disableExistingQuiz = exports.updateExistingQuiz = exports.createNewQuiz = exports.getQuizDetail = exports.getQuizzes = exports.getQuizIndexSuggestion = exports.getQuizLessonOptions = exports.getQuizClassOptions = exports.getQuizOptions = void 0;
const crypto_1 = require("crypto");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const serializer_1 = require("../../lib/serializer");
const quiz_constants_1 = require("./quiz.constants");
const quiz_repository_1 = require("./quiz.repository");
const quiz_validation_1 = require("./quiz.validation");
const quiz_io_1 = require("./quiz.io");
const normalizeStoredAnswers = (value) => {
    if (typeof value !== 'string')
        return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : value;
    }
    catch {
        return value;
    }
};
const normalizeQuiz = (quiz) => quiz ? { ...quiz, ans: normalizeStoredAnswers(quiz.ans) } : quiz;
const normalizeQuizResult = (value) => (0, serializer_1.serializeBigInt)(normalizeQuiz(value));
const translatePersistenceError = (error) => {
    if (error?.code === 'P2002' || String(error?.message ?? '').includes('Duplicate entry')) {
        throw new ApiError_1.default('quiz_id đã tồn tại', 409);
    }
    throw error;
};
const getQuizOptions = () => ({
    quiz_types: quiz_constants_1.QUIZ_TYPE_OPTIONS,
    score_types: quiz_constants_1.QUIZ_SCORE_TYPE_OPTIONS,
    statuses: quiz_constants_1.QUIZ_STATUS_OPTIONS,
    duration_unit: 'seconds',
});
exports.getQuizOptions = getQuizOptions;
const getQuizClassOptions = async () => (0, serializer_1.serializeBigInt)(await (0, quiz_repository_1.findQuizClassOptions)());
exports.getQuizClassOptions = getQuizClassOptions;
const getQuizLessonOptions = async (code) => ((0, serializer_1.serializeBigInt)(await (0, quiz_repository_1.findQuizLessonOptions)(code)));
exports.getQuizLessonOptions = getQuizLessonOptions;
const getQuizIndexSuggestion = async (query) => {
    const result = await (0, quiz_repository_1.findQuizIndexSuggestion)(query);
    return (0, serializer_1.serializeBigInt)({
        next_index: result.next_index,
        duplicate: normalizeQuiz(result.duplicate),
    });
};
exports.getQuizIndexSuggestion = getQuizIndexSuggestion;
const getQuizzes = async (query) => {
    const result = await (0, quiz_repository_1.findQuizzes)(query);
    return (0, serializer_1.serializeBigInt)({ ...result, data: result.data.map(normalizeQuiz) });
};
exports.getQuizzes = getQuizzes;
const getQuizDetail = async (quizId) => {
    const quiz = await (0, quiz_repository_1.findQuizById)(quizId);
    if (!quiz)
        throw new ApiError_1.default('Quiz không tồn tại', 404);
    return normalizeQuizResult(quiz);
};
exports.getQuizDetail = getQuizDetail;
const createNewQuiz = async (payload, creator) => {
    const quizId = payload.quiz_id ?? (0, crypto_1.randomUUID)();
    try {
        return normalizeQuizResult(await (0, quiz_repository_1.createQuiz)(quizId, payload, creator));
    }
    catch (error) {
        return translatePersistenceError(error);
    }
};
exports.createNewQuiz = createNewQuiz;
const updateExistingQuiz = async (quizId, payload) => {
    const current = await (0, quiz_repository_1.findQuizById)(quizId);
    if (!current)
        throw new ApiError_1.default('Quiz không tồn tại', 404);
    (0, quiz_validation_1.finalizeQuizUpdateAnswers)(payload, Number(current.quiz_type), current.ans);
    try {
        return normalizeQuizResult(await (0, quiz_repository_1.updateQuiz)(quizId, payload));
    }
    catch (error) {
        return translatePersistenceError(error);
    }
};
exports.updateExistingQuiz = updateExistingQuiz;
const disableExistingQuiz = async (quizId) => {
    const current = await (0, quiz_repository_1.findQuizById)(quizId);
    if (!current)
        throw new ApiError_1.default('Quiz không tồn tại', 404);
    if (current.quiz_status === 'disable')
        throw new ApiError_1.default('Quiz đã bị vô hiệu hóa', 409);
    return normalizeQuizResult(await (0, quiz_repository_1.setQuizStatus)(quizId, 'disable'));
};
exports.disableExistingQuiz = disableExistingQuiz;
const restoreExistingQuiz = async (quizId) => {
    const current = await (0, quiz_repository_1.findQuizById)(quizId);
    if (!current)
        throw new ApiError_1.default('Quiz không tồn tại', 404);
    if (current.quiz_status !== 'disable')
        throw new ApiError_1.default('Quiz chưa bị vô hiệu hóa', 409);
    // Giữ tương thích endpoint activate của runtime cũ.
    return normalizeQuizResult(await (0, quiz_repository_1.setQuizStatus)(quizId, 'done'));
};
exports.restoreExistingQuiz = restoreExistingQuiz;
const bulkUpdateExistingQuizzes = async (payload) => {
    const existing = await (0, quiz_repository_1.findQuizzesByIds)(payload.quiz_ids);
    if (existing.length !== payload.quiz_ids.length)
        throw new ApiError_1.default('Có quiz không tồn tại', 404);
    const result = await (0, quiz_repository_1.bulkUpdateQuizzes)(payload);
    return (0, serializer_1.serializeBigInt)(result.map(normalizeQuiz));
};
exports.bulkUpdateExistingQuizzes = bulkUpdateExistingQuizzes;
const reorderExistingQuizzes = async (payload) => {
    const existing = await (0, quiz_repository_1.findEnabledQuizzesByGroup)(payload.code, payload.learn_number);
    const currentIds = existing.map((quiz) => quiz.quiz_id);
    if (currentIds.length !== payload.ordered_quiz_ids.length) {
        throw new ApiError_1.default('Danh sách sắp xếp phải bao gồm toàn bộ quiz đang hoạt động trong lớp và buổi học', 400);
    }
    const currentSet = new Set(currentIds);
    if (payload.ordered_quiz_ids.some((id) => !currentSet.has(id))) {
        throw new ApiError_1.default('Danh sách sắp xếp chứa quiz không thuộc lớp hoặc buổi học', 400);
    }
    return (0, serializer_1.serializeBigInt)((await (0, quiz_repository_1.reorderQuizzes)(payload)).map(normalizeQuiz));
};
exports.reorderExistingQuizzes = reorderExistingQuizzes;
const exportQuizzes = async (query, filterVisible = async (rows) => rows) => {
    const rows = await (0, quiz_repository_1.findQuizzesForExport)(query, query.quiz_ids);
    const visibleRows = await filterVisible(rows.map(normalizeQuiz));
    const buffer = (0, quiz_io_1.buildQuizExportBuffer)(visibleRows, query.format);
    return {
        buffer,
        contentType: (0, quiz_io_1.getQuizExportContentType)(query.format),
        filename: `quizzes-export-${Date.now()}.${query.format}`,
    };
};
exports.exportQuizzes = exportQuizzes;
const getQuizImportTemplate = (format) => ({
    buffer: (0, quiz_io_1.buildQuizTemplateBuffer)(format),
    contentType: (0, quiz_io_1.getQuizExportContentType)(format),
    filename: `quizzes-import-template.${format}`,
});
exports.getQuizImportTemplate = getQuizImportTemplate;
const importQuizRows = async (rows, mode, creator) => {
    const normalized = rows.map((row) => ({
        ...row,
        quiz_id: row.quiz_id ?? (0, crypto_1.randomUUID)(),
        creator,
    }));
    try {
        return await (0, quiz_repository_1.importQuizzes)(normalized, mode);
    }
    catch (error) {
        return translatePersistenceError(error);
    }
};
exports.importQuizRows = importQuizRows;
const getQuizSubmissions = async (quizId, query) => {
    await (0, exports.getQuizDetail)(quizId);
    return (0, serializer_1.serializeBigInt)(await (0, quiz_repository_1.findQuizSubmissions)(quizId, query));
};
exports.getQuizSubmissions = getQuizSubmissions;
const getExistingQuizAnalytics = async (quizId) => {
    await (0, exports.getQuizDetail)(quizId);
    return (0, serializer_1.serializeBigInt)(await (0, quiz_repository_1.getQuizAnalytics)(quizId));
};
exports.getExistingQuizAnalytics = getExistingQuizAnalytics;
