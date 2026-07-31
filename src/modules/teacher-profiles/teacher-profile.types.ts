export const TEACHER_TYPES = {
  TEACHER: 1,
  TEACHING_ASSISTANT: 2,
} as const;

export type TeacherType = typeof TEACHER_TYPES[keyof typeof TEACHER_TYPES];

export type TeacherProfilePayload = {
  username?: string;
  display_name?: string | null;
  teacher_type?: TeacherType;
  status?: 0 | 1;
};

export type TeacherProfileListQuery = {
  page: number;
  limit: number;
  search?: string;
  teacher_type?: TeacherType;
  status?: 0 | 1;
};

export type TeacherProfileImportMode = 'skip' | 'overwrite';

export type TeacherProfileImportRow = {
  row: number;
  username: string;
  display_name: string | null;
  teacher_type: TeacherType;
  status: 0 | 1;
};

export type TeacherProfileImportError = {
  row: number;
  field: string;
  message: string;
};
