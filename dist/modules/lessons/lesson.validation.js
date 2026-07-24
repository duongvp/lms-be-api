"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLessonImportRows = exports.validateLessonReorderPayload = exports.validateLessonBulkUpdatePayload = exports.validateLessonPayload = exports.validateLessonId = exports.validateLessonExportQuery = exports.validateLessonListQuery = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const lesson_constants_1 = require("./lesson.constants");
const SORTABLE_FIELDS = new Set([
    'id',
    'grade',
    'subject_code',
    'subject_name',
    'learn_number',
    'lesson_name',
    'status',
    'created_at',
    'updated_at',
]);
const stringOrUndefined = (value) => {
    if (Array.isArray(value) || typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};
const optionalInteger = (value, fieldName) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new ApiError_1.default(`${fieldName} không hợp lệ`, 400);
    }
    return parsed;
};
const requiredInteger = (value, fieldName) => {
    const parsed = optionalInteger(value, fieldName);
    if (parsed === undefined) {
        throw new ApiError_1.default(`Vui lòng cung cấp ${fieldName}`, 400);
    }
    return parsed;
};
const requiredString = (value, fieldName, maxLength) => {
    const parsed = stringOrUndefined(value);
    if (!parsed) {
        throw new ApiError_1.default(`Vui lòng cung cấp ${fieldName}`, 400);
    }
    if (parsed.length > maxLength) {
        throw new ApiError_1.default(`${fieldName} không được vượt quá ${maxLength} ký tự`, 400);
    }
    return parsed;
};
const optionalString = (value, fieldName, maxLength) => {
    const parsed = stringOrUndefined(value);
    if (!parsed)
        return null;
    if (parsed.length > maxLength) {
        throw new ApiError_1.default(`${fieldName} không được vượt quá ${maxLength} ký tự`, 400);
    }
    return parsed;
};
const valueToString = (value) => {
    if (value === undefined || value === null)
        return undefined;
    const trimmed = String(value).trim();
    return trimmed || undefined;
};
const optionalImportText = (value, maxLength) => {
    const parsed = valueToString(value);
    if (!parsed)
        return null;
    return parsed.length > maxLength ? parsed.slice(0, maxLength) : parsed;
};
const validateLessonListQuery = (query) => {
    const page = optionalInteger(query.page, 'page') ?? 1;
    const limit = optionalInteger(query.limit, 'limit') ?? 10;
    if (page < 1)
        throw new ApiError_1.default('page phải lớn hơn 0', 400);
    if (limit < 1 || limit > 100)
        throw new ApiError_1.default('limit phải nằm trong khoảng 1-100', 400);
    const sortBy = stringOrUndefined(query.sort_by);
    const sortOrder = stringOrUndefined(query.sort_order);
    const courseCode = stringOrUndefined(query.course_code);
    if (sortBy && !SORTABLE_FIELDS.has(sortBy)) {
        throw new ApiError_1.default('sort_by không hợp lệ', 400);
    }
    if (courseCode && courseCode.length > 30) {
        throw new ApiError_1.default('course_code không được vượt quá 30 ký tự', 400);
    }
    return {
        page,
        limit,
        grade: optionalInteger(query.grade, 'grade'),
        subject_code: stringOrUndefined(query.subject_code),
        subject: stringOrUndefined(query.subject),
        learn_number: optionalInteger(query.learn_number, 'learn_number'),
        keyword: stringOrUndefined(query.keyword),
        course_code: courseCode,
        status: optionalInteger(query.status, 'status'),
        sort_by: sortBy,
        sort_order: sortOrder === 'desc' || sortOrder === 'descend' ? 'desc' : 'asc',
    };
};
exports.validateLessonListQuery = validateLessonListQuery;
const validateLessonExportQuery = (query) => {
    const listQuery = (0, exports.validateLessonListQuery)({ ...query, page: 1, limit: 100 });
    const format = stringOrUndefined(query.format) ?? 'xlsx';
    if (format !== 'xlsx' && format !== 'csv') {
        throw new ApiError_1.default('format chỉ hỗ trợ xlsx hoặc csv', 400);
    }
    const idsText = stringOrUndefined(query.ids);
    const ids = idsText
        ? idsText.split(',').map((item) => (0, exports.validateLessonId)(item.trim()))
        : undefined;
    return {
        ...listQuery,
        format,
        ids,
    };
};
exports.validateLessonExportQuery = validateLessonExportQuery;
const validateLessonId = (value) => {
    const parsed = requiredInteger(value, 'id');
    if (parsed <= 0)
        throw new ApiError_1.default('id không hợp lệ', 400);
    return BigInt(parsed);
};
exports.validateLessonId = validateLessonId;
const validateLessonIds = (value) => {
    if (!Array.isArray(value) || value.length === 0) {
        throw new ApiError_1.default('Vui lòng chọn bài học cần cập nhật', 400);
    }
    return value.map((item) => (0, exports.validateLessonId)(item));
};
const validateLessonPayload = (body, isUpdate = false) => {
    const payload = {};
    if (!isUpdate || body.grade !== undefined)
        payload.grade = requiredInteger(body.grade, 'grade');
    if (!isUpdate || body.subject_name !== undefined) {
        const subjectName = requiredString(body.subject_name, 'subject_name', 100);
        const subject = (0, lesson_constants_1.resolveSubject)(subjectName);
        if (!subject)
            throw new ApiError_1.default('Môn học không hợp lệ', 400);
        payload.subject_name = subject.subject_name;
        payload.subject_code = subject.subject_code;
    }
    if (body.learn_number !== undefined)
        payload.learn_number = requiredInteger(body.learn_number, 'learn_number');
    if (!isUpdate || body.lesson_name !== undefined)
        payload.lesson_name = requiredString(body.lesson_name, 'lesson_name', 400);
    if (body.lesson_document !== undefined)
        payload.lesson_document = optionalString(body.lesson_document, 'lesson_document', 500);
    if (body.lesson_baitap !== undefined)
        payload.lesson_baitap = optionalString(body.lesson_baitap, 'lesson_baitap', 500);
    if (body.lesson_tomtat !== undefined)
        payload.lesson_tomtat = optionalString(body.lesson_tomtat, 'lesson_tomtat', 500);
    if (body.lesson_phuongphap !== undefined)
        payload.lesson_phuongphap = optionalString(body.lesson_phuongphap, 'lesson_phuongphap', 500);
    if (body.lesson_luuy !== undefined)
        payload.lesson_luuy = optionalString(body.lesson_luuy, 'lesson_luuy', 500);
    if (body.lesson_ketqua !== undefined)
        payload.lesson_ketqua = optionalString(body.lesson_ketqua, 'lesson_ketqua', 500);
    if (body.status !== undefined) {
        const status = requiredInteger(body.status, 'status');
        if (![0, 1].includes(status))
            throw new ApiError_1.default('status không hợp lệ', 400);
        payload.status = status;
    }
    if (payload.grade !== undefined && (payload.grade < 1 || payload.grade > 12)) {
        throw new ApiError_1.default('grade phải nằm trong khoảng 1-12', 400);
    }
    if (payload.learn_number !== undefined && payload.learn_number <= 0) {
        throw new ApiError_1.default('learn_number phải lớn hơn 0', 400);
    }
    if (isUpdate && Object.keys(payload).length === 0) {
        throw new ApiError_1.default('Không có dữ liệu cập nhật', 400);
    }
    return payload;
};
exports.validateLessonPayload = validateLessonPayload;
const validateLessonBulkUpdatePayload = (body) => {
    const ids = validateLessonIds(body.ids);
    const payload = (0, exports.validateLessonPayload)(body.data ?? {}, true);
    delete payload.learn_number;
    delete payload.lesson_name;
    if (Object.keys(payload).length === 0) {
        throw new ApiError_1.default('Vui lòng chọn ít nhất một trường cần cập nhật', 400);
    }
    return { ids, data: payload };
};
exports.validateLessonBulkUpdatePayload = validateLessonBulkUpdatePayload;
const validateLessonReorderPayload = (body) => {
    const grade = requiredInteger(body.grade, 'grade');
    if (grade < 1 || grade > 12)
        throw new ApiError_1.default('grade phải nằm trong khoảng 1-12', 400);
    const subjectName = requiredString(body.subject_name, 'subject_name', 100);
    const subjectCode = (0, lesson_constants_1.resolveSubjectCode)(subjectName);
    if (!subjectCode)
        throw new ApiError_1.default('Môn học không hợp lệ', 400);
    const orderedIds = validateLessonIds(body.ordered_ids);
    const mode = stringOrUndefined(body.mode) ?? 'insert';
    if (mode !== 'insert' && mode !== 'swap') {
        throw new ApiError_1.default('mode chỉ hỗ trợ insert hoặc swap', 400);
    }
    return {
        grade,
        subject_name: subjectName,
        subject_code: subjectCode,
        mode,
        ordered_ids: orderedIds,
    };
};
exports.validateLessonReorderPayload = validateLessonReorderPayload;
const validateLessonImportRows = (rows) => {
    const errors = [];
    const validRows = [];
    const seenKeys = new Set();
    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const addError = (field, message) => errors.push({ row: rowNumber, field, message });
        const grade = optionalInteger(row.grade, 'grade');
        if (grade === undefined)
            addError('grade', 'Vui lòng cung cấp Grade');
        if (grade !== undefined && (grade < 1 || grade > 12))
            addError('grade', 'Grade phải nằm trong khoảng 1-12');
        const subjectName = valueToString(row.subject_name);
        if (!subjectName)
            addError('subject_name', 'Vui lòng cung cấp Subject');
        const subject = subjectName ? (0, lesson_constants_1.resolveSubject)(subjectName) : undefined;
        if (subjectName && !subject)
            addError('subject_name', 'Subject không hợp lệ');
        const learnNumber = optionalInteger(row.learn_number, 'learn_number');
        if (learnNumber !== undefined && learnNumber <= 0)
            addError('learn_number', 'Learn Number phải lớn hơn 0');
        const lessonName = valueToString(row.lesson_name);
        if (!lessonName)
            addError('lesson_name', 'Vui lòng cung cấp Lesson Name');
        if (lessonName && lessonName.length > 400)
            addError('lesson_name', 'Lesson Name không được vượt quá 400 ký tự');
        const status = row.status === undefined || row.status === null || row.status === ''
            ? 1
            : optionalInteger(row.status, 'status');
        if (status !== undefined && ![0, 1].includes(status))
            addError('status', 'Status chỉ nhận 0 hoặc 1');
        if (grade !== undefined && subject && learnNumber !== undefined) {
            const key = `${grade}|${subject.subject_code}|${learnNumber}`;
            if (seenKeys.has(key))
                addError('learn_number', 'Trùng Grade + Subject + Learn Number trong file import');
            seenKeys.add(key);
        }
        if (grade !== undefined &&
            grade >= 1 &&
            grade <= 12 &&
            subjectName &&
            subject &&
            lessonName &&
            lessonName.length <= 400 &&
            (learnNumber === undefined || learnNumber > 0) &&
            status !== undefined &&
            [0, 1].includes(status)) {
            validRows.push({
                row_number: rowNumber,
                grade,
                subject_code: subject.subject_code,
                subject_name: subject.subject_name,
                learn_number: learnNumber,
                lesson_name: lessonName,
                lesson_document: optionalImportText(row.lesson_document, 500),
                lesson_baitap: optionalImportText(row.lesson_baitap, 500),
                lesson_tomtat: optionalImportText(row.lesson_tomtat, 500),
                lesson_phuongphap: optionalImportText(row.lesson_phuongphap, 500),
                lesson_luuy: optionalImportText(row.lesson_luuy, 500),
                lesson_ketqua: optionalImportText(row.lesson_ketqua, 500),
                status,
            });
        }
    });
    return { validRows, errors };
};
exports.validateLessonImportRows = validateLessonImportRows;
