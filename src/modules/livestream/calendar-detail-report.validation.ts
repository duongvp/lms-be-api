import { createHash } from 'node:crypto';
import ApiError from '../../utils/ApiError';

export const detailId = (value: unknown, label = 'ID') => {
  if (!/^\d{1,10}$/.test(String(value ?? ''))) throw new ApiError(`${label} không hợp lệ`, 400);
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295) throw new ApiError(`${label} không hợp lệ`, 400);
  return id;
};
const integer = (value: unknown, fallback: number, max: number) => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > max) throw new ApiError('Phân trang không hợp lệ', 400);
  return n;
};
const choice = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (!choices.includes(value as T)) throw new ApiError('Bộ lọc không hợp lệ', 400);
  return value as T;
};
const text = (value: unknown) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 200) throw new ApiError('Từ khóa không hợp lệ', 400);
  return value.trim();
};
const date = (value: unknown): Date | undefined => {
  if (value == null || value === '') return;
  // Wall-clock DB timestamps are serialized in UTC. Do not apply +07 twice.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new ApiError('Thời gian phải dùng ISO UTC theo giờ lưu của lịch', 400);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) throw new ApiError('Thời gian không hợp lệ', 400);
  return parsed;
};
export const parseDetailFilters = (query: Record<string, unknown>) => {
  const room = query.room_id == null || query.room_id === '' ? undefined
    : query.room_id === 'unassigned' ? null : detailId(query.room_id, 'Room');
  const from = date(query.from), to = date(query.to);
  if (from && to && from >= to) throw new ApiError('Khoảng thời gian không hợp lệ', 400);
  return {
    room, from, to, q: text(query.q), page: integer(query.page, 1, 100000), limit: integer(query.limit, 50, 100),
    attendance: choice(query.attendance, ['all', 'attended', 'observed', 'unobserved'] as const, 'all'),
    chat: choice(query.chat, ['all', 'yes', 'no'] as const, 'all'),
    moderation: choice(query.moderation, ['all', 'yes', 'no'] as const, 'all'),
    sort: choice(query.sort, ['name', 'first_seen', 'chat_count'] as const, 'name'),
    order: choice(query.order, ['asc', 'desc'] as const, 'asc'),
    source: choice(query.source, ['all', 'presence', 'chat', 'moderation', 'activities'] as const, 'all'),
    cursor: textCursor(query.cursor), refresh: query.refresh === 'true',
  };
};
const textCursor = (value: unknown) => {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError('Cursor không hợp lệ', 400);
  return value;
};
export type DetailFilters = ReturnType<typeof parseDetailFilters>;
export type DetailCursor = { time: string; source: number; id: string; scope: string };
export const cursorScope = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
export const encodeDetailCursor = (cursor: DetailCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
export const decodeDetailCursor = (value: string | undefined, scope: string): DetailCursor | undefined => {
  if (!value) return;
  try {
    const c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (c.scope !== scope || !/^\d{1,20}$/.test(c.id) || BigInt(c.id) > 18446744073709551615n
      || ![1, 2, 3, 4, 5, 6].includes(c.source) || typeof c.time !== 'string' || date(c.time) == null) throw Error();
    return c;
  } catch { throw new ApiError('Cursor không hợp lệ hoặc khác phạm vi báo cáo', 400); }
};
