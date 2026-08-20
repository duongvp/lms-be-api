export type CalendarImportErrorCode =
  | 'INVALID_PACKAGE_ID'
  | 'INVALID_COURSE_ID'
  | 'INVALID_LESSON_ID'
  | 'PACKAGE_NOT_FOUND'
  | 'COURSE_NOT_FOUND'
  | 'LESSON_NOT_FOUND'
  | 'LESSON_NOT_IN_PACKAGE_COURSE'
  | 'DUPLICATE_SCHEDULE_IN_FILE'
  | 'DUPLICATE_SCHEDULE_IN_DATABASE'
  | 'HMO_BATCH_ERROR'
  | 'HMO_TIMEOUT'
  | 'HMO_INVALID_RESPONSE'
  | 'INVALID_ROW';

export type CalendarImportError = {
  row: number;
  field: string;
  errorCode: CalendarImportErrorCode;
  message: string;
  packageId?: string;
  courseId?: string;
  lessonId?: string;
  duplicateWithRow?: number;
};

export type CalendarImportRow = {
  row: number;
  sourceFormat: 'direct' | 'operational';
  sourceKey?: string;
  packageIds: string[];
  courseIds: string[];
  lessonIds: string[];
  calendar: {
    system_type: 'topclass' | 'topuni';
    code: string;
    learn_number: number;
    subject?: string;
    teacher?: string;
    assistant_teacher?: string;
    lesson_name?: string;
    lesson_document?: string;
    lesson_baitap?: string;
    start_time: string;
    end_time: string;
    lesson_status: number;
    session_id?: bigint;
    lesson_count?: number;
    evg_banner?: string;
    evg_stream?: string;
    skip_teacher_profile_validation?: boolean;
  };
};

export type HmoCourseOutlineLesson = {
  /** HMO lesson ID from `course.sections[].lessons[]`. */
  lessonId: string;
  name?: string;
};

export type HmoCourseOutlineResult = {
  packageId: string;
  courseId: string;
  exists: boolean;
  lessons: HmoCourseOutlineLesson[];
};

export type ResolvedPackageLessonMapping = {
  package_id: string;
  course_id: string;
  lesson_id: string;
};

export type ResolvedCalendarImportRow = CalendarImportRow & {
  mappings: ResolvedPackageLessonMapping[];
};

export type CalendarImportSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  successRows?: number;
  failedRows?: number;
  unchangedRows?: number;
  uniquePackageIds: number;
  uniqueCourseIds: number;
  uniqueLessonIds: number;
  uniquePackageCoursePairs: number;
  hmoRequests: number;
};
