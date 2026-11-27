"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.positiveBigId = exports.positiveId = exports.fingerprint = exports.operationPermission = exports.commandOperation = exports.PERMISSIONS = exports.OPERATIONS = void 0;
exports.affectedOperations = affectedOperations;
exports.jsonValue = jsonValue;
exports.canonical = canonical;
exports.assertOperations = assertOperations;
const node_crypto_1 = __importDefault(require("node:crypto"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
exports.OPERATIONS = ['create', 'update', 'delete', 'cancel', 'reschedule', 'swap', 'restore', 'mapping', 'import'];
exports.PERMISSIONS = {
    submit: 'calendar.submit_approval', approve: 'calendar.approve', reject: 'calendar.reject',
    review: 'calendar.approval.view', history: 'calendar.history.view', manage: 'calendar.workflow.manage',
};
const commandOperation = (command) => {
    const mode = command.payload?.update_mode || command.payload?.mode;
    const cancelModes = ['cancel', 'cancel_only', 'no_makeup', 'no_make_up'];
    if (command.action === 'updateBulk' && command.payload?.operation === 'cancel')
        return 'cancel';
    if (command.action === 'updateBulk' && command.payload?.operation === 'makeup')
        return 'reschedule';
    if (command.action === 'update' && command.payload?.update_mode && mode !== 'current')
        return cancelModes.includes(mode) ? 'cancel' : 'reschedule';
    if (command.action === 'reschedule' && cancelModes.includes(mode || 'cancel'))
        return 'cancel';
    return { create: 'create', createBulk: 'create', auto: 'create', update: 'update', updateBulk: 'update', delete: 'delete', cancel: 'cancel', reschedule: 'reschedule', swap: 'swap', restore: 'restore', mapping: 'mapping', import: 'import' }[command.action];
};
exports.commandOperation = commandOperation;
function affectedOperations(c) {
    const ops = new Set([(0, exports.commandOperation)(c)]);
    const payload = JSON.stringify(c.payload || {});
    if (payload.includes('package_lesson_mappings'))
        ops.add('mapping');
    return [...ops];
}
const operationPermission = (operation) => operation === 'create' ? 'calendar.create' : ['delete', 'restore'].includes(operation) ? 'calendar.delete' : operation === 'import' ? 'calendar.import' : 'calendar.update';
exports.operationPermission = operationPermission;
function jsonValue(value) { return JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? String(v) : v)); }
function canonical(value) {
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    if (Array.isArray(value))
        return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(typeof value === 'bigint' ? String(value) : value);
}
const fingerprint = (value) => node_crypto_1.default.createHash('sha256').update(canonical(value)).digest('hex');
exports.fingerprint = fingerprint;
const positiveId = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0)
        throw new ApiError_1.default('ID không hợp lệ', 400);
    return id;
};
exports.positiveId = positiveId;
const positiveBigId = (value) => {
    if (!/^\d{1,19}$/.test(String(value)) || BigInt(String(value)) < 1n)
        throw new ApiError_1.default('ID không hợp lệ', 400);
    return BigInt(String(value));
};
exports.positiveBigId = positiveBigId;
function assertOperations(value) {
    if (!Array.isArray(value) || value.some(v => !exports.OPERATIONS.includes(v)))
        throw new ApiError_1.default('Loại yêu cầu cần duyệt không hợp lệ', 400);
    return [...new Set(value)];
}
