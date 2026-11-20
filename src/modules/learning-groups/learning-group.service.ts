import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';

export const positiveId = (value: unknown, label = 'ID') => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(`${label} không hợp lệ`, 400);
  return id;
};
export const programCode = (value: unknown) => {
  const code = String(value ?? '').trim();
  if (!code || code.length > 30) throw new ApiError('Mã chương trình không hợp lệ', 400);
  return code;
};
const capacity = (value: unknown, fallback: number | null) => value == null ? fallback : positiveId(value, 'Sức chứa');
export const getProgramGroups = async (code: string) => {
  const [settings, groups] = await Promise.all([
    prisma.program_settings.findUnique({ where: { code } }),
    prisma.learning_groups.findMany({ where: { code }, orderBy: { id: 'asc' } }),
  ]);
  return { settings: settings ?? { code, teaching_model: 'large_class', default_capacity: null }, groups };
};
export const saveProgramSettings = async (code: string, input: any) => {
  if (!['large_class', 'small_group'].includes(input.teaching_model)) throw new ApiError('Mô hình học không hợp lệ', 400);
  return prisma.$transaction(async tx => {
    await tx.program_settings.upsert({ where: { code }, create: { code }, update: {} });
    const [existing] = await tx.$queryRaw<Array<{teaching_model:string}>>`SELECT teaching_model FROM program_settings WHERE code=${code} FOR UPDATE`;
    if (existing.teaching_model !== input.teaching_model) {
      const calendars=await tx.$queryRaw<Array<{id:number}>>`SELECT id FROM calendar WHERE code=${code} LIMIT 1 FOR UPDATE`;
      const groups=await tx.$queryRaw<Array<{id:number}>>`SELECT id FROM learning_groups WHERE code=${code} LIMIT 1 FOR UPDATE`;
      if(calendars.length || groups.length) throw new ApiError('Chương trình đã có lịch hoặc nhóm. Hãy dùng code riêng cho mô hình mới để giữ nguyên lịch hiện tại.',409);
    }
    return tx.program_settings.update({ where: { code }, data: {
      teaching_model: input.teaching_model,
      default_capacity: input.teaching_model === 'small_group' ? capacity(input.default_capacity, 10) : null,
    } });
  });
};
export const saveLearningGroup = async (code: string, input: any, id?: number) => prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT code FROM program_settings WHERE code=${code} FOR UPDATE`;
  const settings = await tx.program_settings.findUnique({ where: { code } });
  if (settings?.teaching_model !== 'small_group') throw new ApiError('Hãy cấu hình chương trình nhóm nhỏ trước khi tạo nhóm', 400);
  const existing = id ? await tx.learning_groups.findFirst({ where: { id, code } }) : null;
  if (id && !existing) throw new ApiError('Không tìm thấy nhóm thuộc chương trình', 404);
  let groupCode = String(input.group_code ?? existing?.group_code ?? '').trim().toUpperCase();
  if (!groupCode) {
    const groups = await tx.learning_groups.findMany({ where: { code }, select: { group_code: true } });
    const used = new Set(groups.map(g => g.group_code));
    let n = 1; while (used.has(`N${String(n).padStart(3, '0')}`)) n++;
    groupCode = `N${String(n).padStart(3, '0')}`;
  }
  if (!/^[A-Z0-9_-]{1,30}$/.test(groupCode)) throw new ApiError('Mã nhóm chỉ gồm A–Z, số, dấu - hoặc _, tối đa 30 ký tự', 400);
  if (existing && groupCode !== existing.group_code) throw new ApiError('Không đổi mã nhóm đã tạo; có thể đổi tên hiển thị', 400);
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 150) throw new ApiError('Tên nhóm phải có từ 1 đến 150 ký tự', 400);
  const limit = capacity(input.capacity, existing?.capacity ?? settings.default_capacity ?? 10)!;
  const status = input.status ?? existing?.status ?? 'active';
  if (!['active','inactive','closed'].includes(status)) throw new ApiError('Trạng thái nhóm không hợp lệ', 400);
  if (existing) {
    const [maximum] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT COALESCE(MAX(roster.n),0) n FROM (
        SELECT COUNT(*) n FROM users u JOIN calendar c ON c.id=u.calendar_id
        LEFT JOIN teacher_profiles staff ON staff.username=u.username
        WHERE c.group_id=${existing.id} AND staff.id IS NULL GROUP BY c.id
      ) roster`;
    if (Number(maximum.n) > limit) throw new ApiError('Sức chứa mới nhỏ hơn số học viên đã xếp vào lịch', 409);
  }
  try {
    return existing
      ? await tx.learning_groups.update({ where: { id: existing.id }, data: { name, capacity: limit, status } })
      : await tx.learning_groups.create({ data: { code, group_code: groupCode, name, capacity: limit, status } });
  } catch (e: any) {
    if (e.code === 'P2002') throw new ApiError('Mã nhóm đã tồn tại trong chương trình', 409);
    throw e;
  }
});

// Legacy calls take exactly their old path and keep their existing query shape.
export const validateCalendarGroup = async (client: any, data: any) => {
  const id = data.group_id == null || data.group_id === '' ? null : positiveId(data.group_id, 'Nhóm');
  // Locking read also serializes model changes with schedule creation.
  // Minimal unit-test clients may only expose the delegate.
  const settings = typeof client.$queryRaw === 'function'
    ? (await client.$queryRaw(Prisma.sql`SELECT teaching_model FROM program_settings WHERE code=${data.code} FOR SHARE`))[0]
    : await client.program_settings.findUnique({ where: { code: data.code } });
  if (!id) {
    if (settings?.teaching_model === 'small_group') throw new ApiError('Chương trình nhóm nhỏ bắt buộc chọn nhóm học', 400);
    delete data.group_id;
    return;
  }
  const group = await client.learning_groups.findFirst({ where: { id, code: data.code, status: 'active' } });
  if (settings?.teaching_model !== 'small_group' || !group) throw new ApiError('Nhóm không hoạt động hoặc không thuộc chương trình nhóm nhỏ', 400);
  data.group_id = id;
};
export const groupScope = (calendar: { group_id?: number | null }) => calendar.group_id ? { group_id: calendar.group_id } : {};
export const rosterScope = (calendar: { id?: number; code: string; learn_number: number; group_id?: number | null }) => ({
  code: calendar.code, learn_number: calendar.learn_number,
  ...(calendar.group_id ? { calendar_id: calendar.id } : {}),
});
export const assertSameGroup = (before: any, input: any) => {
  if (input.group_id !== undefined && (input.group_id == null ? null : positiveId(input.group_id, 'Nhóm')) !== (before.group_id ?? null)) {
    throw new ApiError('Không chuyển nhóm trên lịch đã tạo; hãy tạo lịch mới cho nhóm đích', 400);
  }
};
