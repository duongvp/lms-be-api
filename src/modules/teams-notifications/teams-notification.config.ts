import { TeamsWebhookDestination } from './teams-notification.types';

const normalizeDestination = (
  value: any,
  index: number
): TeamsWebhookDestination | null => {
  const name = String(value?.name || `channel-${index + 1}`).trim();
  const url = String(value?.url || '').trim();
  const token = String(value?.token || '').trim() || undefined;
  if (!name || !url) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return { name: name.slice(0, 100), url, token };
};

export const isTeamsNotificationEnabled = () => (
  String(process.env.TEAMS_NOTIFICATIONS_ENABLED || 'true').toLowerCase() !== 'false'
);

export const getTeamsWebhookDestinations = (): TeamsWebhookDestination[] => {
  const json = process.env.TEAMS_WEBHOOKS_JSON?.trim();
  let rawDestinations: any[] = [];

  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        throw new Error('TEAMS_WEBHOOKS_JSON phải là một mảng JSON');
      }
      rawDestinations = parsed;
    } catch (error: any) {
      throw new Error(`TEAMS_WEBHOOKS_JSON không hợp lệ: ${error.message}`);
    }
  } else {
    rawDestinations = String(process.env.TEAMS_WEBHOOK_URLS || '')
      .split(',')
      .map((url, index) => ({ name: `channel-${index + 1}`, url: url.trim() }))
      .filter((item) => item.url);
  }

  const destinations = rawDestinations
    .map(normalizeDestination)
    .filter((item): item is TeamsWebhookDestination => Boolean(item));
  const uniqueNames = new Set<string>();
  return destinations.filter((destination) => {
    if (uniqueNames.has(destination.name)) return false;
    uniqueNames.add(destination.name);
    return true;
  });
};

export const getTeamsWorkerConfig = () => ({
  pollIntervalMs: Math.max(1_000, Number(process.env.TEAMS_NOTIFICATION_POLL_INTERVAL_MS) || 5_000),
  requestTimeoutMs: Math.max(1_000, Number(process.env.TEAMS_NOTIFICATION_TIMEOUT_MS) || 10_000),
  maxAttempts: Math.max(1, Number(process.env.TEAMS_NOTIFICATION_MAX_ATTEMPTS) || 5),
  batchSize: Math.min(100, Math.max(1, Number(process.env.TEAMS_NOTIFICATION_BATCH_SIZE) || 20)),
});
