import ApiError from '../../utils/ApiError';
import { BannerPayload } from './program-teacher-banner.service';

const int = (value: unknown, field: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(`${field} không hợp lệ`, 400);
  return parsed;
};
export const validateId = (value: unknown) => {
  const id = int(value, 'id');
  if (id <= 0) throw new ApiError('id không hợp lệ', 400);
  return id;
};
export const validateQuery = (query: any) => {
  const page = query.page === undefined ? 1 : int(query.page, 'page');
  const limit = query.limit === undefined ? 20 : int(query.limit, 'limit');
  if (page < 1 || limit < 1 || limit > 100) throw new ApiError('Phân trang không hợp lệ', 400);
  const status = query.status === undefined || query.status === '' ? undefined : int(query.status, 'status');
  if (status !== undefined && status !== 0 && status !== 1) throw new ApiError('status không hợp lệ', 400);
  return { page, limit, search: String(query.search || '').trim().slice(0, 120) || undefined, program_code: String(query.program_code || '').trim().slice(0, 50) || undefined, status };
};
export const validatePayload = (body: any): BannerPayload => {
  const program_code = String(body?.program_code || '').trim();
  const banner_url = String(body?.banner_url || '').trim();
  const teacher_profile_id = int(body?.teacher_profile_id, 'teacher_profile_id');
  const status = body?.status === undefined ? 1 : int(body.status, 'status');
  if (!program_code || program_code.length > 50) throw new ApiError('Mã chương trình không hợp lệ', 400);
  if (teacher_profile_id <= 0) throw new ApiError('Giáo viên không hợp lệ', 400);
  if (!banner_url || banner_url.length > 500) throw new ApiError('URL banner không hợp lệ', 400);
  try { const url = new URL(banner_url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { throw new ApiError('Banner phải là URL HTTP/HTTPS hợp lệ', 400); }
  if (status !== 0 && status !== 1) throw new ApiError('Trạng thái không hợp lệ', 400);
  return { program_code, teacher_profile_id, banner_url, status: status as 0 | 1 };
};
