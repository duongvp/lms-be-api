// Real service/controller calls against a disposable MySQL schema only.
// Requires the current Prisma schema; no production URL or network requests.
import assert from 'node:assert/strict';

const url = new URL(process.env.DATABASE_URL || 'invalid://missing');
assert.equal(url.pathname, '/shared_staff_test');
assert.match(url.searchParams.get('socket') || '', /^\/tmp\/lms-shared-staff-db-[^/]+\/mysql\.sock$/);
process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
global.fetch = async () => { throw new Error('External requests forbidden in integration tests'); };

(async () => {
  const { default: db } = await import('../src/lib/prisma');
  const service = await import('../src/modules/livestream/livestream.service');
  const controller = await import('../src/modules/livestream/livestream.controller');
  const actor = { userId: 1, username: 'qa-admin' };
  const checks: string[] = [];
  const title = 'Phương trình bậc hai';
  const payload = (code: string, extra: any = {}) => ({
    code, learn_number: 1, system_type: 'topclass', lesson_name: title,
    teacher: 'qa-teacher', assistant_teacher: 'qa-assistant-a,qa-assistant-b',
    start_time: '2031-11-02T08:00:00Z', end_time: '2031-11-02T10:00:00Z', ...extra,
  });
  const reset = async () => {
    await db.calendar_change_logs.deleteMany();
    await db.calendar.deleteMany();
  };
  const run = async (name: string, fn: () => Promise<void>) => {
    await reset();
    await fn();
    checks.push(name);
    process.stdout.write(`PASS ${name}\n`);
  };
  try {
    for (const [username, display_name, can_view_stream_key] of [
      ['qa-teacher', 'QA Teacher', 1], ['qa-teacher-other', 'Other Teacher', 1],
      ['qa-assistant-a', 'QA Assistant A', 0], ['qa-assistant-b', 'QA Assistant B', 0],
    ] as const) {
      await db.teacher_profiles.upsert({ where: { username }, update: {},
        create: { username, display_name, can_view_stream_key, teacher_type: can_view_stream_key } });
    }
    await run('single: default blocks shared teacher/assistants; explicit true permits 3 programs', async () => {
      await service.createSingle(payload('QA-A'));
      await assert.rejects(service.createSingle(payload('QA-B')), /trùng/);
      assert.equal(await db.calendar.count(), 1);
      for (const code of ['QA-B', 'QA-C']) {
        const row = await service.createSingle(payload(code, { allow_shared_staff_schedule: true }));
        assert.equal(row.teacher, 'QA Teacher');
        assert.equal(row.assistant_teacher, 'qa-assistant-a,qa-assistant-b');
        assert.ok(!('allow_shared_staff_schedule' in row));
      }
      assert.equal(await db.calendar.count(), 3);
    });
    for (const [name, extra] of Object.entries({
      'different lesson': { lesson_name: 'Bài khác' },
      'different start': { start_time: '2031-11-02T09:00:00Z' },
      'different end': { end_time: '2031-11-02T11:00:00Z' },
      'same program': { code: 'QA-A' },
      'string true': { allow_shared_staff_schedule: 'true' },
    })) {
      await run(`single: opt-in still rejects ${name}`, async () => {
        await service.createSingle(payload('QA-A'));
        await assert.rejects(service.createSingle(payload('QA-B', { allow_shared_staff_schedule: true, ...extra })), /trùng/);
        assert.equal(await db.calendar.count(), 1);
      });
    }
    await run('single: assistant overlap independently rejects another lesson with another teacher', async () => {
      await service.createSingle(payload('QA-A'));
      await assert.rejects(service.createSingle(payload('QA-B', {
        allow_shared_staff_schedule: true, teacher: 'qa-teacher-other', lesson_name: 'Bài khác',
      })), /Trợ giảng/);
      assert.equal(await db.calendar.count(), 1);
    });
    await run('single: canceled schedule and adjacent sessions do not create conflicts', async () => {
      await service.createSingle(payload('QA-A', { lesson_status: 1 }));
      await service.createSingle(payload('QA-B', { lesson_name: 'Bài khác' }));
      await service.createSingle(payload('QA-C', { start_time: '2031-11-02T10:00:00Z', end_time: '2031-11-02T12:00:00Z' }));
      assert.equal(await db.calendar.count(), 3);
    });
    await run('bulk creation: validates previously inserted rows in same transaction; rollback entire batch by default', async () => {
      await assert.rejects(service.createBulk({ calendars: [payload('QA-A'), payload('QA-B')] }), /trùng/);
      assert.equal(await db.calendar.count(), 0);
      const result = await service.createBulk({ allow_shared_staff_schedule: true,
        calendars: [payload('QA-A'), payload('QA-B'), payload('QA-C')] });
      assert.equal(result.count, 3);
    });
    await run('bulk creation: valid shared row followed by invalid row rolls back whole batch', async () => {
      await service.createSingle(payload('QA-A'));
      await assert.rejects(service.createBulk({ allow_shared_staff_schedule: true, calendars: [
        payload('QA-B'), payload('QA-C', { lesson_name: 'Bài khác' }),
      ] }), /trùng/);
      assert.equal(await db.calendar.count(), 1);
    });
    await run('lesson hydration: compare names after resolving the actual program lesson', async () => {
      const lessons = [];
      for (const code of ['QA-A', 'QA-B']) {
        const old = await db.lessons.findFirst({ where: { subject_code: code, learn_number: 1 } });
        lessons.push(old || await db.lessons.create({ data: {
          subject_code: code, subject_name: 'QA', learn_number: 1, lesson_name: title,
        } }));
      }
      await service.createSingle(payload('QA-A', { session_id: String(lessons[0].id), lesson_name: undefined }));
      const row = await service.createSingle(payload('QA-B', { session_id: String(lessons[1].id), lesson_name: undefined, allow_shared_staff_schedule: true }));
      assert.equal(row.lesson_name, title);
      assert.equal(row.session_id, lessons[1].id);
    });
    const autoRequest = (code: string, allow?: boolean) => ({
      program_code: code, system_type: 'topclass', start_date: '2031-11-02',
      allow_shared_staff_schedule: allow,
      blocks: [{ lessons: [{ learn_number: 1, lesson_name: title, sessions: [{
        weekday: new Date('2031-11-02T00:00:00Z').getUTCDay() || 7,
        start_time: '08:00', end_time: '10:00', teacher: 'qa-teacher', assistant_teacher: 'qa-assistant-a,qa-assistant-b',
      }] }] }],
    });
    const commitAuto = async (body: any) => {
      let response: any;
      let error: any;
      const res = { status: () => res, json: (value: any) => { response = value; } };
      await controller.commitAutoSchedule({ body, user: { userId: 1, username: 'qa-admin' } } as any,
        res as any, ((value: any) => { error = value; }) as any);
      if (error) throw error;
      if (response?.success === false) throw Object.assign(new Error(response.message), { conflicts: response.conflicts });
      return response;
    };
    await run('auto create: actual controller forwards flag into transactional bulk create', async () => {
      await service.createSingle(payload('QA-A'));
      await assert.rejects(commitAuto(autoRequest('QA-B')), /trùng/);
      assert.equal(await db.calendar.count(), 1);
      assert.equal((await commitAuto(autoRequest('QA-B', true))).success, true);
      assert.equal(await db.calendar.count(), 2);
    });
    for (const mode of ['common', 'separate']) {
      await run(`bulk update ${mode}: default rejects; opt-in saves latest times; failed update rolls back`, async () => {
        const a = await service.createSingle(payload('QA-A'));
        const b = await service.createSingle(payload('QA-B', { start_time: '2031-11-02T12:00:00Z', end_time: '2031-11-02T14:00:00Z' }));
        const config = { ids: [b.id], config_mode: mode, reason: 'QA overlap',
          update_data: mode === 'common' ? { start_time: '08:00', end_time: '10:00' }
            : [{ id: b.id, start_time: '08:00', end_time: '10:00' }] };
        await assert.rejects(service.updateBulk(config, actor), /trùng/);
        assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: b.id } })).start_time.getUTCHours(), 12);
        await service.updateBulk({ ...config, allow_shared_staff_schedule: true }, actor);
        assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: b.id } })).start_time.getTime(), a.start_time.getTime());
      });
    }
    process.stdout.write(`RESULT ${checks.length} real-MySQL integration scenarios passed\n`);
  } finally {
    await db.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
