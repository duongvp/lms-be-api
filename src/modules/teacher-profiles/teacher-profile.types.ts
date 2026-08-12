export const STREAM_KEY_ACCESS = {
  TEACHER: 1,
  TEACHING_ASSISTANT: 0,
} as const;

export type CanViewStreamKey = typeof STREAM_KEY_ACCESS[keyof typeof STREAM_KEY_ACCESS];

export type TeacherProfilePayload = {
  username?: string;
  display_name?: string | null;
  can_view_stream_key?: CanViewStreamKey;
  status?: 0 | 1;
};

export type TeacherProfileListQuery = {
  page: number;
  limit: number;
  search?: string;
  can_view_stream_key?: CanViewStreamKey;
  status?: 0 | 1;
};

export type TeacherProfileImportMode = 'skip' | 'overwrite';

export type TeacherProfileImportRow = {
  row: number;
  username: string;
  display_name: string | null;
  can_view_stream_key: CanViewStreamKey;
  status: 0 | 1;
};

export type TeacherProfileImportError = {
  row: number;
  field: string;
  message: string;
};
