"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarTimeNotification = void 0;
// Calendar timestamps encode Vietnam wall time in UTC, matching schedule payloads.
const displayTime = (value) => {
    const date = new Date(value);
    const pad = (part) => String(part).padStart(2, '0');
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} ngày ${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};
const calendarTimeNotification = (current, changes, sendNotification, reason) => {
    const start = changes.start_time ?? current.start_time;
    const end = changes.end_time ?? current.end_time;
    const changed = new Date(start).getTime() !== new Date(current.start_time).getTime()
        || new Date(end).getTime() !== new Date(current.end_time).getTime();
    if (!changed || sendNotification === false)
        return undefined;
    const message = String(reason ?? '').trim();
    if (message.length > 500)
        throw new Error('Nội dung thông báo không được vượt quá 500 ký tự');
    return message || `Lịch học được cập nhật từ ${displayTime(current.start_time)} – ${displayTime(current.end_time)} sang ${displayTime(start)} – ${displayTime(end)}.`;
};
exports.calendarTimeNotification = calendarTimeNotification;
