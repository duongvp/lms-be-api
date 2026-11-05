import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueCalendarTeamsNotification,
  enqueueManyCalendarTeamsNotifications,
} from '../src/modules/teams-notifications/teams-notification.service';

test('calendar notifications serialize raw SQL BigInt snapshots in single and bulk queues', async () => {
  const previousEnabled = process.env.TEAMS_NOTIFICATIONS_ENABLED;
  const previousWebhooks = process.env.TEAMS_WEBHOOKS_JSON;
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'true';
  process.env.TEAMS_WEBHOOKS_JSON = JSON.stringify([{ name: 'test', url: 'https://example.com/webhook' }]);
  const calendar = {
    id: 735n, key: 'test-calendar', code: 'TEST', lesson_status: 0n,
    session_id: 9007199254740993n,
    start_time: new Date('2031-11-02T10:00:00Z'),
  };
  const calls: any[][] = [];
  const client = { $executeRaw: async (...args: any[]) => { calls.push(args); return 1; } } as any;
  try {
    await enqueueCalendarTeamsNotification(client, { eventType: 'deleted', before: calendar });
    const payload = JSON.parse(calls[0][5]);
    assert.equal(payload.calendarId, 735);
    assert.equal(payload.before.id, '735');
    assert.equal(payload.before.lesson_status, '0');
    assert.equal(payload.before.start_time, calendar.start_time.toISOString());
    assert.match(calls[0][1], /^deleted:735:[a-f0-9]{64}$/);

    // An explicit operation ID bypasses fingerprinting, but must still serialize the payload.
    await enqueueCalendarTeamsNotification(client, {
      eventType: 'deleted', before: calendar, operationId: 'delete-operation',
    });
    assert.equal(calls[1][1], 'delete-operation:deleted:735');
    assert.deepEqual(JSON.parse(calls[1][5]).before, payload.before);

    await enqueueManyCalendarTeamsNotifications(client, [{ eventType: 'deleted', before: calendar }]);
    const bulkValues = calls[2][0].values;
    assert.equal(bulkValues[0], calls[0][1]);
    assert.deepEqual(JSON.parse(bulkValues[4]).before, payload.before);
  } finally {
    if (previousEnabled === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED;
    else process.env.TEAMS_NOTIFICATIONS_ENABLED = previousEnabled;
    if (previousWebhooks === undefined) delete process.env.TEAMS_WEBHOOKS_JSON;
    else process.env.TEAMS_WEBHOOKS_JSON = previousWebhooks;
  }
});
