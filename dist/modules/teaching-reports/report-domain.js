"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleOverlaps = exports.intervalSeconds = exports.paginate = exports.page = exports.day = exports.choice = exports.integer = exports.numberId = exports.id = exports.text = exports.json = exports.fail = void 0;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const fail = (message, status = 400) => { throw new ApiError_1.default(message, status); };
exports.fail = fail;
const json = (v) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x));
exports.json = json;
const text = (v, label, max = 500) => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
        return (0, exports.fail)(`${label} không hợp lệ`);
    return v.trim();
};
exports.text = text;
const id = (v) => {
    if (!/^[1-9]\d{0,18}$/.test(String(v ?? '')))
        return (0, exports.fail)('ID không hợp lệ');
    return BigInt(String(v));
};
exports.id = id;
const numberId = (v) => {
    const n = Number((0, exports.id)(v));
    if (n > 4294967295)
        return (0, exports.fail)('ID vượt giới hạn');
    return n;
};
exports.numberId = numberId;
const integer = (v, label, min = 0, max = 100000) => {
    const n = Number(v);
    if (v == null || v === '' || !Number.isInteger(n) || n < min || n > max)
        return (0, exports.fail)(`${label} không hợp lệ`);
    return n;
};
exports.integer = integer;
const choice = (v, values, label) => values.includes(v) ? v : (0, exports.fail)(`${label} không hợp lệ`);
exports.choice = choice;
const day = (v) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
        return (0, exports.fail)('Ngày phải là YYYY-MM-DD');
    const d = new Date(v + 'T00:00:00.000Z');
    if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== v)
        return (0, exports.fail)('Ngày không hợp lệ');
    return d;
};
exports.day = day;
const page = (q) => ({ page: (0, exports.integer)(q.page ?? 1, 'Trang', 1, 100000), limit: (0, exports.integer)(q.limit ?? 25, 'Số dòng', 1, 100) });
exports.page = page;
const paginate = (rows, q, allowed, fallback) => {
    const p = (0, exports.page)(q), sort = (0, exports.choice)(q.sort ?? fallback, allowed, 'Cột sắp xếp'), order = (0, exports.choice)(q.order ?? 'asc', ['asc', 'desc'], 'Thứ tự');
    rows.sort((a, b) => { const x = a[sort], y = b[sort]; const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'vi', { numeric: true }); return (order === 'asc' ? n : -n) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }); });
    return { rows: rows.slice((p.page - 1) * p.limit, p.page * p.limit), pagination: { ...p, total: rows.length } };
};
exports.paginate = paginate;
const intervalSeconds = (sessions) => {
    const intervals = sessions.map(s => [+s.start_time, +s.end_time]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((a, b) => a[0] - b[0]);
    let total = 0, start = 0, end = 0;
    for (const [a, b] of intervals) {
        if (a > end) {
            total += end - start;
            start = a;
            end = b;
        }
        else
            end = Math.max(end, b);
    }
    return (total + end - start) / 1000;
};
exports.intervalSeconds = intervalSeconds;
/** Strict overlap: touching endpoints are separate schedules. Examples are capped for exports/UI. */
const scheduleOverlaps = (sessions) => {
    const sorted = sessions.filter(s => +s.end_time > +s.start_time).sort((a, b) => +a.start_time - +b.start_time || a.id - b.id);
    const ends = sorted.map(s => +s.end_time).sort((a, b) => a - b);
    const bound = (values, value, inclusive) => {
        let lo = 0, hi = values.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (values[mid] < value || (inclusive && values[mid] === value))
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    const starts = sorted.map(s => +s.start_time), maxEnd = [];
    const build = (node, lo, hi) => maxEnd[node] = hi - lo === 1 ? +sorted[lo].end_time : Math.max(build(node * 2, lo, (lo + hi) >>> 1), build(node * 2 + 1, (lo + hi) >>> 1, hi));
    if (sorted.length)
        build(1, 0, sorted.length);
    return new Map(sorted.map(s => {
        const limit = bound(starts, +s.end_time, false), count = limit - bound(ends, +s.start_time, true) - 1, calendar_ids = [];
        const visit = (node, lo, hi) => {
            if (lo >= limit || maxEnd[node] <= +s.start_time || calendar_ids.length >= 5)
                return;
            if (hi - lo === 1) {
                if (sorted[lo].id !== s.id)
                    calendar_ids.push(sorted[lo].id);
                return;
            }
            const mid = (lo + hi) >>> 1;
            visit(node * 2, lo, mid);
            visit(node * 2 + 1, mid, hi);
        };
        if (count > 0)
            visit(1, 0, sorted.length);
        return [s.id, { count, calendar_ids }];
    }));
};
exports.scheduleOverlaps = scheduleOverlaps;
