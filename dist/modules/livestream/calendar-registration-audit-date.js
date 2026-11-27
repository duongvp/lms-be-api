"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrationAuditDates = registrationAuditDates;
exports.registrationsBeforeCutoff = registrationsBeforeCutoff;
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const dateTime_1 = require("../../utils/dateTime");
function registrationAuditDates(now = Date.now()) {
    const today = (0, dateTime_1.getVietnamWallClockDate)(new Date(now));
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const format = (date) => [String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), date.getUTCFullYear()].join('/');
    return { yesterday: format(yesterday), today: format(today) };
}
// The API's registed_at is an inclusive lower bound, not an exact date.
// Subtract registrations since the next midnight, retaining package membership
// and duplicate multiplicity rather than removing usernames across all packages.
function registrationsBeforeCutoff(sinceDate, sinceCutoff) {
    const key = (row) => JSON.stringify([row.userid, row.username, row.product_id].map(value => String(value ?? '').trim()));
    const remaining = new Map();
    for (const row of sinceCutoff)
        remaining.set(key(row), (remaining.get(key(row)) || 0) + 1);
    const rows = sinceDate.filter(row => {
        const identity = key(row);
        const count = remaining.get(identity) || 0;
        if (!count)
            return true;
        remaining.set(identity, count - 1);
        return false;
    });
    if ([...remaining.values()].some(count => count > 0)) {
        throw new ApiError_1.default('Dữ liệu đăng ký thay đổi giữa hai lần lấy API; hãy kiểm tra lại để tránh tính nhầm học viên hôm nay', 409);
    }
    return rows;
}
