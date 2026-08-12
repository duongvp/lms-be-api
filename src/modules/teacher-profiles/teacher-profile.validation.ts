import ApiError from '../../utils/ApiError';
import {
  STREAM_KEY_ACCESS,
  TeacherProfileListQuery,
  TeacherProfilePayload,
  CanViewStreamKey,
} from './teacher-profile.types';

const parseInteger = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiError(`${field} không hợp lệ`, 400);
  }
  return parsed;
};

const parseString = (value: unknown, field: string, maxLength: number) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ApiError(`${field} không hợp lệ`, 400);
  }
  const parsed = value.trim();
  if (parsed.length > maxLength) {
    throw new ApiError(`${field} không được vượt quá ${maxLength} ký tự`, 400);
  }
  return parsed;
};

const parseCanViewStreamKey = (value: unknown): CanViewStreamKey => {
  const parsed = parseInteger(value, 'can_view_stream_key');
  if (parsed !== STREAM_KEY_ACCESS.TEACHER && parsed !== STREAM_KEY_ACCESS.TEACHING_ASSISTANT) {
    throw new ApiError('can_view_stream_key chỉ nhận giá trị 1 (Giáo viên) hoặc 0 (Trợ giảng)', 400);
  }
  return parsed;
};

const parseStatus = (value: unknown): 0 | 1 => {
  const parsed = parseInteger(value, 'status');
  if (parsed !== 0 && parsed !== 1) {
    throw new ApiError('status chỉ nhận giá trị 0 hoặc 1', 400);
  }
  return parsed;
};

export const validateTeacherProfileId = (value: unknown) => {
  const id = parseInteger(value, 'id');
  if (!id || id <= 0) throw new ApiError('id không hợp lệ', 400);
  return id;
};

export const validateTeacherProfileListQuery = (query: any): TeacherProfileListQuery => {
  const page = parseInteger(query.page, 'page') ?? 1;
  const limit = parseInteger(query.limit, 'limit') ?? 20;
  if (page < 1) throw new ApiError('page phải lớn hơn 0', 400);
  if (limit < 1 || limit > 100) {
    throw new ApiError('limit phải nằm trong khoảng 1-100', 400);
  }

  return {
    page,
    limit,
    search: parseString(query.search, 'search', 120) || undefined,
    can_view_stream_key: query.can_view_stream_key === undefined
      ? undefined
      : parseCanViewStreamKey(query.can_view_stream_key),
    status: query.status === undefined ? undefined : parseStatus(query.status),
  };
};

export const validateTeacherProfilePayload = (
  body: any,
  isUpdate = false
): TeacherProfilePayload => {
  const payload: TeacherProfilePayload = {};

  if (isUpdate && body.username !== undefined) {
    throw new ApiError(
      'Không hỗ trợ thay đổi mã nhân sự vì lịch học đang dùng mã này làm khóa nghiệp vụ',
      400
    );
  }

  if (!isUpdate || body.username !== undefined) {
    const username = parseString(body.username, 'username', 120);
    if (!username) throw new ApiError('Vui lòng cung cấp mã nhân sự', 400);
    if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
      throw new ApiError('Mã nhân sự chỉ được chứa chữ, số và các ký tự . _ @ -', 400);
    }
    payload.username = username;
  }

  if (!isUpdate || body.display_name !== undefined) {
    payload.display_name = parseString(body.display_name, 'display_name', 100) || null;
  }

  if (!isUpdate || body.can_view_stream_key !== undefined) {
    payload.can_view_stream_key = parseCanViewStreamKey(
      body.can_view_stream_key ?? STREAM_KEY_ACCESS.TEACHER
    );
  }

  if (!isUpdate || body.status !== undefined) {
    payload.status = parseStatus(body.status ?? 1);
  }

  if (isUpdate) {
    if (Object.keys(payload).length === 0) {
      throw new ApiError('Không có dữ liệu cập nhật', 400);
    }
  }

  return payload;
};

export const validateTeacherProfileStatusPayload = (body: any) => ({
  status: parseStatus(body?.status),
});
