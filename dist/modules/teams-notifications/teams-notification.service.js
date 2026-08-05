"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueManyCalendarTeamsNotifications = exports.enqueueCalendarTeamsNotification = void 0;
const crypto_1 = __importDefault(require("crypto"));
const teams_notification_config_1 = require("./teams-notification.config");
const teams_notification_card_1 = require("./teams-notification.card");
const stableCalendarSnapshot = (calendar) => {
    if (!calendar)
        return null;
    const fields = [
        'id', 'key', 'code', 'subject', 'teacher', 'assistant_teacher',
        'start_time', 'end_time', 'channel_name', 'lesson_name', 'lesson_status',
    ];
    return Object.fromEntries(fields.map((field) => {
        const value = calendar[field];
        return [field, value instanceof Date ? value.toISOString() : value ?? null];
    }));
};
const buildEventKey = (eventType, calendarId, before, after, operationId) => {
    if (operationId)
        return `${operationId}:${eventType}:${calendarId ?? 'none'}`;
    const fingerprint = crypto_1.default.createHash('sha256').update(JSON.stringify({
        eventType,
        calendarId,
        before: stableCalendarSnapshot(before),
        after: stableCalendarSnapshot(after),
    })).digest('hex');
    return `${eventType}:${calendarId ?? 'none'}:${fingerprint}`;
};
const enqueueCalendarTeamsNotification = async (client, input) => {
    if (!(0, teams_notification_config_1.isTeamsNotificationEnabled)())
        return;
    const destinations = (0, teams_notification_config_1.getTeamsWebhookDestinations)();
    if (!destinations.length)
        return;
    const before = input.before || null;
    const after = input.after || null;
    const calendarId = Number(after?.id ?? before?.id) || null;
    const changes = (0, teams_notification_card_1.buildCalendarChanges)(before, after);
    if (input.eventType === 'updated' && changes.length === 0)
        return;
    const payload = {
        eventType: input.eventType,
        calendarId,
        before: stableCalendarSnapshot(before),
        after: stableCalendarSnapshot(after),
        actor: input.actor || null,
        changedAt: (input.changedAt || new Date()).toISOString(),
        changes,
    };
    const eventKey = buildEventKey(input.eventType, calendarId, before, after, input.operationId);
    const serializedPayload = JSON.stringify(payload);
    for (const destination of destinations) {
        await client.$executeRaw `
      INSERT INTO teams_notification_outbox (
        event_key, destination, event_type, calendar_id, payload,
        status, attempts, next_attempt_at, created_at, updated_at
      ) VALUES (
        ${eventKey}, ${destination.name}, ${input.eventType}, ${calendarId},
        ${serializedPayload}, 0, 0, NOW(3), NOW(3), NOW(3)
      )
      ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)
    `;
    }
};
exports.enqueueCalendarTeamsNotification = enqueueCalendarTeamsNotification;
const enqueueManyCalendarTeamsNotifications = async (client, events) => {
    for (const event of events) {
        await (0, exports.enqueueCalendarTeamsNotification)(client, event);
    }
};
exports.enqueueManyCalendarTeamsNotifications = enqueueManyCalendarTeamsNotifications;
