export const QUIZ_TYPES = [1, 2, 3] as const;
export const QUIZ_SCORE_TYPES = [1, 2] as const;
export const QUIZ_STATUSES = ['done', 'disable'] as const;

export const QUIZ_TYPE_OPTIONS = [
  { value: 1, label: 'Trắc nghiệm' },
  { value: 2, label: 'Điền từ' },
  { value: 3, label: 'Trả lời ngắn' },
];

export const QUIZ_SCORE_TYPE_OPTIONS = [
  { value: 1, label: 'Tính điểm toàn câu' },
  { value: 2, label: 'Tính điểm theo ý' },
];

export const QUIZ_STATUS_OPTIONS = [
  { value: 'done', label: 'Đã hoàn thiện' },
  { value: 'disable', label: 'Đã vô hiệu hóa' },
];

export const QUIZ_DURATION_MIN_SECONDS = 1;
export const QUIZ_DURATION_MAX_SECONDS = 3600;
export const QUIZ_IMPORT_MAX_ROWS = 5000;
export const QUIZ_BULK_MAX_ITEMS = 500;

export const QUIZ_MUTABLE_FIELDS = [
  'code',
  'learn_number',
  'quiz_type',
  'quiz_name',
  'ans',
  'score_type',
  'ans_duration',
  'quiz_status',
  'quiz_index',
] as const;

export const QUIZ_BULK_MUTABLE_FIELDS = [
  'score_type',
  'ans_duration',
  'quiz_status',
] as const;
