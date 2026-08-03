"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSubjectCode = exports.resolveSubject = exports.normalizeSubject = exports.SUBJECT_OPTIONS = void 0;
exports.SUBJECT_OPTIONS = [
    { subject_name: 'Toán', subject_code: 'TOAN' },
    { subject_name: 'Ngữ văn', subject_code: 'VAN' },
    { subject_name: 'Tiếng Anh', subject_code: 'ANH' },
    { subject_name: 'Vật lý', subject_code: 'LY' },
    { subject_name: 'Hóa học', subject_code: 'HOA' },
    { subject_name: 'Sinh học', subject_code: 'SINH' },
    { subject_name: 'Lịch sử', subject_code: 'SU' },
    { subject_name: 'Địa lý', subject_code: 'DIA' },
    { subject_name: 'GDCD', subject_code: 'GDCD' },
    { subject_name: 'Tin học', subject_code: 'TIN' },
    { subject_name: 'Công nghệ', subject_code: 'CONGNGHE' },
];
const normalizeSubject = (value) => value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/^(mon|subject)\s+/i, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('vi-VN');
exports.normalizeSubject = normalizeSubject;
const levenshteinDistance = (source, target) => {
    const matrix = Array.from({ length: source.length + 1 }, (_, index) => [index]);
    for (let index = 1; index <= target.length; index += 1)
        matrix[0][index] = index;
    for (let row = 1; row <= source.length; row += 1) {
        for (let col = 1; col <= target.length; col += 1) {
            const cost = source[row - 1] === target[col - 1] ? 0 : 1;
            matrix[row][col] = Math.min(matrix[row - 1][col] + 1, matrix[row][col - 1] + 1, matrix[row - 1][col - 1] + cost);
        }
    }
    return matrix[source.length][target.length];
};
const resolveSubject = (subjectName) => {
    const normalized = (0, exports.normalizeSubject)(subjectName);
    const exact = exports.SUBJECT_OPTIONS.find((subject) => ((0, exports.normalizeSubject)(subject.subject_name) === normalized ||
        (0, exports.normalizeSubject)(subject.subject_code) === normalized));
    if (exact)
        return exact;
    const fuzzyMatches = exports.SUBJECT_OPTIONS.filter((subject) => {
        const normalizedName = (0, exports.normalizeSubject)(subject.subject_name);
        return normalized.length >= 3 && levenshteinDistance(normalized, normalizedName) <= 1;
    });
    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined;
};
exports.resolveSubject = resolveSubject;
const resolveSubjectCode = (subjectName) => {
    return (0, exports.resolveSubject)(subjectName)?.subject_code;
};
exports.resolveSubjectCode = resolveSubjectCode;
