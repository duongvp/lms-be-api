"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCalendarColumnFilters = void 0;
const client_1 = require("@prisma/client");
const tokens = (value) => Array.from(new Set(String(value ?? '')
    .split(',').map(token => token.trim()).filter(Boolean)));
const buildCalendarColumnFilters = (query, now) => {
    const conditions = [];
    const dates = tokens(query.live_dates);
    if (dates.length) {
        const dateConditions = dates.map(value => {
            // Calendar timestamps are required by the schema.
            if (value === 'undated')
                return { id: { in: [] } };
            const start = new Date(`${value}T00:00:00.000Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(start.getTime())
                || start.toISOString().slice(0, 10) !== value) {
                throw new Error('live_dates phải là danh sách ngày YYYY-MM-DD hợp lệ');
            }
            const end = new Date(start.getTime() + 86400000);
            return { start_time: { gte: start, lt: end } };
        });
        conditions.push({ OR: dateConditions });
    }
    const statuses = tokens(query.progress_statuses);
    const active = { OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }] };
    if (statuses.length) {
        const statusConditions = statuses.map(status => {
            if (status === 'cancelled')
                return { lesson_status: 1 };
            const timeCondition = status === 'upcoming'
                ? { start_time: { gt: now } }
                : status === 'completed'
                    ? { end_time: { lt: now } }
                    : status === 'ongoing'
                        ? { start_time: { lte: now }, end_time: { gte: now } }
                        : status === 'unknown'
                            ? { id: { in: [] } }
                            : (() => { throw new Error('progress_statuses không hợp lệ'); })();
            return { AND: [active, timeCondition] };
        });
        conditions.push({ OR: statusConditions });
    }
    const assistants = tokens(query.assistant_teachers);
    if (assistants.some(value => value.length > 150))
        throw new Error('assistant_teachers không hợp lệ');
    const assistantCondition = assistants.length ? client_1.Prisma.sql `(${client_1.Prisma.join(assistants.map(value => (value === '-'
        ? client_1.Prisma.sql `UPPER(TRIM(COALESCE(assistant_teacher, ''))) IN ('', 'NULL', '[NULL]', '-')`
        : client_1.Prisma.sql `COALESCE(assistant_teacher, '') REGEXP ${`(^|,)[[:space:]]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[[:space:]]*(,|$)`}`)), ' OR ')})` : undefined;
    return { conditions, assistantCondition };
};
exports.buildCalendarColumnFilters = buildCalendarColumnFilters;
