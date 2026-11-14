import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { createSingle, createBulk, createValidatedCalendarImport, createValidatedInternalCalendarImport } from '../src/modules/livestream/livestream.service';

const actor = { userId: 1, username: 'recreate-test' };
const mapping = { package_id: '10', course_id: '20', lesson_id: '30' };
const input = {
  code: 'RECREATE', learn_number: 7, system_type: 'topclass', lesson_count: 0,
  subject: 'New subject', lesson_name: 'New title', lesson_document: '["new.pdf"]',
  start_time: new Date('2031-11-09T10:00:00Z'), end_time: new Date('2031-11-09T11:00:00Z'),
  skip_teacher_profile_validation: true,
};
const originalKey = 'tc_3132_RECREATE_7';

// Execute the real single/bulk/import handlers; replace only their database boundary.
function fixture() {
  let rows: any[] = [{ id: 41, key: originalKey, code: input.code, learn_number: 7, system_type: 'topclass',
    deleted_at: new Date('2030-01-01'), created_at: new Date('2029-01-01'), session_id: 99n,
    start_time: new Date('2031-11-07T10:00:00Z'), end_time: new Date('2031-11-07T11:00:00Z'),
    lesson_name: 'Old title', teacher: 'Old teacher', lesson_noti: 'Old notice', lesson_status: 1,
    lesson_link: 'old-stream', lesson_baitap: 'old.pdf', student_synced_at: new Date(), lesson_count: 0 }];
  let mappings: any[] = [{ id: 1, key: originalKey, package_id: '1', course_id: '2', lesson_id: '3' }];
  let logs: any[] = [], queue: any[] = [], inserts = 0;
  const statement = (sql: any) => sql.strings?.join('') ?? String(sql);
  const active = () => rows.filter(row => row.deleted_at == null);
  const tx: any = {
    $executeRawUnsafe: async (sql: string, ...values: any[]) => {
      if (sql.startsWith('SET ')) return 0;
      assert.match(sql, /INSERT INTO calendar/);
      inserts++;
      const columns = ['session_id','code','learn_number','subject','start_time','end_time','teacher',
        'assistant_teacher','lesson_name','lesson_document','evg_banner','evg_stream','lesson_count','lesson_status','key','system_type'];
      for (let i = 0; i < values.length; i += columns.length) {
        rows.push({ id: 42 + rows.length, deleted_at: null, ...Object.fromEntries(columns.map((key, j) => [key, values[i+j]])) });
      }
      return 1;
    },
    $executeRaw: async (sql: any, ...values: any[]) => {
      const text = statement(sql);
      if (text.includes('INSERT INTO package_lesson_mapping')) {
        const [package_id, course_id, lesson_id, code, learn_number, key] = values;
        mappings.push({ id: mappings.length + 1, package_id, course_id, lesson_id, code, learn_number, key });
      } else if (text.includes('INSERT INTO hocmai_sync_queue')) {
        queue.push({ key: values[0], action: values[1], payload: JSON.parse(values[2]) });
      } else assert.match(text, /UPDATE hocmai_sync_queue/);
      return 1;
    },
    $queryRaw: async (sql: any, ...values: any[]) => {
      const text = statement(sql);
      if (text.includes('deleted_at IS NOT NULL FOR UPDATE')) {
        return rows.filter(row => row.key === values[0] && row.deleted_at != null).map(row => ({ ...row }));
      }
      if (text.includes('FROM package_lesson_mapping')) return mappings.map(row => ({ ...row }));
      if (text.includes('DATE_FORMAT')) {
        return active().filter(row => row.id === values[0]).map(row => ({ ...row,
          start_time: row.start_time.toISOString().slice(0,19).replace('T',' '),
          end_time: row.end_time.toISOString().slice(0,19).replace('T',' '),
        }));
      }
      return [];
    },
    calendar: {
      findFirst: async ({ where }: any) => active().find(row => where.key ? row.key === where.key
        : row.code === where.code && row.learn_number === where.learn_number && row.lesson_count === where.lesson_count) ?? null,
      findMany: async ({ where }: any) => where.key?.in ? active().filter(row => where.key.in.includes(row.key)).map(row => ({ ...row })) : [],
      create: async ({ data }: any) => { inserts++; const row = { id: 42, deleted_at: null, ...data }; rows.push(row); return row; },
      update: async ({ where, data }: any) => {
        const index = rows.findIndex(row => row.id === where.id && row.key === where.key && row.deleted_at != null);
        assert.notEqual(index, -1, 'Restore must explicitly target the locked deleted row');
        rows[index] = { ...rows[index], ...data };
        return { ...rows[index] };
      },
    },
    package_lesson_mapping: {
      findMany: async () => mappings.map(row => ({ ...row })),
      deleteMany: async () => { mappings = []; return { count: 1 }; },
      create: async ({ data }: any) => { mappings.push({ id: 1, ...data }); return data; },
    },
    calendar_change_logs: { create: async ({ data }: any) => { logs.push(data); return data; } },
    hocmai_sync_queue: { findFirst: async () => null },
  };
  return {
    tx, row: () => rows[0], rows: () => rows, mappings: () => mappings, logs: () => logs, queue: () => queue, inserts: () => inserts,
    transaction: async (operation: any) => {
      const before = structuredClone({ rows, mappings, logs, queue, inserts });
      try { return await operation(tx); }
      catch (error) { ({ rows, mappings, logs, queue, inserts } = before); throw error; }
    },
  };
}

