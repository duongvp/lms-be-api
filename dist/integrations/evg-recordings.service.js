"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEvgRecordingTimes = exports.createEvgRecordingReader = exports.selectEvgRecordingRanges = exports.summarizeLiveRecordingRanges = exports.parseEvgRecordingTime = void 0;
const dateTime_1 = require("../utils/dateTime");
/** EVG trả giờ Việt Nam dạng DD-MM-YYYY HH:mm:ss, giống wall-clock của calendar. */
const parseEvgRecordingTime = (value) => {
    const match = typeof value === 'string' && /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match)
        return null;
    const [, day, month, year, hour, minute, second] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second ? date : null;
};
exports.parseEvgRecordingTime = parseEvgRecordingTime;
const summarizeLiveRecordingRanges = (ranges) => {
    if (!ranges.length)
        return null;
    return ranges.reduce((total, range) => ({
        start_time: range.start_time < total.start_time ? range.start_time : total.start_time,
        end_time: range.end_time > total.end_time ? range.end_time : total.end_time,
    }));
};
exports.summarizeLiveRecordingRanges = summarizeLiveRecordingRanges;
const selectEvgRecordingRanges = (records, channelId, day) => {
    const ranges = new Map();
    for (const record of records) {
        if (!record || (record.channel_id != null && String(record.channel_id) !== channelId))
            continue;
        const start = (0, exports.parseEvgRecordingTime)(record.start_on);
        const end = (0, exports.parseEvgRecordingTime)(record.finish_on);
        if (!start || !end || end < start || start.toISOString().slice(0, 10) !== day)
            continue;
        const range = { start_time: start.toISOString(), end_time: end.toISOString() };
        ranges.set(`${range.start_time}/${range.end_time}`, range);
    }
    const summary = (0, exports.summarizeLiveRecordingRanges)([...ranges.values()]);
    return summary ? [summary] : [];
};
exports.selectEvgRecordingRanges = selectEvgRecordingRanges;
const createEvgRecordingReader = (options = {}) => {
    const cache = new Map();
    const pending = new Map();
    const finishedDays = new Map();
    const intervalMs = options.requestIntervalMs ?? 1000;
    const maxRetries = options.maxRetries ?? 2;
    let nextRequestAt = 0;
    let cooldownUntil = 0;
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitForSlot = async () => {
        while (true) {
            const now = Date.now();
            const at = Math.max(now, nextRequestAt, cooldownUntil);
            nextRequestAt = at + intervalMs;
            if (at > now)
                await pause(at - now);
            // Một GET khác có thể nhận 429 trong lúc chờ: áp dụng cooldown chung.
            if (Date.now() >= cooldownUntil)
                return;
        }
    };
    class RateLimitError extends Error {
    }
    const readChannel = (channelId) => {
        const cached = cache.get(channelId);
        if (cached && cached.until > Date.now())
            return Promise.resolve(cached.records);
        const running = pending.get(channelId);
        if (running)
            return running;
        const request = (async () => {
            const key = options.authKey ?? process.env.EVG_AUTH_KEY;
            if (!key)
                throw new Error('Thiếu cấu hình EVG_AUTH_KEY');
            const baseUrl = (options.baseUrl ?? process.env.EVG_API_BASE_URL ?? 'https://live-api.evgcdn.net').replace(/\/+$/, '');
            let response;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                await waitForSlot();
                response = await (options.fetcher ?? fetch)(`${baseUrl}/api/v1.0/live-stream/mp4-records/${channelId}`, {
                    method: 'GET', headers: { 'X-Auth-Key': key, Accept: 'application/json' },
                    signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
                });
                if (response.status !== 429)
                    break;
                const retryAfter = response.headers.get('retry-after');
                const seconds = retryAfter ? Number(retryAfter) : NaN;
                const retryAt = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : NaN;
                const delay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
                    : Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : (options.retryDelayMs ?? 1000) * 2 ** attempt;
                cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
                await response.body?.cancel();
                if (attempt === maxRetries)
                    throw new RateLimitError('EVG giới hạn tần suất');
            }
            if (!response)
                throw new Error('Không nhận được phản hồi EVG');
            if (!response.ok)
                throw new Error(`Không tải được bản ghi EVG (HTTP ${response.status})`);
            const body = await response.json();
            if ((body.error_code != null && Number(body.error_code) !== 0) || !Array.isArray(body.data))
                throw new Error('Dữ liệu bản ghi EVG không hợp lệ');
            if (cache.size >= 200)
                cache.delete(cache.keys().next().value);
            cache.set(channelId, { until: Date.now() + (options.cacheTtlMs ?? 60_000), records: body.data });
            return body.data;
        })();
        pending.set(channelId, request);
        void request.finally(() => pending.delete(channelId)).catch(() => { });
        return request;
    };
    return async (calendars) => {
        const dayKey = (calendar) => `${String(calendar.evg_stream ?? '').trim()}/${calendar.start_time.toISOString().slice(0, 10)}`;
        const missing = calendars.filter((calendar) => (finishedDays.get(dayKey(calendar))?.until ?? 0) <= Date.now());
        const ids = [...new Set(missing.map((calendar) => String(calendar.evg_stream ?? '').trim()).filter((id) => /^[1-9]\d*$/.test(id)))];
        const channels = new Map();
        let next = 0;
        // Giới hạn bốn GET cùng lúc; lỗi EVG không làm mất báo cáo chuyên cần.
        await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
            while (next < ids.length) {
                const id = ids[next++];
                try {
                    channels.set(id, await readChannel(id));
                }
                catch (error) {
                    channels.set(id, error instanceof RateLimitError ? 'rate_limited' : null);
                }
            }
        }));
        return new Map(calendars.map((calendar) => {
            const saved = finishedDays.get(dayKey(calendar));
            if (saved && saved.until > Date.now())
                return [calendar.id, saved.value];
            const channel = String(calendar.evg_stream ?? '').trim();
            if (!/^[1-9]\d*$/.test(channel))
                return [calendar.id, { status: 'no_stream', ranges: [] }];
            const records = channels.get(channel);
            if (records === 'rate_limited')
                return [calendar.id, { status: 'error', error_code: 'rate_limited', ranges: [] }];
            if (!records)
                return [calendar.id, { status: 'error', ranges: [] }];
            const ranges = (0, exports.selectEvgRecordingRanges)(records, channel, calendar.start_time.toISOString().slice(0, 10));
            const value = { status: ranges.length ? 'ready' : 'empty', ranges };
            // Bản ghi của buổi đã kết thúc hơn ba giờ ít thay đổi; cache theo kênh/ngày
            // để đổi trang/room và xuất Excel không gọi lại EVG cho cùng buổi.
            const end = calendar.end_time ?? new Date(`${calendar.start_time.toISOString().slice(0, 10)}T23:59:59.999Z`);
            if (ranges.length && end.getTime() < (0, dateTime_1.getVietnamWallClockDate)().getTime() - 3 * 3_600_000) {
                if (finishedDays.size >= 1000)
                    finishedDays.delete(finishedDays.keys().next().value);
                finishedDays.set(dayKey(calendar), { until: Date.now() + 6 * 3_600_000, value });
            }
            return [calendar.id, value];
        }));
    };
};
exports.createEvgRecordingReader = createEvgRecordingReader;
exports.loadEvgRecordingTimes = (0, exports.createEvgRecordingReader)();
