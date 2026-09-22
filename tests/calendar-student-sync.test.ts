import assert from 'node:assert/strict';
import { test } from 'node:test';
import prisma from '../src/lib/prisma';
import { startCalendarStudentSync, getCalendarStudentSyncJob } from '../src/modules/livestream/calendar-student-sync.service';

const waitForJob = async (jobId: string) => {
  for (let index = 0; index < 100; index += 1) {
    const job = getCalendarStudentSyncJob(jobId, 1);
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Job did not finish');
};

test('reports mapping errors and preserves existing enrollment without updating islearn', async () => {
  const originals = {
    calendars: prisma.calendar.findMany, mappings: prisma.package_lesson_mapping.findMany,
    users: prisma.users.findMany, update: prisma.users.updateMany, fetch: globalThis.fetch,
  };
  const calendars = [
    { id: 1, key: 'good', code: 'toan-7-2027', learn_number: 13, lesson_name: 'Toán', start_time: new Date('2026-09-16T18:00:00Z'), system_type: 'topclass' },
    { id: 2, key: 'missing', code: 'tienganh-7-2027', learn_number: 12, lesson_name: 'Tiếng Anh', start_time: new Date('2026-09-16T18:00:00Z'), system_type: 'topclass' },
  ];
  const oldUrl = process.env.HOCMAI_LIVE_USER_API_URL;
  const oldToken = process.env.HOCMAI_LIVE_USER_API_TOKEN;
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'test';
    (prisma.calendar.findMany as any) = async (query: any) => calendars.filter((row) => query.where.id.in.includes(row.id));
    (prisma.package_lesson_mapping.findMany as any) = async (query: any) => query.where.key.in.includes('good') ? [{ key: 'good', package_id: '9166' }] : [];
    (prisma.users.findMany as any) = async () => [{ username: 'student', code: 'toan-7-2027', learn_number: 13 }];
    let updates = 0;
    (prisma.users.updateMany as any) = async () => {
      updates += 1;
      throw new Error('Enrollment cũ không được phép cập nhật');
    };
    globalThis.fetch = async (url: any) => {
      assert.equal(new URL(String(url)).searchParams.has('registed_at'), false);
      return new Response(JSON.stringify({ status: 'success', total: 1, last_page: 1, data: [{ userid: 123, username: 'student', name: 'Student', product_id: '9166' }] }));
    };
    const started = startCalendarStudentSync([1, 2], undefined, 1);
    const job = await waitForJob(started.jobId);
    assert.equal(job.status, 'completed');
    assert.equal(job.progress, 100);
    assert.equal(job.items[0].status, 'success');
    assert.equal(job.items[1].status, 'error');
    assert.match(job.items[1].message, /tienganh-7-2027 - Bài 12/);
    assert.equal(job.result?.updated, 0);
    assert.equal(job.result?.skipped, 1);
    assert.equal(updates, 0);
  } finally {
    (prisma.calendar.findMany as any) = originals.calendars;
    (prisma.package_lesson_mapping.findMany as any) = originals.mappings;
    (prisma.users.findMany as any) = originals.users;
    (prisma.users.updateMany as any) = originals.update;
    globalThis.fetch = originals.fetch;
    if (oldUrl === undefined) delete process.env.HOCMAI_LIVE_USER_API_URL; else process.env.HOCMAI_LIVE_USER_API_URL = oldUrl;
    if (oldToken === undefined) delete process.env.HOCMAI_LIVE_USER_API_TOKEN; else process.env.HOCMAI_LIVE_USER_API_TOKEN = oldToken;
  }
});

test('rejects conflicting schedules before any API or database write', async () => {
  const original = prisma.calendar.findMany;
  const originalFetch = globalThis.fetch;
  try {
    (prisma.calendar.findMany as any) = async () => [1, 2].map((id) => ({
      id, code: 'toan-7-2027', learn_number: 13, lesson_name: 'Toán',
      start_time: new Date(`2026-09-${15 + id}T18:00:00Z`), system_type: 'topclass',
    }));
    globalThis.fetch = async () => { throw new Error('API must not be called'); };
    const job = await waitForJob(startCalendarStudentSync([1, 2], undefined, 1).jobId);
    assert.equal(job.status, 'failed');
    assert.match(job.error || '', /toan-7-2027 - Bài 13/);
  } finally {
    (prisma.calendar.findMany as any) = original;
    globalThis.fetch = originalFetch;
  }
});

