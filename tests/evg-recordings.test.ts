import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvgRecordingReader, parseEvgRecordingTime, selectEvgRecordingRanges } from '../src/integrations/evg-recordings.service';

const records = [
  { channel_id: 76861, start_on: '17-10-2026 21:55:27', finish_on: '18-10-2026 00:09:48' },
  { channel_id: 76861, start_on: '15-10-2026 12:14:09', finish_on: '15-10-2026 13:19:54' },
  { channel_id: 76861, start_on: '14-10-2026 20:41:16', finish_on: '14-10-2026 23:11:07' },
  { channel_id: 76861, start_on: '14-10-2026 20:39:41', finish_on: '14-10-2026 20:40:51' },
  { channel_id: 76861, start_on: '13-10-2026 22:15:13', finish_on: '13-10-2026 22:19:37' },
];
const calendar = (id: number, day: string, channel = '76861') => ({ id, start_time: new Date(`${day}T21:00:00Z`), evg_stream: channel });

test('chọn đúng ngày và gộp từ giờ bắt đầu sớm nhất đến kết thúc muộn nhất', () => {
  assert.deepEqual(selectEvgRecordingRanges(records, '76861', '2026-10-14'), [
    { start_time: '2026-10-14T20:39:41.000Z', end_time: '2026-10-14T23:11:07.000Z' },
  ]);
  assert.equal(selectEvgRecordingRanges(records, '76861', '2026-10-16').length, 0);
  assert.deepEqual(selectEvgRecordingRanges(records, '76861', '2026-10-17'), [
    { start_time: '2026-10-17T21:55:27.000Z', end_time: '2026-10-18T00:09:48.000Z' },
  ]);
});

test('loại bản ghi trùng, khác kênh, ngày/giờ sai và kết thúc trước bắt đầu', () => {
  assert.equal(selectEvgRecordingRanges([...records, records[2],
    { ...records[2], channel_id: 999 },
    { ...records[2], start_on: '31-02-2026 20:41:16' },
    { ...records[2], finish_on: '14-10-2026 20:00:00' },
    { ...records[2], finish_on: null },
  ], '76861', '2026-10-14').length, 1);
  for (const input of [null, '', '2026-10-14T21:00:00Z', '14-10-2026 25:00:00', '31-04-2026 21:00:00']) assert.equal(parseEvgRecordingTime(input), null);
});

test('cùng evg_stream đọc một lần, cache và ghép riêng từng ngày; khóa chỉ nằm ở GET backend', async () => {
  let calls = 0;
  const read = createEvgRecordingReader({ requestIntervalMs: 0, authKey: 'test-key', fetcher: async (url, options) => {
    calls++;
    assert.equal(url, 'https://live-api.evgcdn.net/api/v1.0/live-stream/mp4-records/76861');
    assert.equal(options?.method, 'GET');
    assert.equal((options?.headers as any)['X-Auth-Key'], 'test-key');
    return new Response(JSON.stringify({ error_code: 0, data: records }));
  } });
  const result = await read([calendar(1, '2026-10-14'), calendar(2, '2026-10-17'), calendar(3, '2026-10-16'), calendar(4, '2026-10-14', '')]);
  assert.equal(calls, 1);
  assert.equal(result.get(1)?.ranges.length, 1);
  assert.equal(result.get(2)?.ranges.length, 1);
  assert.equal(result.get(3)?.status, 'empty');
  assert.equal(result.get(4)?.status, 'no_stream');
  await read([calendar(1, '2026-10-14')]);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify([...result]).includes('test-key'));
});

test('lỗi HTTP/API/timeout không làm hỏng báo cáo và không cache lỗi', async () => {
  for (const failure of [async () => new Response('{}', { status: 503 }), async () => new Response('{"error_code":1,"data":[]}'), async () => new Response('invalid-json'), async () => { throw new Error('timeout'); }]) {
    let calls = 0;
    const read = createEvgRecordingReader({ requestIntervalMs: 0, authKey: 'test-key', fetcher: async () => { calls++; return failure(); } });
    assert.equal((await read([calendar(1, '2026-10-14')])).get(1)?.status, 'error');
    assert.equal((await read([calendar(1, '2026-10-14')])).get(1)?.status, 'error');
    assert.equal(calls, 2);
  }
});

test('giới hạn 4 GET song song và gộp yêu cầu cùng kênh giữa hai báo cáo', async () => {
  let active = 0, peak = 0, calls = 0;
  const read = createEvgRecordingReader({ requestIntervalMs: 0, authKey: 'test-key', fetcher: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return new Response('{"error_code":0,"data":[]}');
  } });
  const calendars = Array.from({ length: 10 }, (_, index) => calendar(index, '2026-10-14', String(index + 1)));
  await Promise.all([read(calendars), read(calendars)]);
  assert.equal(calls, 10);
  assert.ok(peak <= 4);
});

test('429 thử lại theo Retry-After rồi trả giờ live, chỉ cache kết quả thành công', async () => {
  let calls = 0;
  const started = Date.now();
  const read = createEvgRecordingReader({ requestIntervalMs: 0, authKey: 'test-key', fetcher: async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0.02' } })
      : new Response(JSON.stringify({ error_code: 0, data: records }));
  } });
  const result = await read([calendar(1, '2026-10-14')]);
  assert.equal(result.get(1)?.status, 'ready');
  assert.equal(result.get(1)?.ranges.length, 1);
  assert.equal(calls, 2);
  assert.ok(Date.now() - started >= 15, 'phải chờ Retry-After');
  await read([calendar(1, '2026-10-14')]);
  assert.equal(calls, 2);
});

test('429 liên tục dừng sau giới hạn, có mã lỗi rõ ràng và không cache lỗi', async () => {
  let calls = 0;
  const read = createEvgRecordingReader({ requestIntervalMs: 0, retryDelayMs: 1, maxRetries: 2, authKey: 'test-key', fetcher: async () => {
    calls++;
    return new Response('', { status: 429 });
  } });
  const result = await read([calendar(1, '2026-10-14')]);
  assert.equal(result.get(1)?.error_code, 'rate_limited');
  assert.equal(calls, 3);
  await read([calendar(1, '2026-10-14')]);
  assert.equal(calls, 6);
});

test('giãn nhịp GET dùng chung giữa các báo cáo đồng thời, không chỉ giới hạn số GET song song', async () => {
  const starts: number[] = [];
  const read = createEvgRecordingReader({ requestIntervalMs: 20, authKey: 'test-key', fetcher: async () => {
    starts.push(Date.now());
    return new Response('{"error_code":0,"data":[]}');
  } });
  await Promise.all([read([calendar(1, '2026-10-14', '1'), calendar(2, '2026-10-14', '2')]),
    read([calendar(3, '2026-10-14', '3'), calendar(4, '2026-10-14', '4')])]);
  assert.equal(starts.length, 4);
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] - starts[index - 1] >= 18);
});


test('buổi đã kết thúc được cache theo kênh/ngày, không gọi EVG lại dù cache thô đã hết hạn', async () => {
  let calls = 0;
  const read = createEvgRecordingReader({ requestIntervalMs: 0, cacheTtlMs: 0, authKey: 'test-key', fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ channel_id: 76861, start_on: '14-10-2000 19:18:47', finish_on: '14-10-2000 20:06:28' }], error_code: 0 }));
  } });
  const result = await read([calendar(1, '2000-10-14')]);
  assert.equal(result.get(1)?.status, 'ready');
  const cached = await read([calendar(2, '2000-10-14')]);
  assert.equal(cached.get(2)?.status, 'ready');
  assert.equal(calls, 1);
});
