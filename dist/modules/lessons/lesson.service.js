"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importLessonRows = exports.validateLessonImportSequence = exports.getLessonImportTemplate = exports.exportLessons = exports.reorderExistingLessons = exports.bulkUpdateExistingLessons = exports.deleteExistingLesson = exports.updateExistingLesson = exports.createNewProgram = exports.createNewLesson = exports.getLessonDetail = exports.changeLessonCourseMappings = exports.getCourseMappingsByProgram = exports.getLessonPrograms = exports.getLessonSubjects = exports.getLessons = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const serializer_1 = require("../../lib/serializer");
const lesson_repository_1 = require("./lesson.repository");
const lesson_constants_1 = require("./lesson.constants");
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const lesson_io_1 = require("./lesson.io");
const getLessons = async (query) => {
    const result = await (0, lesson_repository_1.findLessons)(query);
    return (0, serializer_1.serializeBigInt)(result);
};
exports.getLessons = getLessons;
const getLessonSubjects = async () => {
    const databaseSubjects = await (0, lesson_repository_1.findLessonSubjectOptions)();
    const seen = new Set();
    return [...lesson_constants_1.SUBJECT_OPTIONS, ...databaseSubjects]
        .filter((subject) => {
        const key = (0, lesson_constants_1.normalizeSubject)(subject.subject_name);
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .map((subject) => ({
        subject_name: String(subject.subject_name).trim(),
        subject_code: String(subject.subject_code).trim(),
    }));
};
exports.getLessonSubjects = getLessonSubjects;
const getLessonPrograms = async (allowedPrograms = null) => ((0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.findLessonProgramOptions)(allowedPrograms)));
exports.getLessonPrograms = getLessonPrograms;
const getCourseMappingsByProgram = async (programCode) => ((0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.findLessonCourseMappings)(programCode)));
exports.getCourseMappingsByProgram = getCourseMappingsByProgram;
const changeLessonCourseMappings = async (payload) => {
    if (payload.action === 'add') {
        const sheetRows = await (0, package_course_sheet_service_1.resolvePackagesByCourseId)(payload.course_id);
        if (!sheetRows.some((row) => row.package_id === payload.package_id)) {
            throw new ApiError_1.default(`Package ID ${payload.package_id} không thuộc Course ID ${payload.course_id} trong PACKAGE_COURSE_SHEET_URL`, 400);
        }
    }
    return (0, lesson_repository_1.updateLessonCourseMappings)({
        programCode: payload.program_code,
        action: payload.action,
        packageId: payload.package_id,
        courseId: payload.course_id,
        lessonIds: payload.lesson_ids,
    });
};
exports.changeLessonCourseMappings = changeLessonCourseMappings;
const getLessonDetail = async (id) => {
    const lesson = await (0, lesson_repository_1.findLessonById)(id);
    if (!lesson)
        throw new ApiError_1.default('Lesson not found', 404);
    return (0, serializer_1.serializeBigInt)(lesson);
};
exports.getLessonDetail = getLessonDetail;
const createNewLesson = async (payload) => {
    if (payload.learn_number !== undefined) {
        const existing = await (0, lesson_repository_1.findLessonByIdentity)(payload.grade, payload.subject_code, payload.learn_number);
        if (existing) {
            throw new ApiError_1.default('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
        }
    }
    try {
        return (0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.createLesson)(payload));
    }
    catch (error) {
        if (String(error?.message ?? '').includes('Duplicate entry') || error?.code === 'P2010') {
            throw new ApiError_1.default('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
        }
        throw error;
    }
};
exports.createNewLesson = createNewLesson;
const createNewProgram = async (payload) => {
    if (!/^[A-Za-z0-9_-]+$/.test(payload.subject_code)) {
        throw new ApiError_1.default('Mã Chương trình chỉ được dùng chữ không dấu, số, dấu gạch ngang hoặc gạch dưới', 400);
    }
    const existingProgram = await (0, lesson_repository_1.findLessonProgramByCode)(payload.subject_code);
    if (existingProgram) {
        throw new ApiError_1.default(`Chương trình ${payload.subject_code} đã tồn tại`, 409);
    }
    const firstLesson = await (0, exports.createNewLesson)({
        ...payload,
        learn_number: 1,
    });
    return {
        grade: payload.grade,
        subject_code: payload.subject_code,
        subject_name: payload.subject_name,
        first_lesson: firstLesson,
    };
};
exports.createNewProgram = createNewProgram;
const updateExistingLesson = async (id, payload) => {
    const current = await (0, lesson_repository_1.findLessonById)(id);
    if (!current)
        throw new ApiError_1.default('Lesson not found', 404);
    const lockedIds = await (0, lesson_repository_1.findPastScheduledLessonIds)([id]);
    if (lockedIds.has(String(id))) {
        throw new ApiError_1.default('Không thể chỉnh sửa bài học đã được dạy', 409);
    }
    if (payload.grade !== undefined && Number(payload.grade) !== Number(current.grade)) {
        throw new ApiError_1.default('Không thể thay đổi khối khi cập nhật bài học', 400);
    }
    if (payload.subject_name !== undefined
        && String(payload.subject_name).trim() !== String(current.subject_name).trim()) {
        throw new ApiError_1.default('Không thể thay đổi môn học khi cập nhật bài học', 400);
    }
    if (payload.subject_code !== undefined
        && String(payload.subject_code).trim() !== String(current.subject_code).trim()) {
        throw new ApiError_1.default('Không thể thay đổi mã môn học hoặc năm học khi cập nhật bài học', 400);
    }
    const grade = payload.grade ?? current.grade;
    const subjectCode = payload.subject_code ?? current.subject_code;
    const learnNumber = payload.learn_number ?? current.learn_number;
    const existing = await (0, lesson_repository_1.findLessonByIdentity)(grade, subjectCode, learnNumber, id);
    if (existing) {
        throw new ApiError_1.default('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
    }
    return (0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.updateLesson)(id, payload));
};
exports.updateExistingLesson = updateExistingLesson;
const deleteExistingLesson = async (id) => {
    const result = await (0, lesson_repository_1.deleteLessonIfUnscheduled)(id);
    if (!result.lesson)
        throw new ApiError_1.default('Bài học không tồn tại hoặc đã bị xóa', 404);
    if (result.scheduledCount > 0) {
        throw new ApiError_1.default(`Không thể xóa bài học vì đang được gán cho ${result.scheduledCount} lịch học`, 409);
    }
    return (0, serializer_1.serializeBigInt)(result.lesson);
};
exports.deleteExistingLesson = deleteExistingLesson;
const bulkUpdateExistingLessons = async ({ ids, data }) => {
    const lessons = await Promise.all(ids.map((id) => (0, lesson_repository_1.findLessonById)(id)));
    if (lessons.some((lesson) => !lesson)) {
        throw new ApiError_1.default('Có bài học không tồn tại hoặc đã bị xóa', 404);
    }
    const lockedIds = await (0, lesson_repository_1.findPastScheduledLessonIds)(ids);
    if (lockedIds.size) {
        throw new ApiError_1.default('Không thể chỉnh sửa hàng loạt khi có bài học đã được dạy', 409);
    }
    return (0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.bulkUpdateLessons)(ids, data));
};
exports.bulkUpdateExistingLessons = bulkUpdateExistingLessons;
const reorderExistingLessons = async (payload) => {
    const lessons = await (0, lesson_repository_1.findLessonsByGroup)(payload.grade, payload.subject_code);
    const activeIds = lessons.map((lesson) => String(lesson.id));
    const orderedIds = payload.ordered_ids.map((id) => String(id));
    if (activeIds.length !== orderedIds.length) {
        throw new ApiError_1.default('Danh sách sắp xếp phải bao gồm toàn bộ bài học trong khối và môn học đã chọn', 400);
    }
    const activeIdSet = new Set(activeIds);
    const orderedIdSet = new Set(orderedIds);
    if (activeIdSet.size !== orderedIdSet.size || orderedIds.some((id) => !activeIdSet.has(id))) {
        throw new ApiError_1.default('Danh sách sắp xếp không hợp lệ', 400);
    }
    const learnNumbers = lessons.map((lesson) => Number(lesson.learn_number));
    const lockedIds = await (0, lesson_repository_1.findPastScheduledLessonIds)(payload.ordered_ids);
    const lessonById = new Map(lessons.map((lesson) => [String(lesson.id), lesson]));
    const movedLockedLesson = orderedIds.some((id, index) => (lockedIds.has(id)
        && Number(lessonById.get(id)?.learn_number) !== learnNumbers[index]));
    if (movedLockedLesson) {
        throw new ApiError_1.default('Không thể sắp xếp lại bài học đã diễn ra trong quá khứ', 409);
    }
    return (0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.reorderLessonsInGroup)(payload.grade, payload.subject_code, payload.ordered_ids, learnNumbers));
};
exports.reorderExistingLessons = reorderExistingLessons;
const exportLessons = async (query) => {
    const rows = await (0, lesson_repository_1.findLessonsForExport)(query);
    const buffer = (0, lesson_io_1.buildLessonExportBuffer)((0, serializer_1.serializeBigInt)(rows), query.format);
    const extension = query.format;
    return {
        buffer,
        contentType: (0, lesson_io_1.getLessonExportContentType)(query.format),
        filename: `lessons-export-${Date.now()}.${extension}`,
    };
};
exports.exportLessons = exportLessons;
const getLessonImportTemplate = (format) => ({
    buffer: (0, lesson_io_1.buildLessonTemplateBuffer)(format),
    contentType: (0, lesson_io_1.getLessonExportContentType)(format),
    filename: `lessons-import-template.${format}`,
});
exports.getLessonImportTemplate = getLessonImportTemplate;
const findFirstMissingLearnNumber = (learnNumbers) => {
    let expected = 1;
    while (learnNumbers.has(expected))
        expected += 1;
    return expected;
};
const validateLessonImportSequence = async (rows, mode) => {
    const errors = [];
    const rowsByGroup = new Map();
    rows.forEach((row) => {
        const key = `${row.grade}|${row.subject_code}`;
        rowsByGroup.set(key, [...(rowsByGroup.get(key) ?? []), row]);
    });
    for (const groupRows of rowsByGroup.values()) {
        const firstRow = groupRows[0];
        const existingLessons = await (0, lesson_repository_1.findLessonsByGroup)(firstRow.grade, firstRow.subject_code);
        const activeLearnNumbers = new Set(existingLessons.map((lesson) => Number(lesson.learn_number)));
        const simulatedLearnNumbers = new Set(activeLearnNumbers);
        for (const row of groupRows) {
            const groupLabel = `${row.subject_name} lớp ${row.grade}`;
            if (row.learn_number === undefined) {
                const nextNumber = findFirstMissingLearnNumber(simulatedLearnNumbers);
                if (row.status !== 0)
                    simulatedLearnNumbers.add(nextNumber);
                continue;
            }
            if (activeLearnNumbers.has(row.learn_number)) {
                if (mode === 'overwrite' && row.status === 0) {
                    simulatedLearnNumbers.delete(row.learn_number);
                }
                continue;
            }
            const expectedNumber = findFirstMissingLearnNumber(simulatedLearnNumbers);
            if (row.learn_number !== expectedNumber) {
                errors.push({
                    row: row.row_number,
                    field: 'learn_number',
                    message: `${groupLabel} đang thiếu Bài ${expectedNumber}; không thể import trực tiếp Bài ${row.learn_number}. Hãy để trống Learn Number để hệ thống tự đánh số hoặc import đủ thứ tự.`,
                });
                continue;
            }
            if (row.status !== 0)
                simulatedLearnNumbers.add(row.learn_number);
        }
    }
    return errors;
};
exports.validateLessonImportSequence = validateLessonImportSequence;
const importLessonRows = async (rows, mode) => {
    if (!rows.length) {
        throw new ApiError_1.default('File import không có dữ liệu', 400);
    }
    return (0, serializer_1.serializeBigInt)(await (0, lesson_repository_1.importLessons)(rows, mode));
};
exports.importLessonRows = importLessonRows;
