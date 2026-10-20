import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  buildEvgPlaybackUrl,
  buildEvgStreamName,
  extractEvgStreamAlias,
  resolveEvgRoomIds,
  provisionCalendarEvgStream,
  provisionCalendarsEvgBulk,
} from '../src/modules/livestream/evg-stream.service';
import {
  buildCalendarRoomClassId,
  excelDateSerialFromCalendarDate,
} from '../src/modules/livestream/calendar-user-sync.service';
import { createEvgLiveStream } from '../src/integrations/evg-live-stream.service';
import prisma from '../src/lib/prisma';

const mockEvgProvisioning = (context: TestContext, calendars: any[]) => {
  const env = { EVG_AUTH_KEY: 'test-key', EVG_CALLBACK_EVENT_URL: 'https://example.test/callback', EVG_REQUEST_INTERVAL_MS: '0' };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  context.after(() => {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
  const requests: string[] = [];
  const rooms: any[] = [];
  const configs: any[] = [];
  const originalRooms = prisma.stream.findMany;
  const originalConfigs = prisma.room_config.findMany;
  prisma.stream.findMany = (async () => rooms) as typeof prisma.stream.findMany;
  prisma.room_config.findMany = (async () => configs) as typeof prisma.room_config.findMany;
  context.after(() => {
    prisma.stream.findMany = originalRooms;
    prisma.room_config.findMany = originalConfigs;
  });
  context.mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
    const name = JSON.parse(options.body).name;
    requests.push(name);
    return new Response(JSON.stringify({ success: true, name, id: requests.length, stream_alias: `alias-${requests.length}`, stream_key: `key-${requests.length}` }), { status: 200 });
  });
  const findCalendar = async ({ where }: any) => calendars.find((calendar) => calendar.id === where.id) || null;
  const originalFindUnique = prisma.calendar.findUnique;
  prisma.calendar.findUnique = findCalendar as typeof prisma.calendar.findUnique;
  context.after(() => { prisma.calendar.findUnique = originalFindUnique; });
  const tx = {
    calendar: {
      findUnique: findCalendar,
      update: async ({ where, data }: any) => Object.assign(calendars.find((calendar) => calendar.id === where.id), data),
    },
    stream: { findMany: async () => [], upsert: async (data: any) => { rooms.push(data.create); return data.create; } },
    users: { findMany: async () => [] },
    room_config: { findUnique: async () => null, upsert: async (data: any) => { configs.push(data.create); return data.create; } },
  };
  context.mock.method(prisma, '$transaction', async (operation: any) => operation(tx));
  return { requests, rooms, configs };
};

const evgCalendar = (id: number, code: string) => ({ id, code, learn_number: 1, start_time: new Date('2026-10-14T22:00:00Z'), teacher: 'teacher-a', lesson_status: 0, evg_stream: null as string | null });

test('Feed tạo EVG, stream cho 25 phòng và room_config giống Livestream; bỏ qua khi đã có EVG', async (context) => {
  const calendar = evgCalendar(1, 'feed-tramtiepsuctrithuc');
  const { requests, rooms, configs } = mockEvgProvisioning(context, [calendar]);
  const result = await provisionCalendarEvgStream(1, 'admin', 'skip_existing', 'https://example.test/banner.jpg');
  assert.equal(result.skipped, false);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^feed-tramtiepsuctrithuc-1-/);
  assert.equal(rooms.length, 25);
  assert.ok(rooms.every((room) => room.code === calendar.code && room.stream_key.includes('alias-1')));
  assert.equal(configs[0].code, calendar.code);
  assert.equal(configs[0].config.stream_key, 'key-1');
  assert.equal(calendar.evg_stream, '1');
  assert.equal((await provisionCalendarEvgStream(1, 'admin', 'skip_existing')).skipped, true);
  assert.equal(requests.length, 1);
});

test('Feed có thể ghi đè EVG hiện có', async (context) => {
  const calendar = { ...evgCalendar(1, 'feed-tsa'), evg_stream: 'old-stream' };
  const { requests } = mockEvgProvisioning(context, [calendar]);
  const result = await provisionCalendarEvgStream(1, 'admin', 'overwrite', 'https://example.test/banner.jpg');
  assert.equal(result.operation, 'overwritten');
  assert.equal(requests.length, 1);
  assert.equal(calendar.evg_stream, '1');
});

test('chỉ có evg_stream nhưng chưa có phòng thì skip_existing vẫn tạo đủ cấu hình', async (context) => {
  const calendar = { ...evgCalendar(1, 'feed-tsa-1-2027'), evg_stream: 'old-stream', channel_name: 'old-name', lesson_link: 'old-key' };
  const { requests, rooms, configs } = mockEvgProvisioning(context, [calendar]);
  const result = await provisionCalendarEvgStream(1, 'admin', 'skip_existing', 'https://example.test/banner.jpg');
  assert.equal(result.skipped, false);
  assert.equal(requests.length, 1);
  assert.equal(rooms.length, 25);
  assert.equal(configs.length, 1);
});

test('thiếu banner không gọi EVG và không thay đổi trạng thái, kể cả khi ghi đè EVG cũ', async (context) => {
  const calendars = [evgCalendar(1, 'feed-tsa-1-2027'), { ...evgCalendar(2, 'feed-tsa-1-2027'), evg_stream: 'existing-stream' }];
  const original = calendars.map((calendar) => ({ ...calendar }));
  const { requests, rooms, configs } = mockEvgProvisioning(context, calendars);
  context.mock.method(prisma, '$queryRaw', async () => []);
  for (const calendar of calendars) {
    await assert.rejects(provisionCalendarEvgStream(calendar.id, 'admin', 'overwrite'), /Chưa cấu hình banner/);
  }
  assert.deepEqual(calendars, original);
  assert.equal(requests.length, 0);
  assert.equal(rooms.length, 0);
  assert.equal(configs.length, 0);
});

test('hàng loạt tạo EVG cho cả Feed và Livestream, vẫn chặn lịch nghỉ học', async (context) => {
  const calendars = [evgCalendar(1, 'feed-tsa'), evgCalendar(2, 'tsa'), { ...evgCalendar(3, 'feed-canceled'), lesson_status: 1 }];
  const { requests, rooms } = mockEvgProvisioning(context, calendars);
  const result = await provisionCalendarsEvgBulk([1, 2, 3], 'admin', 'overwrite', 'https://example.test/banner.jpg');
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.match(result.results[2].error!, /đã nghỉ học/);
  assert.equal(requests.length, 2);
  assert.equal(rooms.length, 50);
});

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
