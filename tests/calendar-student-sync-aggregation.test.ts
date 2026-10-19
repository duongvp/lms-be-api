import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { runCalendarStudentSync } from '../src/modules/livestream/calendar-student-sync.worker';

type ApiUser = { userid: string; username: string; name: string; product_id: string };
type ApiReply = { status: string; total?: number; last_page?: number; data?: ApiUser[] };

const runMockedCron = async (
  mappings: Array<{ key: string; package_id: string }>,
  reply: (products: string[]) => ApiReply,
  rejectWrites = false,
  programCodes = ['program-a', 'program-b']
) => {
  const originals = {
    execute: prisma.$executeRaw, query: prisma.$queryRaw,
    calendars: prisma.calendar.findMany, updateCalendars: prisma.calendar.updateMany,
    mappings: prisma.package_lesson_mapping.findMany,
    users: prisma.users.findMany, create: prisma.users.createMany,
    fetch: globalThis.fetch, url: process.env.HOCMAI_LIVE_USER_API_URL,
    token: process.env.HOCMAI_LIVE_USER_API_TOKEN,
  };
  const calendars = [
    { id: 1, key: 'calendar-a', code: programCodes[0], learn_number: 1, start_time: new Date('2026-09-30T18:00:00Z') },
    { id: 2, key: 'calendar-b', code: programCodes[1], learn_number: 1, start_time: new Date('2026-09-30T19:00:00Z') },
  ];
  const requests: string[][] = [];
  const inserted: Array<{ username: string; code: string }> = [];
  const marked: number[] = [];
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'test';
    (prisma.$executeRaw as any) = async () => 1;
    (prisma.$queryRaw as any) = async () => [{ id: 1n, db_now: new Date('2026-09-30T18:00:00Z') }];
    (prisma.calendar.findMany as any) = async (query: any) => query.where?.id?.in
      ? calendars.filter((row) => query.where.id.in.includes(row.id)) : calendars;
    (prisma.calendar.updateMany as any) = async ({ where }: any) => {
      marked.push(...where.id.in);
      return { count: 1 };
    };
    (prisma.package_lesson_mapping.findMany as any) = async (query: any) =>
      mappings.filter((row) => query.where.key.in.includes(row.key));
    (prisma.users.findMany as any) = async () => [];
    (prisma.users.createMany as any) = async ({ data }: any) => {
      if (rejectWrites) return { count: 0 };
      inserted.push(...data);
      return { count: data.length };
    };
    globalThis.fetch = async (rawUrl: any) => {
      const url = new URL(String(rawUrl));
      const products = [...url.searchParams.entries()]
        .filter(([key]) => key.startsWith('packages[')).map(([, value]) => value);
      requests.push(products);
      return new Response(JSON.stringify(reply(products)));
    };
    const result = await runCalendarStudentSync(new Date('2026-09-30T11:00:00Z'));
    return { result, requests, inserted, marked };
  } finally {
    (prisma.$executeRaw as any) = originals.execute;
    (prisma.$queryRaw as any) = originals.query;
    (prisma.calendar.findMany as any) = originals.calendars;
    (prisma.calendar.updateMany as any) = originals.updateCalendars;
    (prisma.package_lesson_mapping.findMany as any) = originals.mappings;
    (prisma.users.findMany as any) = originals.users;
    (prisma.users.createMany as any) = originals.create;
    globalThis.fetch = originals.fetch;
    if (originals.url === undefined) delete process.env.HOCMAI_LIVE_USER_API_URL;
    else process.env.HOCMAI_LIVE_USER_API_URL = originals.url;
    if (originals.token === undefined) delete process.env.HOCMAI_LIVE_USER_API_TOKEN;
    else process.env.HOCMAI_LIVE_USER_API_TOKEN = originals.token;
  }
};

test('cron fetches shared packages once and dispatches each user to matching programs', async () => {
  const mappings = [
    { key: 'calendar-a', package_id: 'shared' },
    { key: 'calendar-a', package_id: 'a' },
    { key: 'calendar-b', package_id: 'shared' },
    { key: 'calendar-b', package_id: 'b' },
  ];
  const users: ApiUser[] = [
    { userid: '1', username: 'shared-user', name: 'Shared', product_id: 'shared' },
    { userid: '2', username: 'a-user', name: 'A', product_id: 'a' },
    { userid: '3', username: 'b-user', name: 'B', product_id: 'b' },
  ];
  const { result, requests, inserted } = await runMockedCron(mappings, () => ({
    status: 'success', total: 3, last_page: 1, data: users,
  }));
  assert.equal(result.started, true);
  assert.equal(result.inserted, 4);
  assert.deepEqual(requests, [['shared', 'a', 'b']]);
  assert.deepEqual(inserted.map((row) => row.username + '/' + row.code).sort(), [
    'a-user/program-a', 'b-user/program-b', 'shared-user/program-a', 'shared-user/program-b',
  ]);
});

