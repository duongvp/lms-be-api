import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import {
  assertCanUpdateSessionMappings,
  isSessionModifiable,
  previewCalendarMappingUpdates,
} from '../src/modules/livestream/livestream.service';

const past = {
  id: 10, key: 'past-10', code: 'toan-6', learn_number: 2,
  start_time: new Date('2020-01-01T18:00:00Z'), lesson_status: 0,
};
const mappings = [{ package_id: '100', course_id: '200', lesson_id: '300' }];

test('cho phép sửa và xóa mapping ở lịch cũ, giữ khóa các thao tác đổi lịch', () => {
  for (const session of [past, { ...past, lesson_status: 1 }]) {
    assert.equal(isSessionModifiable(session), false);
    assert.doesNotThrow(() => assertCanUpdateSessionMappings(session, { id: 10, package_lesson_mappings: mappings }));
    assert.doesNotThrow(() => assertCanUpdateSessionMappings(session, { package_lesson_mappings: [] }));
    for (const field of ['start_date', 'start_time', 'end_time', 'teacher', 'assistant_teacher', 'room', 'lesson_name', 'mark_as_holiday']) {
      assert.throws(() => assertCanUpdateSessionMappings(session, {
        package_lesson_mappings: mappings, [field]: 'changed', allow_past: true,
      }), /không được đổi ngày giờ/);
    }
    assert.throws(() => assertCanUpdateSessionMappings(session, { allow_past: true }), /không được đổi ngày giờ/);
  }
  assert.doesNotThrow(() => assertCanUpdateSessionMappings({
    ...past, start_time: new Date('2099-01-01T18:00:00Z'),
  }, { teacher: 'new-teacher' }));
});

test('xem trước mapping nhận lịch quá khứ và giữ nguyên thông tin lịch', async () => {
  const originalFind = prisma.calendar.findUnique;
  const originalMappings = prisma.package_lesson_mapping.findMany;
  prisma.calendar.findUnique = (async () => ({ ...past })) as any;
  prisma.package_lesson_mapping.findMany = (async () => []) as any;
  try {
    const result = await previewCalendarMappingUpdates({ updates: [{ id: 10, package_lesson_mappings: mappings }] });
    assert.equal(result.count, 1);
    assert.equal(result.updates[0].id, past.id);
    assert.equal(result.updates[0].code, past.code);
    assert.deepEqual(result.updates[0].package_lesson_mappings, mappings);
  } finally {
    prisma.calendar.findUnique = originalFind;
    prisma.package_lesson_mapping.findMany = originalMappings;
  }
});
