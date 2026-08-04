import { QUIZ_SCORE_TYPES, QUIZ_STATUSES, QUIZ_TYPES } from './quiz.constants';

export type QuizType = typeof QUIZ_TYPES[number];
export type QuizScoreType = typeof QUIZ_SCORE_TYPES[number];
export type QuizStatus = typeof QUIZ_STATUSES[number];
export type QuizExportFormat = 'csv' | 'xlsx';
export type QuizImportMode = 'skip' | 'overwrite';

export type QuizAnswerItem = Record<string, string | boolean | number>;

export interface QuizPayload {
  code: string;
  learn_number: number;
  quiz_type: QuizType;
  quiz_name: string;
  ans: QuizAnswerItem[];
  score_type: QuizScoreType;
  ans_duration: number;
  quiz_status: QuizStatus;
  quiz_index: number;
}

export interface QuizCreatePayload extends QuizPayload {
  quiz_id?: string;
}

export interface QuizListQuery {
  page?: number;
  limit?: number;
  code?: string;
  learn_number?: number;
  quiz_type?: QuizType;
  score_type?: QuizScoreType;
  quiz_status?: QuizStatus;
  keyword?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface QuizExportQuery extends QuizListQuery {
  format: QuizExportFormat;
  quiz_ids?: string[];
}

export interface QuizBulkUpdatePayload {
  quiz_ids: string[];
  data: Partial<Pick<QuizPayload, 'score_type' | 'ans_duration' | 'quiz_status'>>;
}

export interface QuizReorderPayload {
  code: string;
  learn_number: number;
  ordered_quiz_ids: string[];
}

export interface QuizIndexSuggestionQuery {
  code: string;
  learn_number: number;
  quiz_index?: number;
  exclude_quiz_id?: string;
}

export interface QuizClassOption {
  code: string;
  subject_name?: string | null;
  lesson_count: number;
}

export interface QuizLessonOption {
  lesson_id?: string | null;
  learn_number: number;
  lesson_name: string;
  subject_name?: string | null;
  grade?: number | null;
}

export interface QuizImportRow extends QuizCreatePayload {
  row_number: number;
}

export interface QuizImportValidationError {
  row: number;
  field?: string;
  message: string;
}

export interface QuizImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface QuizSubmissionQuery {
  page: number;
  limit: number;
  username?: string;
  class_id?: string;
  latest: boolean;
  sort_order: 'asc' | 'desc';
}
