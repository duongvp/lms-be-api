type EvgCreateResponse = {
  success?: boolean;
  name?: string;
  id?: string | number;
  stream_alias?: string;
  stream_key?: string;
  error?: string;
  data?: EvgCreateResponse;
};

export type CreatedEvgStream = {
  name: string;
  id: string;
  streamAlias: string;
  streamKey: string;
};

const requiredConfig = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Thiếu cấu hình ${name}`);
  return value;
};

const positiveIntegerConfig = (name: string, fallback: number) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} phải là số nguyên dương`);
  return value;
};

const nonNegativeIntegerConfig = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} phải là số nguyên không âm`);
  return value;
};

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
let nextEvgRequestAt = 0;

const waitForEvgRequestSlot = async (intervalMs: number) => {
  const delayMs = Math.max(0, nextEvgRequestAt - Date.now());
  if (delayMs) await wait(delayMs);
  nextEvgRequestAt = Date.now() + intervalMs;
};

const retryAfterMilliseconds = (response: Response, retryIndex: number, baseDelayMs: number) => {
  const header = String(response.headers.get('retry-after') || '').trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const retryDate = new Date(header).getTime();
    if (Number.isFinite(retryDate)) return Math.max(0, retryDate - Date.now());
  }
  return Math.min(baseDelayMs * (2 ** retryIndex), 30_000);
};

export const createEvgLiveStream = async (name: string): Promise<CreatedEvgStream> => {
  const baseUrl = String(process.env.EVG_API_BASE_URL || 'https://live-api.evgcdn.net').replace(/\/+$/, '');
  const timeoutMs = positiveIntegerConfig('EVG_REQUEST_TIMEOUT_MS', 15_000);
  const intervalMs = nonNegativeIntegerConfig('EVG_REQUEST_INTERVAL_MS', 1_500);
  const maxRetries = nonNegativeIntegerConfig('EVG_RATE_LIMIT_MAX_RETRIES', 5);
  const retryBaseDelayMs = positiveIntegerConfig('EVG_RATE_LIMIT_RETRY_BASE_MS', 5_000);
  let response: Response | undefined;
  for (let retryIndex = 0; retryIndex <= maxRetries; retryIndex += 1) {
    await waitForEvgRequestSlot(intervalMs);
    response = await fetch(`${baseUrl}/api/v1.0/live-stream/create`, {
      method: 'POST',
      headers: {
        'X-Auth-Key': requiredConfig('EVG_AUTH_KEY'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name,
        callback_event_url: requiredConfig('EVG_CALLBACK_EVENT_URL'),
        enable_record_mp4: Number(process.env.EVG_ENABLE_RECORD_MP4 ?? 1),
        s3_storage_id: positiveIntegerConfig('EVG_S3_STORAGE_ID', 74),
        profile_id: positiveIntegerConfig('EVG_PROFILE_ID', 7),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 429) break;
    if (retryIndex === maxRetries) {
      throw new Error(`EVG giới hạn tần suất (HTTP 429) sau ${maxRetries} lần thử lại`);
    }
    const delayMs = retryAfterMilliseconds(response, retryIndex, retryBaseDelayMs);
    nextEvgRequestAt = Math.max(nextEvgRequestAt, Date.now() + delayMs);
  }
  if (!response) throw new Error('Không nhận được phản hồi từ EVG');

  let raw: EvgCreateResponse;
  try {
    const responseText = await response.text();
    raw = JSON.parse(responseText) as EvgCreateResponse;
  } catch {
    throw new Error(`EVG trả dữ liệu không hợp lệ (HTTP ${response.status})`);
  }
  const data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (!response.ok || raw.success === false || data.success === false) {
    throw new Error(String(data.error || raw.error || `EVG HTTP ${response.status}`));
  }
  const streamName = String(data.name || '').trim();
  const id = String(data.id ?? '').trim();
  const streamAlias = String(data.stream_alias || '').trim();
  const streamKey = String(data.stream_key || '').trim();
  if (!streamName || !id || !streamAlias || !streamKey) {
    throw new Error('EVG không trả đủ name, id, stream_alias hoặc stream_key');
  }
  return {
    name: streamName,
    id,
    streamAlias,
    streamKey,
  };
};
