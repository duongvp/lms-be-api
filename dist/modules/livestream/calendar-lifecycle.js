"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarStoreAction = exports.auditCalendarKeyReuse = exports.claimDeletedCalendarKey = exports.writeCalendarLifecycleLog = exports.CALENDAR_KEY_REUSE = void 0;
const crypto_1 = __importDefault(require("crypto"));
exports.CALENDAR_KEY_REUSE = Symbol('calendarKeyReuse');
const json = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const writeCalendarLifecycleLog = async (tx, input) => {
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
exports.writeCalendarLifecycleLog = writeCalendarLifecycleLog;
/** Keep the deleted row and its dependent history; only release its unique key.
 * The delete audit remains the authoritative original key/mapping snapshot. */
const claimDeletedCalendarKey = async (tx, key) => {
    if (!key)
        return null;
    const rows = await tx.$queryRaw `
    SELECT * FROM calendar WHERE \`key\` = ${key} AND deleted_at IS NOT NULL FOR UPDATE
  `;
    const before = rows[0];
    if (!before)
        return null;
    const mappings = await tx.package_lesson_mapping.findMany({ where: { key }, orderBy: { id: 'asc' } });
    await tx.calendar.update({
        where: { id: Number(before.id), deleted_at: { not: null } }, data: { key: null },
    });
    await tx.package_lesson_mapping.deleteMany({ where: { key } });
    return { before, mappings, operationId: crypto_1.default.randomUUID() };
};
exports.claimDeletedCalendarKey = claimDeletedCalendarKey;
const auditCalendarKeyReuse = async (tx, calendar, actor) => {
    const reuse = calendar[exports.CALENDAR_KEY_REUSE];
    if (!reuse || reuse.audited)
        return;
    const mappings = await tx.package_lesson_mapping.findMany({ where: { key: calendar.key }, orderBy: { id: 'asc' } });
    await (0, exports.writeCalendarLifecycleLog)(tx, {
        operationId: reuse.operationId, action: 'restore', before: reuse.before,
        after: calendar, mappingsBefore: reuse.mappings, mappingsAfter: mappings,
        actor, restoreType: 'reuse_key', reason: 'Tái sử dụng key lịch đã xóa',
    });
    reuse.audited = true;
};
exports.auditCalendarKeyReuse = auditCalendarKeyReuse;
// A mapping may be assigned later than calendar creation. Keep using restore
// until a lifecycle job succeeds, rather than turning a deleted HMO key into update.
const calendarStoreAction = async (tx, key, requested) => {
    if (requested === 'restore')
        return requested;
    const latest = await tx.hocmai_sync_queue.findFirst({
        where: { c_key: key, action: { in: ['create', 'delete', 'restore'] } },
        orderBy: { id: 'desc' }, select: { action: true, status: true },
    });
    return latest?.action === 'delete' || (latest?.action === 'restore' && latest.status !== 1)
        ? 'restore' : requested;
};
exports.calendarStoreAction = calendarStoreAction;
