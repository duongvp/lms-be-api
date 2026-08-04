"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUIZ_BULK_MUTABLE_FIELDS = exports.QUIZ_MUTABLE_FIELDS = exports.QUIZ_BULK_MAX_ITEMS = exports.QUIZ_IMPORT_MAX_ROWS = exports.QUIZ_DURATION_MAX_SECONDS = exports.QUIZ_DURATION_MIN_SECONDS = exports.QUIZ_STATUS_OPTIONS = exports.QUIZ_SCORE_TYPE_OPTIONS = exports.QUIZ_TYPE_OPTIONS = exports.QUIZ_STATUSES = exports.QUIZ_SCORE_TYPES = exports.QUIZ_TYPES = void 0;
exports.QUIZ_TYPES = [1, 2, 3];
exports.QUIZ_SCORE_TYPES = [1, 2];
exports.QUIZ_STATUSES = ['active', 'done', 'disable'];
exports.QUIZ_TYPE_OPTIONS = [
    { value: 1, label: 'Trắc nghiệm' },
    { value: 2, label: 'Điền từ' },
    { value: 3, label: 'Trả lời ngắn' },
];
exports.QUIZ_SCORE_TYPE_OPTIONS = [
    { value: 1, label: 'Tính điểm toàn câu' },
    { value: 2, label: 'Tính điểm theo ý' },
];
exports.QUIZ_STATUS_OPTIONS = [
    { value: 'active', label: 'Đang hoạt động' },
    { value: 'done', label: 'Đã hoàn thiện' },
    { value: 'disable', label: 'Đã vô hiệu hóa' },
];
exports.QUIZ_DURATION_MIN_SECONDS = 1;
exports.QUIZ_DURATION_MAX_SECONDS = 3600;
exports.QUIZ_IMPORT_MAX_ROWS = 5000;
exports.QUIZ_BULK_MAX_ITEMS = 500;
exports.QUIZ_MUTABLE_FIELDS = [
    'code',
    'learn_number',
    'quiz_type',
    'quiz_name',
    'ans',
    'score_type',
    'ans_duration',
    'quiz_status',
    'quiz_index',
];
exports.QUIZ_BULK_MUTABLE_FIELDS = [
    'score_type',
    'ans_duration',
    'quiz_status',
];
