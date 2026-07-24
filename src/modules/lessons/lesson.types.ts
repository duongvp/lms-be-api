export interface LessonListQuery {
  page?: number;
  limit?: number;
  grade?: number;
  subject_code?: string;
  subject?: string;
  learn_number?: number;
  keyword?: string;
  course_code?: string;
  status?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface LessonPayload {
  grade: number;
  subject_code: string;
  subject_name: string;
  learn_number?: number;
  lesson_name: string;
  lesson_document?: string | null;
  lesson_baitap?: string | null;
  lesson_tomtat?: string | null;
  lesson_phuongphap?: string | null;
  lesson_luuy?: string | null;
  lesson_ketqua?: string | null;
  status?: number;
}

export interface LessonBulkUpdatePayload {
  ids: bigint[];
  data: Partial<LessonPayload>;
}

export interface LessonReorderPayload {
  grade: number;
  subject_name: string;
  subject_code: string;
  mode: 'insert' | 'swap';
  ordered_ids: bigint[];
}

export type LessonExportFormat = 'csv' | 'xlsx';

export interface LessonExportQuery extends LessonListQuery {
  format: LessonExportFormat;
  ids?: bigint[];
}

export interface LessonImportRow extends LessonPayload {
  row_number: number;
  learn_number?: number;
}

export interface LessonImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export type LessonImportMode = 'overwrite' | 'skip';

export interface LessonImportValidationError {
  row: number;
  field?: string;
  message: string;
}
