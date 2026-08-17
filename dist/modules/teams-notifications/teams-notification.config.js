"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeamsWorkerConfig = exports.getTeamsWebhookDestinations = exports.isTeamsNotificationEnabled = void 0;
const normalizeDestination = (value, index) => {
    const name = String(value?.name || `channel-${index + 1}`).trim();
    const url = String(value?.url || '').trim();
    const token = String(value?.token || '').trim() || undefined;
    if (!name || !url)
        return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:')
            return null;
    }
    catch {
        return null;
    }
    return { name: name.slice(0, 100), url, token };
};
const isTeamsNotificationEnabled = () => (String(process.env.TEAMS_NOTIFICATIONS_ENABLED || 'true').toLowerCase() !== 'false');
exports.isTeamsNotificationEnabled = isTeamsNotificationEnabled;
const getTeamsWebhookDestinations = () => {
    const configuredJson = process.env.TEAMS_WEBHOOKS_JSON?.trim();
    // Render lưu nguyên giá trị nhập trong Dashboard; nếu copy cú pháp .env
    // `'[...]'` vào đó thì dấu nháy đơn cũng trở thành một phần của biến.
    // Chấp nhận cả hai cách để deployment không lỗi vì khác biệt môi trường.
    const json = configuredJson && ((configuredJson.startsWith("'") && configuredJson.endsWith("'"))
        || (configuredJson.startsWith('"') && configuredJson.endsWith('"')))
        ? configuredJson.slice(1, -1).trim()
        : configuredJson;
    let rawDestinations = [];
    if (json) {
        try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) {
                throw new Error('TEAMS_WEBHOOKS_JSON phải là một mảng JSON');
            }
            rawDestinations = parsed;
        }
        catch (error) {
            throw new Error(`TEAMS_WEBHOOKS_JSON không hợp lệ: ${error.message}`);
        }
    }
    else {
        rawDestinations = String(process.env.TEAMS_WEBHOOK_URLS || '')
            .split(',')
            .map((url, index) => ({ name: `channel-${index + 1}`, url: url.trim() }))
            .filter((item) => item.url);
    }
    const destinations = rawDestinations
        .map(normalizeDestination)
        .filter((item) => Boolean(item));
    const uniqueNames = new Set();
    return destinations.filter((destination) => {
        if (uniqueNames.has(destination.name))
            return false;
        uniqueNames.add(destination.name);
        return true;
    });
};
exports.getTeamsWebhookDestinations = getTeamsWebhookDestinations;
const getTeamsWorkerConfig = () => ({
    pollIntervalMs: Math.max(1_000, Number(process.env.TEAMS_NOTIFICATION_POLL_INTERVAL_MS) || 5_000),
    requestTimeoutMs: Math.max(1_000, Number(process.env.TEAMS_NOTIFICATION_TIMEOUT_MS) || 10_000),
    maxAttempts: Math.max(1, Number(process.env.TEAMS_NOTIFICATION_MAX_ATTEMPTS) || 5),
    batchSize: Math.min(100, Math.max(1, Number(process.env.TEAMS_NOTIFICATION_BATCH_SIZE) || 20)),
});
exports.getTeamsWorkerConfig = getTeamsWorkerConfig;
