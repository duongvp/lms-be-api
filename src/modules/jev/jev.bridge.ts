import ApiError from '../../utils/ApiError';

type Operation = 'status' | 'reload' | 'validate' | 'preview';
/** Fixed server-side destination; never accept a URL or secret from the browser. */
export async function callJevChat(operation: Operation, body?: unknown, env = process.env, send = fetch) {
  const secret = env.JEV_INTERNAL_API_SECRET?.trim();
  let url: URL;
  try {
    url = new URL(env.JEV_CHAT_API_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/internal/jev-policy/' + operation;
  } catch { throw new ApiError('Chưa cấu hình JEV_CHAT_API_URL hợp lệ trên backend Admin', 503); }
  if (!secret || /[\r\n]/.test(secret)) throw new ApiError('Chưa cấu hình JEV_INTERNAL_API_SECRET trên backend Admin', 503);
  try {
    const response = await send(url, { method: operation === 'status' ? 'GET' : 'POST',
      headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' },
      ...(operation === 'status' ? {} : { body: JSON.stringify(body ?? {}) }),
      signal: AbortSignal.timeout(3000), redirect: 'error' });
    const result = await response.json() as Record<string, any>;
    if ([400, 422].includes(response.status)) throw new ApiError('Dữ liệu giả lập JEV không hợp lệ hoặc bộ cấu hình chưa hoàn chỉnh', response.status);
    if (!response.ok || result.success !== true) throw new ApiError('Chat chưa xác nhận thao tác JEV', 503);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Không kết nối được dịch vụ Chat JEV', 503);
  }
}

export async function reloadAfterCommit(reload = () => callJevChat('reload', {})) {
  try {
    const result = await reload();
    return { confirmed: result.notified === true, message: result.notified === true
      ? 'Đã lưu và gửi yêu cầu đồng bộ. Trạng thái phản ánh worker đang trả lời.'
      : 'Đã lưu, chưa xác nhận đồng bộ. Hãy thử đồng bộ lại.', status: result };
  } catch {
    return { confirmed: false, message: 'Đã lưu, chưa xác nhận đồng bộ. Hãy thử đồng bộ lại.' };
  }
}