test('processes API and database writes sequentially by program', async () => {
  const originals = {
    calendars: prisma.calendar.findMany, mappings: prisma.package_lesson_mapping.findMany,
    users: prisma.users.findMany, update: prisma.users.updateMany, fetch: globalThis.fetch,
    url: process.env.HOCMAI_LIVE_USER_API_URL, token: process.env.HOCMAI_LIVE_USER_API_TOKEN,
  };
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'test';
    const calendars = [1, 2].map((id) => ({
      id, key: `calendar-${id}`, code: `program-${id}`, learn_number: 1,
      lesson_name: 'Lesson', start_time: new Date('2026-09-17T18:00:00Z'), system_type: 'topclass',
    }));
    (prisma.calendar.findMany as any) = async (query: any) => calendars.filter((c) => query.where.id.in.includes(c.id));
    (prisma.package_lesson_mapping.findMany as any) = async (query: any) =>
      query.where.key.in.flatMap((key: string) => [
        { key, package_id: 'shared' }, { key, package_id: key === 'calendar-1' ? 'first' : 'second' },
      ]);
    (prisma.users.findMany as any) = async (query: any) => query.where.OR;
    (prisma.users.updateMany as any) = async () => {
      throw new Error('Enrollment cũ không được phép cập nhật');
    };
    const requests: string[][] = [];
    globalThis.fetch = async (rawUrl: any) => {
      const url = new URL(String(rawUrl));
      assert.equal(url.searchParams.get('registed_at'), '17/09/2026');
      const packages = [...url.searchParams.entries()].filter(([key]) => key.startsWith('packages[')).map(([, value]) => value);
      requests.push(packages);
      return new Response(JSON.stringify({
        status: 'success', total: '1', last_page: 1,
        data: [{ userid: 123, username: 'student', name: 'Student', product_id: 'shared' }],
      }));
    };
    const job = await waitForJob(startCalendarStudentSync([1, 2], '17/09/2026', 1).jobId);
    assert.equal(job.status, 'completed');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], ['shared', 'first']);
    assert.deepEqual(requests[1], ['shared', 'second']);
    assert.equal(job.result?.apiUsers, 2);
    assert.equal(job.items.reduce((sum, item) => sum + (item.result?.apiUsers || 0), 0), 2);
    assert.equal(job.result?.updated, 0);
    assert.equal(job.result?.skipped, 2);
  } finally {
    (prisma.calendar.findMany as any) = originals.calendars;
    (prisma.package_lesson_mapping.findMany as any) = originals.mappings;
    (prisma.users.findMany as any) = originals.users;
    (prisma.users.updateMany as any) = originals.update;
    globalThis.fetch = originals.fetch;
    if (originals.url === undefined) delete process.env.HOCMAI_LIVE_USER_API_URL; else process.env.HOCMAI_LIVE_USER_API_URL = originals.url;
    if (originals.token === undefined) delete process.env.HOCMAI_LIVE_USER_API_TOKEN; else process.env.HOCMAI_LIVE_USER_API_TOKEN = originals.token;
  }
});

test('returns the active job when the same user starts synchronization twice', async () => {
  const originals = {
    calendars: prisma.calendar.findMany, mappings: prisma.package_lesson_mapping.findMany,
    fetch: globalThis.fetch, url: process.env.HOCMAI_LIVE_USER_API_URL,
    token: process.env.HOCMAI_LIVE_USER_API_TOKEN,
  };
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'test';
    (prisma.calendar.findMany as any) = async () => [{
      id: 1, key: 'calendar-1', code: 'program-1', learn_number: 1,
      lesson_name: 'Lesson', start_time: new Date('2026-09-21T18:00:00Z'), system_type: 'topclass',
    }];
    (prisma.package_lesson_mapping.findMany as any) = async () => [{ key: 'calendar-1', package_id: '9150' }];
    globalThis.fetch = async () => {
      await fetchGate;
      return new Response(JSON.stringify({ status: 'success', total: 0, last_page: 1, data: [] }));
    };

    const first = startCalendarStudentSync([1], undefined, 1);
    const second = startCalendarStudentSync([1], undefined, 1);
    assert.equal(second.jobId, first.jobId);
    assert.equal(second.resumed, true);

    releaseFetch();
    const job = await waitForJob(first.jobId);
    assert.equal(job.status, 'completed');
  } finally {
    releaseFetch?.();
    (prisma.calendar.findMany as any) = originals.calendars;
    (prisma.package_lesson_mapping.findMany as any) = originals.mappings;
    globalThis.fetch = originals.fetch;
    if (originals.url === undefined) delete process.env.HOCMAI_LIVE_USER_API_URL; else process.env.HOCMAI_LIVE_USER_API_URL = originals.url;
    if (originals.token === undefined) delete process.env.HOCMAI_LIVE_USER_API_TOKEN; else process.env.HOCMAI_LIVE_USER_API_TOKEN = originals.token;
  }
});