for (const kind of ['single', 'bulk', 'import', 'internal-import'] as const) {
  test(`${kind}: recreate retains id/key, replaces data and mapping, and writes a restore audit/queue`, async () => {
    const originalTransaction = prisma.$transaction;
    const enabled = process.env.TEAMS_NOTIFICATIONS_ENABLED;
    process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
    const f = fixture();
    prisma.$transaction = f.transaction as any;
    const create = async (who: any = actor) => {
      if (kind === 'single') return createSingle({ ...input, package_lesson_mappings: [mapping] }, who);
      if (kind === 'bulk') return createBulk({ calendars: [{ ...input, package_lesson_mappings: [mapping] }] }, who);
      if (kind === 'import') return createValidatedCalendarImport([{ row: 1, calendar: input, mappings: [mapping] }] as any, who);
      return createValidatedInternalCalendarImport([{ row: 1, calendar: input, mappings: [mapping] }] as any, who);
    };
    try {
      await assert.rejects(create({}), /người thay đổi/);
      assert.equal(f.row().deleted_at?.getFullYear(), 2030);
      assert.equal(f.row().lesson_name, 'Old title');
      assert.equal(f.mappings()[0].lesson_id, '3');
      assert.equal(f.logs().length, 0); assert.equal(f.queue().length, 0);
      await create();
      assert.equal(f.rows().length, 1); assert.equal(f.inserts(), 0);
      assert.equal(f.row().id, 41); assert.equal(f.row().key, originalKey); assert.equal(f.row().deleted_at, null);
      assert.equal(f.row().created_at.getFullYear(), 2029);
      assert.equal(f.row().lesson_name, 'New title'); assert.equal(f.row().lesson_document, '["new.pdf"]');
      assert.equal(f.row().session_id, null); assert.equal(f.row().lesson_link, null); assert.equal(f.row().lesson_baitap, null);
      assert.equal(f.row().lesson_noti, null); assert.equal(f.row().student_synced_at, null); assert.equal(f.row().lesson_status, 0);
      assert.equal(f.mappings().length, 1); assert.equal(f.mappings()[0].lesson_id, '30');
      assert.equal(f.logs()[0].calendar_id, 41); assert.equal(f.logs()[0].action, 'restore');
      assert.equal(f.logs()[0].before_data.source_session.lesson_name, 'Old title');
      assert.equal(f.logs()[0].after_data.source_session.lesson_name, 'New title');
      assert.equal(f.logs()[0].after_data.mappings[0].lesson_id, '30');
      assert.equal(f.queue().length, 1); assert.equal(f.queue()[0].action, 'restore');
      assert.equal(f.queue()[0].payload.title, 'New title');
      assert.deepEqual(f.queue()[0].payload.packages, [{ package_id: '10', lesson_id: '30' }]);
      // A second delete/recreate cycle still uses the same row and retains the first audit.
      f.row().deleted_at = new Date();
      await create();
      assert.equal(f.rows().length, 1); assert.equal(f.row().id, 41); assert.equal(f.logs().length, 2);
    } finally {
      prisma.$transaction = originalTransaction;
      if (enabled === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED; else process.env.TEAMS_NOTIFICATIONS_ENABLED = enabled;
    }
  });
}

test('internal import keeps bulk insert for fresh schedules in a mixed batch', async () => {
  const originalTransaction = prisma.$transaction;
  const enabled = process.env.TEAMS_NOTIFICATIONS_ENABLED;
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
  const f = fixture(); prisma.$transaction = f.transaction as any;
  try {
    await createValidatedInternalCalendarImport([
      { row: 1, calendar: input, mappings: [] },
      { row: 2, calendar: { ...input, learn_number: 8 }, mappings: [] },
    ] as any, actor);
    assert.equal(f.rows().length, 2); assert.equal(f.inserts(), 1);
    assert.equal(f.row().id, 41); assert.equal(f.row().key, originalKey); assert.equal(f.row().deleted_at, null);
    assert.equal(f.logs().length, 1);
    assert.equal(f.rows()[1].learn_number, 8);
  } finally {
    prisma.$transaction = originalTransaction;
    if (enabled === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED; else process.env.TEAMS_NOTIFICATIONS_ENABLED = enabled;
  }
});
