import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEvgPlaybackUrl,
  buildEvgStreamName,
  extractEvgStreamAlias,
  resolveEvgRoomIds,
} from '../src/modules/livestream/evg-stream.service';
import {
  buildCalendarRoomClassId,
  excelDateSerialFromCalendarDate,
} from '../src/modules/livestream/calendar-user-sync.service';
import { createEvgLiveStream } from '../src/integrations/evg-live-stream.service';

test('tên EVG dùng cùng Excel Date Serial với class_id', () => {
  const startTime = new Date('2026-09-20T19:30:00.000Z');
  assert.equal(excelDateSerialFromCalendarDate(startTime), 46285);
  assert.equal(buildEvgStreamName('TOÁN-6', 2, startTime), 'toan-6-2-46285');
  assert.equal(buildCalendarRoomClassId('TOÁN-6', startTime, 2, 25), 'TOÁN-646285225');
});

test('tên EVG chuẩn hóa tiếng Việt và ký tự phân cách', () => {
  assert.equal(
    buildEvgStreamName('Địa lý 7 / 2027', 16, new Date('2026-09-20T08:00:00.000Z')),
    'dia-ly-7-2027-16-46285'
  );
  assert.equal(
    extractEvgStreamAlias('https://evg-stream.hocmai.net/live/sample-stream-alias/playlist.m3u8'),
    'sample-stream-alias'
  );
});

test('từ chối code hoặc learn_number không hợp lệ', () => {
  const startTime = new Date('2026-09-20T08:00:00.000Z');
  assert.throws(() => buildEvgStreamName('', 1, startTime), /code hợp lệ/);
  assert.throws(() => buildEvgStreamName('TOAN-6', 0, startTime), /learn_number hợp lệ/);
});

test('stream.stream_key dùng URL phát HLS từ EVG stream_alias', () => {
  assert.equal(
    buildEvgPlaybackUrl('sample-stream-alias'),
    'https://evg-stream.hocmai.net/live/sample-stream-alias/playlist.m3u8'
  );
  assert.throws(() => buildEvgPlaybackUrl(''), /stream alias không hợp lệ/);
});

test('EVG luôn tạo tối thiểu 25 room và mở rộng theo room đã phân', () => {
  const roomIds = resolveEvgRoomIds([1, 2, 30, 30, null, 0, -1, 'abc']);
  assert.equal(roomIds.length, 26);
  assert.deepEqual(roomIds.slice(0, 25), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal(roomIds.at(-1), 30);
});

test('tự thử lại khi EVG trả HTTP 429', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    auth: process.env.EVG_AUTH_KEY,
    callback: process.env.EVG_CALLBACK_EVENT_URL,
    interval: process.env.EVG_REQUEST_INTERVAL_MS,
    retries: process.env.EVG_RATE_LIMIT_MAX_RETRIES,
    retryBase: process.env.EVG_RATE_LIMIT_RETRY_BASE_MS,
  };
  process.env.EVG_AUTH_KEY = 'test-key';
  process.env.EVG_CALLBACK_EVENT_URL = 'https://example.test/evg';
  process.env.EVG_REQUEST_INTERVAL_MS = '0';
  process.env.EVG_RATE_LIMIT_MAX_RETRIES = '2';
  process.env.EVG_RATE_LIMIT_RETRY_BASE_MS = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '0' } });
    return new Response(JSON.stringify({
      success: true,
      name: 'toan-6-1-46285',
      id: 123,
      stream_alias: 'alias-123',
      stream_key: 'key-123',
    }), { status: 200 });
  };
  try {
    const result = await createEvgLiveStream('toan-6-1-46285');
    assert.equal(calls, 2);
    assert.equal(result.streamAlias, 'alias-123');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv.auth === undefined) delete process.env.EVG_AUTH_KEY; else process.env.EVG_AUTH_KEY = originalEnv.auth;
    if (originalEnv.callback === undefined) delete process.env.EVG_CALLBACK_EVENT_URL; else process.env.EVG_CALLBACK_EVENT_URL = originalEnv.callback;
    if (originalEnv.interval === undefined) delete process.env.EVG_REQUEST_INTERVAL_MS; else process.env.EVG_REQUEST_INTERVAL_MS = originalEnv.interval;
    if (originalEnv.retries === undefined) delete process.env.EVG_RATE_LIMIT_MAX_RETRIES; else process.env.EVG_RATE_LIMIT_MAX_RETRIES = originalEnv.retries;
    if (originalEnv.retryBase === undefined) delete process.env.EVG_RATE_LIMIT_RETRY_BASE_MS; else process.env.EVG_RATE_LIMIT_RETRY_BASE_MS = originalEnv.retryBase;
  }
});
