import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { deleteSession } from '../src/modules/livestream/livestream.service';
import { getVietnamWallClockDate } from '../src/utils/dateTime';

test('delete stores Vietnam wall-clock deleted_at and repeated deletes preserve the timestamp', async () => {
  const originalTransaction = prisma.$transaction;
  const previousEnabled = process.env.TEAMS_NOTIFICATIONS_ENABLED;
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
  let row: any = {
    id: 1, code: 'feed-test', key: null, session_id: null, lesson_status: 0,
    start_time: new Date('2099-01-01T10:00:00Z'), deleted_at: null,
  };
  let updates = 0;
  const logs: any[] = [];
  const tx = {
    $executeRaw: async () => 0,
    $executeRawUnsafe: async () => 0,
    $queryRaw: async () => [row],
    calendar: { update: async ({ where, data }: any) => {
      assert.deepEqual(where, { id: 1, deleted_at: null });
      assert.equal('delete_at' in data, false);
      updates++;
      row = { ...row, ...data };
      return row;
    } },
    calendar_change_logs: { create: async ({ data }: any) => { logs.push(data); } },
  };
  prisma.$transaction = (async (operation: any) => operation(tx)) as any;
  try {
    const before = getVietnamWallClockDate().getTime();
    const deleted = await deleteSession(1, { userId: 1, username: 'test' });
    const after = getVietnamWallClockDate().getTime();
    assert.ok(deleted.deleted_at.getTime() >= before && deleted.deleted_at.getTime() <= after);
    assert.equal(logs[0].after_data.source_session.deleted_at, deleted.deleted_at.toISOString());
    const repeated = await deleteSession(1, { userId: 1, username: 'test' });
    assert.equal(repeated.deleted_at, deleted.deleted_at);
    assert.equal(updates, 1);
    assert.equal(logs.length, 1);
    // Converting to Vietnam time also handles the date changing at midnight.
    assert.equal(getVietnamWallClockDate(new Date('2026-11-02T18:30:00Z')).toISOString(), '2026-11-03T01:30:00.000Z');
  } finally {
    prisma.$transaction = originalTransaction;
    if (previousEnabled === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED;
    else process.env.TEAMS_NOTIFICATIONS_ENABLED = previousEnabled;
  }
});

test('delete persists the soft deletion but enqueues only with a valid lesson mapping', async () => {
  const originalTransaction = prisma.$transaction;
  const previousEnabled = process.env.TEAMS_NOTIFICATIONS_ENABLED;
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
  try {
    for (const mappings of [[], [{ lesson_id: null }], [{ lesson_id: '' }], [{ lesson_id: '  ' }], [{ lesson_id: '' }, { lesson_id: '20' }]]) {
      let row: any = {
        id: 1, key: 'mapped-key', code: 'nguvan-6-2027', learn_number: 7,
        session_id: null, lesson_status: 0, start_time: new Date('2099-01-01T10:00:00Z'), deleted_at: null,
      };
      const queued: any[] = [];
      const tx = {
        $executeRawUnsafe: async () => 0,
        $queryRaw: async () => [row],
        calendar: { update: async ({ data }: any) => (row = { ...row, ...data }) },
        calendar_change_logs: { create: async () => ({}) },
        package_lesson_mapping: { findMany: async () => mappings },
        teacher_profiles: { findMany: async () => [] },
        users: { findMany: async () => [] },
        $executeRaw: async (sql: TemplateStringsArray, ...values: any[]) => {
          const statement = sql.join('?');
          if (!/INSERT INTO hocmai_sync_queue/.test(statement)) return 0;
          queued.push({ sql: statement, values });
          return 1;
        },
      };
      prisma.$transaction = (async (operation: any) => operation(tx)) as any;
      await deleteSession(1, { userId: 1, username: 'test' });
      assert.ok(row.deleted_at, 'Missing mapping must not prevent deleting the calendar');
      assert.equal(queued.length, mappings.some(item => String(item.lesson_id ?? '').trim()) ? 1 : 0);
      if (queued.length) {
        // Omit created_at so MySQL supplies CURRENT_TIMESTAMP, as it does for restore.
        assert.match(queued[0].sql, /INSERT INTO hocmai_sync_queue \(c_key, action, payload, status, operation_id, sequence_no\)/);
        assert.doesNotMatch(queued[0].sql, /created_at/);
        assert.deepEqual(queued[0].values.slice(0, 2), [
          'mapped-key', JSON.stringify({ c_key: 'mapped-key', action: 'delete' }),
        ]);
        assert.match(queued[0].values[2], /^[0-9a-f-]{36}$/);
      }
      await deleteSession(1, { userId: 1, username: 'test' });
      assert.equal(queued.length, mappings.some(item => String(item.lesson_id ?? '').trim()) ? 1 : 0,
        'Repeated deletion must not enqueue another job');
    }
  } finally {
    prisma.$transaction = originalTransaction;
    if (previousEnabled === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED;
    else process.env.TEAMS_NOTIFICATIONS_ENABLED = previousEnabled;
  }
});
