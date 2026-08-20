const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const code = 'ZZ_IMPORT_T91';
const packageId = '999901';
const courseId = '999801';
const lessonId = 'child-content-id';
const expectedKey = 'tc_3132_ZZ_IMPORT_T91_91';

const cleanup = async () => {
  await prisma.package_lesson_mapping.deleteMany({ where: { code } });
  const calendars = await prisma.calendar.findMany({
    where: { code },
    select: { key: true },
  });
  const keys = calendars.map((calendar) => calendar.key).filter(Boolean);
  if (keys.length) {
    await prisma.hocmai_sync_queue.deleteMany({
      where: { c_key: { in: keys } },
    });
  }
  await prisma.calendar.deleteMany({ where: { code } });
};

const run = async () => {
  process.env.HMO_COURSE_OUTLINE_URL =
    'https://hmo.test/api/course/outline';
  process.env.HMO_COURSE_OUTLINE_TOKEN = 'test-token';
  global.fetch = async (input) => {
    const url = new URL(String(input));
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        package: { id: url.searchParams.get('package') },
        course: {
          id: url.searchParams.get('course'),
          fullname: 'Integration course',
          sections: [{
            id: '999701',
            name: 'Integration section',
            lessons: [{ id: lessonId, name: 'Integration lesson' }],
          }],
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await cleanup();
  try {
    await prisma.package_lesson_mapping.create({
      data: {
        package_id: packageId,
        course_id: 'old-course',
        lesson_id: lessonId,
        code,
        learn_number: 91,
        key: expectedKey,
      },
    });

    const { importCalendarFromSheet } = require(
      '../dist/modules/livestream/calendar-import.service'
    );
    const result = await importCalendarFromSheet([{
      row: 2,
      packageIds: [packageId],
      courseIds: [courseId],
      lessonIds: [lessonId],
      calendar: {
        system_type: 'topclass',
        code,
        learn_number: 91,
        subject: 'Integration test',
        lesson_name: 'Calendar import integration test',
        start_time: '2031-08-01T19:00:00+07:00',
        end_time: '2031-08-01T21:00:00+07:00',
        lesson_status: 0,
      },
    }]);

    assert.equal(result.status, 'success');
    assert.equal(result.count, 1);
    assert.equal(result.summary.hmoRequests, 1);

    const calendar = await prisma.calendar.findFirst({ where: { code } });
    assert.ok(calendar?.key);
    const mapping = await prisma.package_lesson_mapping.findFirst({
      where: {
        key: calendar.key,
        package_id: packageId,
        course_id: courseId,
        lesson_id: lessonId,
      },
    });
    assert.ok(mapping);
    assert.equal(mapping.course_id, courseId);
    assert.equal(mapping.key, expectedKey);
    console.log('Calendar import DB transaction: ok');
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
};

run().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