test('deduplicates enrollment but keeps one user across multiple lessons', async () => {
  const originals = {
    calendars: prisma.calendar.findMany,
    mappings: prisma.package_lesson_mapping.findMany,
    users: prisma.users.findMany,
    create: prisma.users.createMany,
    fetch: globalThis.fetch,
    url: process.env.HOCMAI_LIVE_USER_API_URL,
    token: process.env.HOCMAI_LIVE_USER_API_TOKEN,
  };
  try {
    process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
    process.env.HOCMAI_LIVE_USER_API_TOKEN = 'test';
    const calendars = [1, 2].map((id) => ({
      id, key: `calendar-${id}`, code: 'toan-7-2027', learn_number: id,
      lesson_name: `Bài ${id}`, start_time: new Date(`2026-09-${16 + id}T18:00:00Z`), system_type: 'topclass',
    }));
    (prisma.calendar.findMany as any) = async (query: any) => calendars.filter((row) => query.where.id.in.includes(row.id));
    (prisma.package_lesson_mapping.findMany as any) = async (query: any) =>
      query.where.key.in.map((key: string) => ({ key, package_id: 'shared' }));
    (prisma.users.findMany as any) = async () => [];
    const inserted: any[] = [];
    (prisma.users.createMany as any) = async (query: any) => {
      inserted.push(...query.data);
      return { count: query.data.length };
    };
    globalThis.fetch = async () => new Response(JSON.stringify({
      status: 'success', total: 2, last_page: 1,
      data: [
        { userid: 123, username: 'student', name: 'Student', product_id: 'shared' },
        { userid: 123, username: 'student', name: 'Student', product_id: 'shared' },
      ],
    }));

    const job = await waitForJob(startCalendarStudentSync([1, 2], undefined, 1).jobId);
    assert.equal(job.status, 'completed');
    assert.equal(job.items.length, 1);
    assert.equal(job.result?.apiUsers, 2);
    assert.equal(job.result?.uniqueApiUsers, 1);
    assert.equal(job.result?.mappedRows, 4);
    assert.equal(job.result?.uniqueEnrollments, 2);
    assert.equal(job.result?.duplicateRows, 2);
    assert.equal(job.result?.duplicateDetails.length, 2);
    assert.deepEqual(job.result?.duplicateDetails.map((row) => ({
      username: row.username,
      code: row.code,
      learnNumber: row.learnNumber,
      productId: row.productId,
      duplicateOfProductId: row.duplicateOfProductId,
    })), [
      { username: 'student', code: 'toan-7-2027', learnNumber: 1, productId: 'shared', duplicateOfProductId: 'shared' },
      { username: 'student', code: 'toan-7-2027', learnNumber: 2, productId: 'shared', duplicateOfProductId: 'shared' },
    ]);
    assert.equal(job.result?.inserted, 2);
    assert.deepEqual(inserted.map((row) => row.learn_number).sort(), [1, 2]);
    assert.ok(inserted.every((row) => row.islearn === 0));
  } finally {
    (prisma.calendar.findMany as any) = originals.calendars;
    (prisma.package_lesson_mapping.findMany as any) = originals.mappings;
    (prisma.users.findMany as any) = originals.users;
    (prisma.users.createMany as any) = originals.create;
    globalThis.fetch = originals.fetch;
    if (originals.url === undefined) delete process.env.HOCMAI_LIVE_USER_API_URL; else process.env.HOCMAI_LIVE_USER_API_URL = originals.url;
    if (originals.token === undefined) delete process.env.HOCMAI_LIVE_USER_API_TOKEN; else process.env.HOCMAI_LIVE_USER_API_TOKEN = originals.token;
  }
});
