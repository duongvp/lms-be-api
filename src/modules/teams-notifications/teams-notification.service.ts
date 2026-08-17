import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { getTeamsWebhookDestinations, isTeamsNotificationEnabled } from './teams-notification.config';
import { buildCalendarChanges } from './teams-notification.card';
import {
  CalendarNotificationPayload,
  TeamsCalendarEventType,
  TeamsNotificationActor,
} from './teams-notification.types';

type QueryClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

const stableCalendarSnapshot = (calendar: Record<string, any> | null) => {
  if (!calendar) return null;
  const fields = [
    'id', 'key', 'code', 'subject', 'teacher', 'assistant_teacher',
    'start_time', 'end_time', 'channel_name', 'lesson_name', 'lesson_status',
  ];
  return Object.fromEntries(fields.map((field) => {
    const value = calendar[field];
    return [field, value instanceof Date ? value.toISOString() : value ?? null];
  }));
};

const buildEventKey = (
  eventType: TeamsCalendarEventType,
  calendarId: number | null,
  before: Record<string, any> | null,
  after: Record<string, any> | null,
  operationId?: string
) => {
  if (operationId) return `${operationId}:${eventType}:${calendarId ?? 'none'}`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    eventType,
    calendarId,
    before: stableCalendarSnapshot(before),
    after: stableCalendarSnapshot(after),
  })).digest('hex');
  return `${eventType}:${calendarId ?? 'none'}:${fingerprint}`;
};

export const enqueueCalendarTeamsNotification = async (
  client: QueryClient,
  input: {
    eventType: TeamsCalendarEventType;
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    actor?: TeamsNotificationActor | null;
    operationId?: string;
    changedAt?: Date;
  }
) => {
  if (!isTeamsNotificationEnabled()) return;
  const destinations = getTeamsWebhookDestinations();
  if (!destinations.length) return;

  const before = input.before || null;
  const after = input.after || null;
  const calendarId = Number(after?.id ?? before?.id) || null;
  const changes = buildCalendarChanges(before, after);
  if (input.eventType === 'updated' && changes.length === 0) return;

  const payload: CalendarNotificationPayload = {
    eventType: input.eventType,
    calendarId,
    before: stableCalendarSnapshot(before),
    after: stableCalendarSnapshot(after),
    actor: input.actor || null,
    changedAt: (input.changedAt || new Date()).toISOString(),
    changes,
  };
  const eventKey = buildEventKey(
    input.eventType,
    calendarId,
    before,
    after,
    input.operationId
  );
  const serializedPayload = JSON.stringify(payload);

  for (const destination of destinations) {
    await client.$executeRaw`
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

export const enqueueManyCalendarTeamsNotifications = async (
  client: QueryClient,
  events: Array<Parameters<typeof enqueueCalendarTeamsNotification>[1]>
) => {
  if (!events.length || !isTeamsNotificationEnabled()) return;
  const destinations = getTeamsWebhookDestinations();
  if (!destinations.length) return;

  const rows = events.flatMap((input) => {
    const before = input.before || null;
    const after = input.after || null;
    const calendarId = Number(after?.id ?? before?.id) || null;
    const changes = buildCalendarChanges(before, after);
    if (input.eventType === 'updated' && changes.length === 0) return [];
    const payload: CalendarNotificationPayload = {
      eventType: input.eventType,
      calendarId,
      before: stableCalendarSnapshot(before),
      after: stableCalendarSnapshot(after),
      actor: input.actor || null,
      changedAt: (input.changedAt || new Date()).toISOString(),
      changes,
    };
    const eventKey = buildEventKey(
      input.eventType,
      calendarId,
      before,
      after,
      input.operationId
    );
    const serializedPayload = JSON.stringify(payload);
    return destinations.map((destination) => Prisma.sql`(
      ${eventKey}, ${destination.name}, ${input.eventType}, ${calendarId},
      ${serializedPayload}, 0, 0, NOW(3), NOW(3), NOW(3)
    )`);
  });
  if (!rows.length) return;

  await client.$executeRaw(Prisma.sql`
    INSERT INTO teams_notification_outbox (
      event_key, destination, event_type, calendar_id, payload,
      status, attempts, next_attempt_at, created_at, updated_at
    ) VALUES ${Prisma.join(rows)}
    ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)
  `);
};
