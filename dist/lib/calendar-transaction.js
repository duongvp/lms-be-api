"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCalendarWriteObserver = exports.inCalendarTransaction = exports.currentCalendarTransaction = void 0;
exports.runCalendarWrite = runCalendarWrite;
exports.runObservedCalendarWrite = runObservedCalendarWrite;
const node_async_hooks_1 = require("node:async_hooks");
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("./prisma"));
// Calendar operations invoked by approve share its transaction. Unrelated modules
// keep using the normal Prisma client; no global transaction monkey patch.
const context = new node_async_hooks_1.AsyncLocalStorage();
const currentCalendarTransaction = () => context.getStore();
exports.currentCalendarTransaction = currentCalendarTransaction;
const inCalendarTransaction = (tx, work) => context.run(tx, work);
exports.inCalendarTransaction = inCalendarTransaction;
async function runCalendarWrite(work, options) {
    if (context.getStore())
        return work();
    return prisma_1.default.$transaction(async (tx) => {
        const lock = await tx.$queryRaw `SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
        if (lock.length !== 1)
            throw new Error("Thiếu khóa giao dịch lịch. Kiểm tra migration workflow.");
        return (0, exports.inCalendarTransaction)(tx, work);
    }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable, maxWait: 15_000, timeout: 180_000, ...options });
}
const calendarPrisma = new Proxy(prisma_1.default, {
    get(target, property) {
        const tx = context.getStore();
        if (property === '$transaction')
            return async (work, options) => {
                if (typeof work !== 'function')
                    throw new Error('Calendar transaction requires callback form');
                return tx ? work(tx) : runCalendarWrite(() => work(context.getStore()), options);
            };
        const owner = tx || target;
        const value = owner[property];
        return typeof value === 'function' ? value.bind(owner) : value;
    },
});
exports.default = calendarPrisma;
let writeObserver;
const setCalendarWriteObserver = (observer) => { writeObserver = observer; };
exports.setCalendarWriteObserver = setCalendarWriteObserver;
function runObservedCalendarWrite(action, args, work) {
    if (context.getStore())
        return work();
    return runCalendarWrite(async () => {
        const tx = context.getStore();
        const actor = [...args].reverse().find(arg => arg && typeof arg === 'object' && Number.isInteger(arg.userId) && typeof arg.username === 'string');
        const first = args[0];
        const ids = typeof first === 'number' ? [first] : Array.isArray(first?.ids) ? first.ids.map(Number) : first?.first_id ? [Number(first.first_id), Number(first.second_id)] : Array.isArray(first?.updates) ? first.updates.map((v) => Number(v.id)) : [];
        const validIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
        let before = actor && validIds.length ? await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM calendar WHERE id IN (${client_1.Prisma.join(validIds)}) ORDER BY id`) : [];
        if (before.length === 1 && action === 'rescheduleSession' && (args[1]?.mode || args[1]?.update_mode) === 'following') {
            const source = before[0];
            before = await tx.$queryRaw `SELECT * FROM calendar WHERE code=${source.code} AND system_type=${source.system_type} AND deleted_at IS NULL AND start_time>=${source.start_time} ORDER BY start_time,id`;
        }
        const result = await work();
        if (actor && writeObserver) {
            const records = new Map();
            const collect = (value) => { if (!value || typeof value !== 'object')
                return; if (value.id && value.code && value.start_time)
                records.set(Number(value.id), value); if (Array.isArray(value))
                value.forEach(collect);
            else
                Object.values(value).forEach(collect); };
            collect(result);
            if (!records.size && validIds.length) {
                const rows = await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM calendar WHERE id IN (${client_1.Prisma.join(validIds)}) ORDER BY id`);
                rows.forEach(row => records.set(Number(row.id), row));
            }
            if (before.length || records.size)
                await writeObserver(tx, action, actor, before.filter(row => records.has(Number(row.id))), [...records.values()], typeof first === 'number' ? args[1] : first);
        }
        return result;
    });
}
