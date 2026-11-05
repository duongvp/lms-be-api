import crypto from 'crypto';
import { Prisma } from '@prisma/client';

export type LifecycleActor = { userId: number; username: string };
export const CALENDAR_KEY_REUSE = Symbol('calendarKeyReuse');
const json = (value: unknown) => JSON.parse(JSON.stringify(value,
  (_key, item) => typeof item === 'bigint' ? item.toString() : item));

export const writeCalendarLifecycleLog = async (
  tx: Prisma.TransactionClient,
  input: {
    operationId: string; action: 'delete' | 'restore'; before: any; after: any;
    mappingsBefore: any[]; mappingsAfter: any[]; actor?: LifecycleActor;
    restoreType?: 'self' | 'reuse_key'; reason: string; oldKey?: string; lessonBefore?: any;
  }
) => {
  if (!input.actor?.userId || !input.actor.username?.trim()) {
    throw new Error('Không xác định được người thay đổi lịch học');
  }
  await tx.calendar_change_logs.create({ data: {
    operation_id: input.operationId,
    action: input.action,
    calendar_id: input.after.id,
    old_key: input.oldKey ?? input.before.key,
    new_key: input.after.key,
    code: input.after.code,
    learn_number: input.after.learn_number,
    reason: input.reason,
    actor_user_id: input.actor.userId,
    actor_username: input.actor.username,
    before_data: json({ source_session: input.before, mappings: input.mappingsBefore,
      ...(input.lessonBefore ? { lesson_snapshot: input.lessonBefore } : {}) }),
    after_data: json({ source_session: input.after, mappings: input.mappingsAfter,
      ...(input.restoreType ? { restore_type: input.restoreType } : {}) }),
    affected_sessions: json([input.before, input.after]),
  } });
};

/** Keep the deleted row and its dependent history; only release its unique key.
 * The delete audit remains the authoritative original key/mapping snapshot. */
export const claimDeletedCalendarKey = async (tx: Prisma.TransactionClient, key?: string | null) => {
  if (!key) return null;
  const rows = await tx.$queryRaw<any[]>`
    SELECT * FROM calendar WHERE \`key\` = ${key} AND deleted_at IS NOT NULL FOR UPDATE
  `;
  const before = rows[0];
  if (!before) return null;
  const mappings = await tx.package_lesson_mapping.findMany({ where: { key }, orderBy: { id: 'asc' } });
  await tx.calendar.update({
    where: { id: Number(before.id), deleted_at: { not: null } }, data: { key: null },
  });
  await tx.package_lesson_mapping.deleteMany({ where: { key } });
  return { before, mappings, operationId: crypto.randomUUID() };
};

export const auditCalendarKeyReuse = async (
  tx: Prisma.TransactionClient, calendar: any, actor?: LifecycleActor
) => {
  const reuse = calendar[CALENDAR_KEY_REUSE];
  if (!reuse || reuse.audited) return;
  const mappings = await tx.package_lesson_mapping.findMany({ where: { key: calendar.key }, orderBy: { id: 'asc' } });
  await writeCalendarLifecycleLog(tx, {
    operationId: reuse.operationId, action: 'restore', before: reuse.before,
    after: calendar, mappingsBefore: reuse.mappings, mappingsAfter: mappings,
    actor, restoreType: 'reuse_key', reason: 'Tái sử dụng key lịch đã xóa',
  });
  reuse.audited = true;
};

// A mapping may be assigned later than calendar creation. Keep using restore
// until a lifecycle job succeeds, rather than turning a deleted HMO key into update.
export const calendarStoreAction = async (
  tx: Prisma.TransactionClient, key: string, requested: 'create' | 'update' | 'restore'
): Promise<'create' | 'update' | 'restore'> => {
  if (requested === 'restore') return requested;
  const latest = await tx.hocmai_sync_queue.findFirst({
    where: { c_key: key, action: { in: ['create', 'delete', 'restore'] } },
    orderBy: { id: 'desc' }, select: { action: true, status: true },
  });
  return latest?.action === 'delete' || (latest?.action === 'restore' && latest.status !== 1)
    ? 'restore' : requested;
};
