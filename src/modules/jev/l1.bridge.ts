import ApiError from '../../utils/ApiError';

export async function callL1Chat(operation: 'status' | 'reload', env = process.env, send = fetch) {
  let url: URL;
  try {
    url = new URL(env.JEV_CHAT_API_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/internal/chat-policy-' + operation;
  } catch { throw new ApiError('Chưa cấu hình JEV_CHAT_API_URL hợp lệ trên backend Admin', 503); }
  const secret = env.JEV_INTERNAL_API_SECRET?.trim();
  if (!secret || /[\r\n]/.test(secret)) throw new ApiError('Chưa cấu hình JEV_INTERNAL_API_SECRET trên backend Admin', 503);
  try {
    const response = await send(url, { method: operation === 'status' ? 'GET' : 'POST', redirect: 'error',
      headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' },
      ...(operation === 'reload' ? { body: '{}' } : {}), signal: AbortSignal.timeout(3000) });
    const result = await response.json() as Record<string, any>;
    if (!response.ok || result.success !== true) throw new ApiError(`Live chưa xác nhận L1 (HTTP ${response.status}).`, 503);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Không kết nối được bộ lọc L1 trên Live.', 503);
  }
}

export async function synchronizeL1(revision: number, reload = () => callL1Chat('reload')) {
  try {
    const status = await reload();
    const confirmed = status.policy?.source === 'database' && Number.isSafeInteger(status.policy?.revision) && status.policy.revision >= revision;
    return { confirmed, revision, message: confirmed
      ? 'Đã lưu; worker trả lời đã nạp cấu hình L1. Chưa xác nhận toàn cụm.'
      : 'Đã lưu, chưa xác nhận đồng bộ L1. Chỉ thử đồng bộ lại, không lưu lại thay đổi.', status };
  } catch {
    return { confirmed: false, revision, message: 'Đã lưu, chưa xác nhận đồng bộ L1. Chỉ thử đồng bộ lại, không lưu lại thay đổi.' };
  }
}
