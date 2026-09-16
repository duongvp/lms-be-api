type HocmaiUserSearchItem = {
  username?: unknown;
  user_id?: unknown;
};

export type HocmaiUserIdentityResult = {
  studentHmid: string | null;
  status: 'pending' | 'synced' | 'not_found' | 'failed';
  error: string | null;
};

const safeMessage = (value: unknown) => String(value || 'Không thể tra cứu HMID')
  .replace(/[\r\n]+/g, ' ')
  .slice(0, 500);

export const findHocmaiUserIdentity = async (
  rawUsername: string
): Promise<HocmaiUserIdentityResult> => {
  const username = String(rawUsername || '').trim();
  const url = String(process.env.HOCMAI_USER_SEARCH_URL || '').trim();
  const apiKey = String(process.env.HOCMAI_USER_SEARCH_API_KEY || '').trim();
  if (!url || !apiKey) {
    return { studentHmid: null, status: 'pending', error: null };
  }

  const configuredTimeout = Number(process.env.HOCMAI_USER_SEARCH_TIMEOUT_MS || 8_000);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(configuredTimeout, 30_000)
    : 8_000;
  try {
    const headers: Record<string, string> = {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    };
    const cookie = String(process.env.HOCMAI_USER_SEARCH_COOKIE || '').trim();
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ usernames: [username] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success' || !Array.isArray(payload?.data)) {
      return {
        studentHmid: null,
        status: 'failed',
        error: safeMessage(`HOCMAI user-search trả phản hồi không hợp lệ (${response.status})`),
      };
    }

    const matched = (payload.data as HocmaiUserSearchItem[]).find(
      (item) => String(item?.username || '').trim().toLocaleLowerCase()
        === username.toLocaleLowerCase()
    );
    if (!matched) {
      return { studentHmid: null, status: 'not_found', error: null };
    }
    const studentHmid = String(matched.user_id ?? '').trim();
    if (!/^\d+$/.test(studentHmid) || BigInt(studentHmid) <= 0n) {
      return {
        studentHmid: null,
        status: 'failed',
        error: 'HOCMAI trả user_id không hợp lệ',
      };
    }
    return { studentHmid, status: 'synced', error: null };
  } catch (error: any) {
    return {
      studentHmid: null,
      status: 'failed',
      error: safeMessage(error?.name === 'TimeoutError'
        ? 'HOCMAI user-search bị timeout'
        : error?.message),
    };
  }
};
