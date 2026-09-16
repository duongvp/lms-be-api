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

test('reports program-specific mapping errors and continues updating valid schedules', async () => {
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
    (prisma.users.findMany as any) = async () => [{ id: 10, username: 'student', code: 'toan-7-2027', learn_number: 13, class_id: 'old', room_id: 2, islearn: 1 }];
    let updates = 0;
    (prisma.users.updateMany as any) = async (query: any) => {
      updates += 1;
      assert.deepEqual(Object.keys(query.data).sort(), ['class_id', 'islearn', 'room_id']);
      assert.equal(query.data.room_id, 1);
      assert.equal(query.data.islearn, 0);
      return { count: 1 };
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
    assert.equal(job.result?.updated, 1);
    assert.equal(updates, 1);
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
