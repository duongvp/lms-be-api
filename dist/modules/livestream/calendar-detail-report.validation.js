"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeDetailCursor = exports.encodeDetailCursor = exports.cursorScope = exports.parseDetailFilters = exports.detailId = void 0;
const node_crypto_1 = require("node:crypto");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const detailId = (value, label = 'ID') => {
    if (!/^\d{1,10}$/.test(String(value ?? '')))
        throw new ApiError_1.default(`${label} không hợp lệ`, 400);
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1 || id > 4294967295)
        throw new ApiError_1.default(`${label} không hợp lệ`, 400);
    return id;
};
exports.detailId = detailId;
const integer = (value, fallback, max) => {
    if (value == null || value === '')
        return fallback;
    const n = Number(value);
    if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > max)
        throw new ApiError_1.default('Phân trang không hợp lệ', 400);
    return n;
};
const choice = (value, choices, fallback) => {
    if (value == null || value === '')
        return fallback;
    if (!choices.includes(value))
        throw new ApiError_1.default('Bộ lọc không hợp lệ', 400);
    return value;
};
const text = (value) => {
    if (value == null)
        return '';
    if (typeof value !== 'string' || value.length > 200)
        throw new ApiError_1.default('Từ khóa không hợp lệ', 400);
    return value.trim();
};
const date = (value) => {
    if (value == null || value === '')
        return;
    // Wall-clock DB timestamps are serialized in UTC. Do not apply +07 twice.
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value))
        throw new ApiError_1.default('Thời gian phải dùng ISO UTC theo giờ lưu của lịch', 400);
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19))
        throw new ApiError_1.default('Thời gian không hợp lệ', 400);
    return parsed;
};
const parseDetailFilters = (query) => {
    const room = query.room_id == null || query.room_id === '' ? undefined
        : query.room_id === 'unassigned' ? null : (0, exports.detailId)(query.room_id, 'Room');
    const from = date(query.from), to = date(query.to);
    if (from && to && from >= to)
        throw new ApiError_1.default('Khoảng thời gian không hợp lệ', 400);
    return {
        room, from, to, q: text(query.q), page: integer(query.page, 1, 100000), limit: integer(query.limit, 50, 100),
        attendance: choice(query.attendance, ['all', 'attended', 'observed', 'unobserved'], 'all'),
        chat: choice(query.chat, ['all', 'yes', 'no'], 'all'),
        moderation: choice(query.moderation, ['all', 'yes', 'no'], 'all'),
        sort: choice(query.sort, ['name', 'first_seen', 'chat_count'], 'name'),
        order: choice(query.order, ['asc', 'desc'], 'asc'),
        source: choice(query.source, ['all', 'presence', 'chat', 'moderation', 'activities'], 'all'),
        cursor: textCursor(query.cursor), refresh: query.refresh === 'true',
    };
};
exports.parseDetailFilters = parseDetailFilters;
const textCursor = (value) => {
    if (value == null || value === '')
        return undefined;
    if (typeof value !== 'string' || value.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(value))
        throw new ApiError_1.default('Cursor không hợp lệ', 400);
    return value;
};
const cursorScope = (value) => (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
exports.cursorScope = cursorScope;
const encodeDetailCursor = (cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
exports.encodeDetailCursor = encodeDetailCursor;
const decodeDetailCursor = (value, scope) => {
    if (!value)
        return;
    try {
        const c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (c.scope !== scope || !/^\d{1,20}$/.test(c.id) || BigInt(c.id) > 18446744073709551615n
            || ![1, 2, 3, 4, 5, 6].includes(c.source) || typeof c.time !== 'string' || date(c.time) == null)
            throw Error();
        return c;
    }
    catch {
        throw new ApiError_1.default('Cursor không hợp lệ hoặc khác phạm vi báo cáo', 400);
    }
};
exports.decodeDetailCursor = decodeDetailCursor;