test('cron reports rejected enrollments as errors and does not mark calendars synced', async () => {
  const { result, marked } = await runMockedCron([
    { key: 'calendar-a', package_id: 'a' },
    { key: 'calendar-b', package_id: 'b' },
  ], (products) => ({ status: 'success', total: products.length, last_page: 1,
    data: products.map((product_id) => ({ userid: product_id, username: product_id, name: 'Student', product_id })),
  }), true);
  assert.equal(result.status, 'completed_with_errors');
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(marked, []);
});

test('cron does not mark a program synced when its API rows do not match any package', async () => {
  const { result, marked, requests } = await runMockedCron([
    { key: 'calendar-a', package_id: 'a' },
    { key: 'calendar-b', package_id: 'b' },
  ], () => ({status: 'success', total: 1, last_page: 1, data: [
    {userid: '1', username: 'student', name: 'Student', product_id: 'unexpected-package'},
  ]}));
  // Combined results for unrelated packages must not silently become an empty
  // successful run. Retry individual programs to expose the mapping mismatch.
  assert.equal(result.status, 'completed_with_errors');
  assert.equal(result.inserted, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(requests, [['a', 'b'], ['a'], ['b']]);
  assert.deepEqual(marked, []);
});

test('cron falls back to per-program API calls when combined request fails', async () => {
  const mappings = [
    { key: 'calendar-a', package_id: 'a' },
    { key: 'calendar-b', package_id: 'b' },
  ];
  const { result, requests, inserted } = await runMockedCron(mappings, (products) =>
    products.length > 1
      ? { status: 'error' }
      : { status: 'success', total: 1, last_page: 1, data: [{
        userid: products[0], username: products[0] + '-user', name: 'Student', product_id: products[0],
      }] }
  );
  assert.equal(result.started, true);
  assert.equal(result.inserted, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(requests, [['a', 'b'], ['a'], ['b']]);
  assert.equal(inserted.length, 2);
});

test('cron retries by program when combined API returns fewer users than total', async () => {
  const mappings = [
    { key: 'calendar-a', package_id: 'a' },
    { key: 'calendar-b', package_id: 'b' },
  ];
  const { result, requests } = await runMockedCron(mappings, (products) =>
    products.length > 1
      ? { status: 'success', total: 3, last_page: 1, data: [{
        userid: 'a', username: 'a-user', name: 'Student', product_id: 'a',
      }] }
      : { status: 'success', total: 1, last_page: 1, data: [{
        userid: products[0], username: products[0] + '-user', name: 'Student', product_id: products[0],
      }] }
  );
  assert.equal(result.inserted, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(requests, [['a', 'b'], ['a'], ['b']]);
});

for (const feedCode of ['feed-program-b', 'FEED-program-b', 'FeEd-program-b']) {
  test(`cron excludes ${feedCode} before fetching packages, inserting or marking synced`, async () => {
    const { result, requests, inserted, marked } = await runMockedCron([
      { key: 'calendar-a', package_id: 'a' },
      { key: 'calendar-b', package_id: 'feed-only' },
    ], products => ({ status: 'success', total: products.length, last_page: 1,
      data: products.map(product_id => ({userid: product_id, username: product_id, name: 'Student', product_id})),
    }), false, ['program-a', feedCode]);
    assert.equal(result.status, 'completed');
    assert.equal(result.calendars, 1);
    assert.equal(result.programs, 1);
    assert.equal(result.inserted, 1);
    assert.deepEqual(requests, [['a']]);
    assert.deepEqual(inserted.map(row => row.code), ['program-a']);
    assert.deepEqual(marked, [1]);
  });
}

test('cron with only Feed calendars performs no API requests or enrollment writes', async () => {
  const { result, requests, inserted, marked } = await runMockedCron([
    { key: 'calendar-a', package_id: 'feed-a' },
    { key: 'calendar-b', package_id: 'feed-b' },
  ], () => { throw new Error('Feed must not call HOCMAI'); }, false, ['feed-a', 'FEED-b']);
  assert.equal(result.status, 'completed');
  assert.equal(result.calendars, 0);
  assert.equal(result.programs, 0);
  assert.equal(result.inserted, 0);
  assert.deepEqual(requests, []);
  assert.deepEqual(inserted, []);
  assert.deepEqual(marked, []);
});
