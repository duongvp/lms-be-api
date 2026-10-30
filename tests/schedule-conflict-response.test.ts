import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { createBulk, ScheduleConflictError } from '../src/modules/livestream/livestream.service';
import { commitAutoSchedule } from '../src/modules/livestream/livestream.controller';

const conflict = {
  id: 735, calendar_source: 'livestream', code: 'QA-EXISTING', learn_number: 21,
  lesson_name: 'Phương pháp đọc hiểu văn bản hiệu quả',
  start_time: new Date('2031-11-02T21:30:00Z'), end_time: new Date('2031-11-02T23:30:00Z'),
  staff_type: 'teacher' as const, username: 'QA Teacher',
};

test('bulk create preserves structured conflict IDs and program when prefixing lesson errors', async () => {
  const transaction = prisma.$transaction;
  const expected = new ScheduleConflictError([conflict]);
  prisma.$transaction = (async (operation: any) => operation({
    $executeRawUnsafe: async () => 0,
    calendar: { findFirst: async () => null, findMany: async () => { throw expected; } },
  })) as any;
  try {
    await assert.rejects(createBulk({ calendars: [{
      code: 'QA-NEW', learn_number: 1, lesson_name: 'QA lesson', teacher: 'QA Teacher',
      skip_teacher_profile_validation: true,
      start_time: '2031-11-02T21:30:00Z', end_time: '2031-11-02T22:30:00Z',
    }] }), (error: unknown) => {
      assert.ok(error instanceof ScheduleConflictError);
      assert.match(error.message, /^Buổi 1 \(QA lesson\):/);
      assert.deepEqual(error.conflicts, [conflict]);
      return true;
    });
  } finally { prisma.$transaction = transaction; }
});

test('auto commit returns structured conflicts in HTTP response for frontend links', async () => {
  const transaction = prisma.$transaction;
  prisma.$transaction = (async () => { throw new ScheduleConflictError([conflict]); }) as any;
  let status = 0;
  let body: any;
  const res = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; } };
  try {
    await commitAutoSchedule({ body: {
      program_code: 'QA-NEW', system_type: 'topclass', start_date: '2031-11-02',
      blocks: [{ lessons: [{ learn_number: 1, lesson_name: 'QA lesson', sessions: [{ weekday: 1, start_time: '21:30', end_time: '22:30' }] }] }],
    } } as any, res as any, (() => assert.fail('Structured conflicts must reach response')) as any);
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.conflicts[0].id, 735);
    assert.equal(body.conflicts[0].code, 'QA-EXISTING');
  } finally { prisma.$transaction = transaction; }
});
