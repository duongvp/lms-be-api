// Run only against a disposable local MySQL database. Never loads .env.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const supplied = process.env.TEST_CALENDAR_SOFT_DELETE_DATABASE_URL;
assert.ok(supplied, 'Set TEST_CALENDAR_SOFT_DELETE_DATABASE_URL to a disposable local MySQL database');
const target = new URL(supplied);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port && target.port !== '3306');
assert.match(target.pathname, /^\/calendar_soft_delete_\w*test$/);
process.env.DATABASE_URL = supplied;
process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
global.fetch = async () => { throw new Error('Integration tests must not call external APIs'); };

async function main() {
  const { default: prisma } = await import('../src/lib/prisma');
  const { deleteSession, restoreSession, createValidatedCalendarImport, createValidatedInternalCalendarImport, createSingle, createBulk, getCalendar, checkConflict } = await import('../src/modules/livestream/livestream.service');
  const { enqueueCalendarSync, enqueueCalendarsSyncBulk, withManualHocmaiQueue } = await import('../src/modules/livestream/hocmai-sync-queue.service');
  const { syncCalendarsFromLessons, deleteLessonIfUnscheduled } = await import('../src/modules/lessons/lesson.repository');
  const db = new PrismaClient({ datasources: { db: { url: supplied } } });
  const code = `SD${Date.now()}`;
  const actor = { userId: 1, username: 'soft-delete-qa' };
  const mapping = { package_id: '9056', course_id: '111', lesson_id: '700' };
  const calendarData = (learnNumber: number, extra: any = {}) => ({
    code, system_type: 'topclass' as const, learn_number: learnNumber, subject: 'Ngữ văn 8', lesson_name: `Bài gốc ${learnNumber}`,
    start_time: new Date(Date.UTC(2031, 10, learnNumber, 10)), end_time: new Date(Date.UTC(2031, 10, learnNumber, 11)),
    lesson_count: 0, key: `tc_3132_${code}_${learnNumber}`, ...extra,
  });
  const jobsFor = (key: string) => db.hocmai_sync_queue.findMany({ where: { c_key: key }, orderBy: { id: 'asc' } });
  try {
    const lesson = await db.lessons.create({ data: { subject_code: code, subject_name: 'Ngữ văn', grade: 8, learn_number: 7, lesson_name: 'Bài gốc 7' } });
    await db.lesson_course_mapping.create({ data: { lesson_id: lesson.id, package_id: mapping.package_id, course_id: mapping.course_id } });
    const original = await db.calendar.create({ data: calendarData(7, { session_id: lesson.id, lesson_document: '["doc7"]' }) });
    await db.package_lesson_mapping.create({ data: { ...mapping, code, learn_number: 7, key: original.key } });
    const waiting = await db.hocmai_sync_queue.create({ data: {
      c_key: original.key!, action: 'update-status-lesson', payload: '{}', status: 4,
    } });
    await deleteSession(original.id, actor);
    assert.equal((await db.hocmai_sync_queue.findUniqueOrThrow({ where: { id: waiting.id } })).status, 5);

    assert.equal(await prisma.calendar.findUnique({ where: { id: original.id } }), null);
    assert.equal(await prisma.calendar.count({ where: { code } }), 0);
    assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: original.id } })).key, original.key);
    assert.ok((await db.calendar.findUniqueOrThrow({ where: { id: original.id } })).deleted_at);
    assert.deepEqual(JSON.parse((await jobsFor(original.key!)).at(-1)!.payload), { c_key: original.key, action: 'delete' });
    const deleteCount = (await jobsFor(original.key!)).length;
    await deleteSession(original.id, actor);
    assert.equal((await jobsFor(original.key!)).length, deleteCount);
    await assert.rejects(prisma.calendar.update({ where: { id: original.id }, data: { lesson_name: 'must not change' } }));
    await checkConflict({ ...calendarData(7), client: prisma });
    const active = await getCalendar({ code_exact: code }, null, true, true);
    const trash = await getCalendar({ code_exact: code, deleted: 'true' }, null, true, true);
    assert.equal(active.total, 0); assert.equal(trash.total, 1);
    // Curriculum edits must not mutate a deleted snapshot or enqueue HMO updates.
    await db.lessons.update({ where: { id: lesson.id }, data: { lesson_name: 'Changed temporarily' } });
    await prisma.$transaction(tx => syncCalendarsFromLessons(tx, [lesson.id]));
    assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: original.id } })).lesson_name, 'Bài gốc 7');
    await assert.rejects(restoreSession(original.id, actor), /Đề cương đã thay đổi/);
    await db.lessons.update({ where: { id: lesson.id }, data: { lesson_name: 'Bài gốc 7' } });
    const conflict = await db.calendar.create({ data: calendarData(99, { start_time: original.start_time, end_time: original.end_time }) });
    await assert.rejects(restoreSession(original.id, actor), /trùng|Trùng/);
    assert.ok((await db.calendar.findUniqueOrThrow({ where: { id: original.id } })).deleted_at);
    await db.calendar.delete({ where: { id: conflict.id } });
    const restored = await restoreSession(original.id, actor);
    assert.equal(restored.id, original.id); assert.equal(restored.deleted_at, null);
    const restorePayload = JSON.parse((await jobsFor(original.key!)).at(-1)!.payload);
    assert.equal(restorePayload.action, 'restore'); assert.equal(restorePayload.title, 'Bài gốc 7');
    assert.deepEqual(restorePayload.packages, [{ package_id: '9056', lesson_id: '700' }]);
    const logs = await db.calendar_change_logs.findMany({ where: { calendar_id: original.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(logs.map(row => row.action), ['delete', 'restore']);
    assert.equal((logs.at(-1)!.after_data as any).restore_type, 'self');
    await assert.rejects(restoreSession(original.id, actor), /không ở trạng thái đã xóa/);
    console.log('PASS: soft delete, default filtering, idempotent delete, self restore and audit');

    await deleteSession(original.id, actor);
    const legacyWaiting = await db.hocmai_sync_queue.create({ data: {
      c_key: original.key!, action: 'update-status-lesson', payload: '{}', status: 4,
    } });
    // Same key occupied by a new lesson: full source data must replace the old mapping.
    const removed = await deleteLessonIfUnscheduled(lesson.id);
    assert.equal(removed.scheduledCount, 0);
    const newLesson = await db.lessons.create({ data: { subject_code: code, subject_name: 'Ngữ văn', grade: 8, learn_number: 7, lesson_name: 'Nội dung bài 9 cũ' } });
    const newMapping = { package_id: '9057', course_id: '222', lesson_id: '900' };
    await db.lesson_course_mapping.create({ data: { lesson_id: newLesson.id, package_id: newMapping.package_id, course_id: newMapping.course_id } });
    const profile = await db.teacher_profiles.create({ data: { username: `${code}-teacher`, display_name: `Giáo viên bài 9 ${code}`, can_view_stream_key: 1 } });
    const newCalendar = { code, session_id: newLesson.id, learn_number: 7, teacher: profile.display_name,
      start_time: '2031-11-09T15:00:00Z', end_time: '2031-11-09T16:30:00Z',
      lesson_document: '["doc9"]', skip_teacher_profile_validation: true };
    // Audit failure must roll back restoration in place, mapping replacement and gate cancellation.
    await assert.rejects(createValidatedCalendarImport([{ row: 1, calendar: newCalendar, mappings: [newMapping] }] as any), /người thay đổi/);
    assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: original.id } })).key, original.key);
    assert.equal((await db.hocmai_sync_queue.findUniqueOrThrow({ where: { id: legacyWaiting.id } })).status, 4);
    const created = await createValidatedCalendarImport([{ row: 1, calendar: newCalendar, mappings: [newMapping] }] as any, actor);
    const replacement = created.calendars[0];
    assert.equal(replacement.id, original.id);
    assert.equal(await db.calendar.count({ where: { code, learn_number: 7 } }), 1);
    assert.equal(replacement.key, original.key); assert.equal(replacement.lesson_count, 0);
    const oldSnapshot = await db.calendar.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal((await db.hocmai_sync_queue.findUniqueOrThrow({ where: { id: legacyWaiting.id } })).status, 5);
    assert.equal(oldSnapshot.key, original.key); assert.equal(oldSnapshot.deleted_at, null);
    assert.equal(oldSnapshot.created_at?.getTime(), original.created_at?.getTime());
    const payload = JSON.parse((await jobsFor(original.key!)).at(-1)!.payload);
    assert.equal(payload.action, 'restore'); assert.equal(payload.title, 'Nội dung bài 9 cũ');
    assert.equal(payload.teacher_name, `Giáo viên bài 9 ${code}`); assert.equal(payload.start_time, '2031-11-09 15:00:00');
    assert.deepEqual(payload.documents, ['doc9']);
    assert.deepEqual(payload.packages, [{ package_id: '9057', lesson_id: '900' }]);
    const liveMappings = await db.package_lesson_mapping.findMany({ where: { key: original.key } });
    assert.equal(liveMappings.length, 1); assert.equal(liveMappings[0].lesson_id, '900');
    await assert.rejects(restoreSession(original.id, actor), /không ở trạng thái đã xóa/);
    const recreateLog = await db.calendar_change_logs.findFirstOrThrow({ where: { calendar_id: original.id, action: 'restore' }, orderBy: { id: 'desc' } });
    assert.equal((recreateLog.before_data as any).source_session.lesson_name, 'Bài gốc 7');
    assert.equal((recreateLog.after_data as any).source_session.lesson_name, 'Nội dung bài 9 cũ');
    assert.equal((recreateLog.after_data as any).restore_type, 'reuse_key');
    console.log('PASS: recreation keeps id/key, replaces source payload and mapping, preserves audit and rolls back atomically');

    // After a mapped deletion, removing mappings must not lose the pending restore.
    const deferred = await db.calendar.create({ data: calendarData(8) });
    await db.package_lesson_mapping.create({ data: { ...mapping, code, learn_number: 8, key: deferred.key } });
    await deleteSession(deferred.id, actor);
    await db.package_lesson_mapping.deleteMany({ where: { key: deferred.key } });
    const delayed = await createValidatedCalendarImport([{ row: 1, calendar: { ...calendarData(8), key: undefined }, mappings: [] }] as any, actor);
    const delayedCalendar = delayed.calendars[0];
    await db.package_lesson_mapping.create({ data: { ...newMapping, code, learn_number: 8, key: deferred.key } });
    await prisma.$transaction(tx => withManualHocmaiQueue(tx, () => enqueueCalendarSync(tx, 'deferred', 1, 'update', delayedCalendar)));
    assert.equal((await jobsFor(deferred.key!)).at(-1)!.action, 'restore');
    await prisma.$transaction(tx => enqueueCalendarsSyncBulk(tx, [original.id, replacement.id]));
    assert.equal((await jobsFor(original.key!)).at(-1)!.action, 'restore');
    console.log('PASS: delayed mapping and resend retain restore; deleted calendar excluded from bulk sync');

    // All creation entry points reclaim the original key without inventing _B2.
    for (const [index, kind] of ['single', 'bulk', 'internal-import'].entries()) {
      const number = 20 + index;
      const deleted = await db.calendar.create({ data: calendarData(number) });
      await deleteSession(deleted.id, actor);
      const input = { ...calendarData(number), skip_teacher_profile_validation: true };
      if (kind === 'single') await createSingle(input, actor);
      else if (kind === 'bulk') await createBulk({ calendars: [input] }, actor);
      else await createValidatedInternalCalendarImport([{ row: 1, calendar: input, mappings: [] }] as any, actor);
      const replacement = await prisma.calendar.findFirstOrThrow({ where: { key: deleted.key } });
      assert.equal(replacement.id, deleted.id);
      assert.equal(replacement.deleted_at, null);
      assert.equal(await db.calendar.count({ where: { code, learn_number: number } }), 1);
      assert.equal(replacement.lesson_count, 0);
      const audit = await db.calendar_change_logs.findFirstOrThrow({ where: { calendar_id: replacement.id, action: 'restore' } });
      assert.equal((audit.after_data as any).restore_type, 'reuse_key');
    }
    console.log('PASS: single, bulk and internal import restore the same row without inserting another calendar');

    const customLesson = await db.lessons.create({ data: { subject_code: code, subject_name: 'Ngữ văn', grade: 8, learn_number: 30, lesson_name: 'Tên đề cương' } });
    const custom = await db.calendar.create({ data: calendarData(30, { session_id: customLesson.id, lesson_name: 'Tên lịch được tùy chỉnh' }) });
    await deleteSession(custom.id, actor);
    assert.equal((await restoreSession(custom.id, actor)).lesson_name, 'Tên lịch được tùy chỉnh');
    console.log('PASS: self restore preserves a custom calendar title independently of the curriculum title');
    // Self restore uses the original audit, even if another DB client edited the deleted row.
    const legacy = await db.calendar.create({ data: calendarData(29, { lesson_name: 'Legacy original', lesson_document: '["legacy-doc"]' }) });
    await db.package_lesson_mapping.create({ data: { ...mapping, code, learn_number: 29, key: legacy.key } });
    await deleteSession(legacy.id, actor);
    await db.calendar.update({ where: { id: legacy.id }, data: { lesson_name: 'External deleted edit', start_time: new Date('2031-12-01T10:00:00Z') } });
    await db.package_lesson_mapping.updateMany({ where: { key: legacy.key }, data: { lesson_id: 'wrong' } });
    const legacyRestored = await restoreSession(legacy.id, actor);
    assert.equal(legacyRestored.lesson_name, 'Legacy original');
    assert.equal(legacyRestored.start_time.getTime(), legacy.start_time.getTime());
    const legacyPayload = JSON.parse((await jobsFor(legacy.key!)).at(-1)!.payload);
    assert.deepEqual(legacyPayload.packages, [{ package_id: '9056', lesson_id: '700' }]);
    console.log('PASS: legacy self restore recovers original audit data and mapping');


    // Trigger transitions produce exactly one lifecycle action, including full restore mapping.
    const direct = await db.calendar.create({ data: calendarData(11) });
    await db.package_lesson_mapping.create({ data: { ...mapping, code, learn_number: 11, key: direct.key } });
    await db.calendar.update({ where: { id: direct.id }, data: { deleted_at: new Date(), lesson_name: 'Direct delete snapshot' } });
    assert.deepEqual((await jobsFor(direct.key!)).map(row => row.action), ['delete']);
    await db.calendar.update({ where: { id: direct.id }, data: { lesson_name: 'Deleted edit' } });
    assert.equal((await jobsFor(direct.key!)).length, 1);
    await db.calendar.update({ where: { id: direct.id }, data: { deleted_at: null, lesson_name: 'Direct restore' } });
    const directJobs = await jobsFor(direct.key!);
    assert.deepEqual(directJobs.map(row => row.action), ['delete', 'restore']);
    assert.deepEqual(JSON.parse(directJobs[1].payload).packages, [{ package_id: '9056', lesson_id: '700' }]);
    const feed = await db.calendar.create({ data: calendarData(12, { code: `feed-${code}`, key: `feed-${code}` }) });
    await deleteSession(feed.id, actor); await restoreSession(feed.id, actor);
    assert.equal((await jobsFor(feed.key!)).length, 0);
    console.log('PASS: triggers suppress duplicate/update jobs; Feed never queues HMO');
  } finally { await prisma.$disconnect(); await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
