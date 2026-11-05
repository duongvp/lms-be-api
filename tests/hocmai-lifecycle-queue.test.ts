import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueCalendarSync, enqueueCalendarsSyncBulk, enqueueRescheduleSync,
  hasValidHocmaiLessonMapping,
} from '../src/modules/livestream/hocmai-sync-queue.service';

const calendar = {
  id: 1, key: 'mapped-key', code: 'nguvan-6-2027', subject: 'Ngữ văn 6',
  start_time: '2031-11-02 18:00:00', end_time: '2031-11-02 19:30:00',
  learn_number: 7, lesson_name: 'Bài học khôi phục', lesson_document: '["doc.pdf"',
};
const valid = { key: calendar.key, package_id: '10', lesson_id: '20' };
const fakeTx = (mappings: any[], documents = calendar.lesson_document, overrides: Record<string, unknown> = {}) => {
  const writes: any[] = [];
  const tx: any = {
    $queryRaw: async (sql: any) => {
      const text = sql.strings?.join('') || String(sql);
      return text.includes('FROM package_lesson_mapping') ? mappings : [{ ...calendar, lesson_document: documents, ...overrides }];
    },
    $executeRaw: async (_sql: any, ...values: any[]) => { writes.push(JSON.parse(values[2])); return 1; },
    package_lesson_mapping: { findMany: async () => mappings },
    hocmai_sync_queue: {
      findFirst: async () => null,
      createMany: async ({ data }: any) => { writes.push(...data.map((row: any) => JSON.parse(row.payload))); },
    },
  };
  return { tx, writes };
};

test('mapping requires an assigned lesson ID, including legacy null/blank rows', () => {
  for (const lesson_id of [null, undefined, '', '   ']) {
    assert.equal(hasValidHocmaiLessonMapping({ lesson_id }), false);
  }
  assert.equal(hasValidHocmaiLessonMapping(valid), true);
});

for (const action of ['create', 'update', 'restore'] as const) {
  test(`${action} skips absent/invalid mappings and filters mixed mappings`, async () => {
    for (const mappings of [[], [{ ...valid, lesson_id: null }], [{ ...valid, lesson_id: '' }]]) {
      const { tx, writes } = fakeTx(mappings);
      assert.equal(await enqueueCalendarSync(tx, 'operation', 1, action, calendar), false);
      assert.deepEqual(writes, []);
    }
    const { tx, writes } = fakeTx([valid, { ...valid, lesson_id: '' }, { ...valid, lesson_id: null }]);
    assert.equal(await enqueueCalendarSync(tx, 'operation', 1, action, calendar), true);
    assert.deepEqual(writes[0].packages, [{ package_id: '10', lesson_id: '20' }]);
    assert.equal(writes[0].action, action);
    for (const field of ['code', 'start_time', 'end_time', 'learn_number'] as const) {
      assert.equal(writes[0][field], calendar[field]);
    }
    assert.deepEqual(writes[0].documents, ['doc.pdf']);
  });
}

test('restore documents repair the missing closing bracket and reject invalid JSON', async () => {
  for (const [documents, expected] of [
    [' ["doc.pdf"  ', ['doc.pdf']], ['["doc.pdf"]', ['doc.pdf']],
    ['not-json', []], ['', []], ['[]', []],
  ] as const) {
    const { tx, writes } = fakeTx([valid], documents);
    await enqueueCalendarSync(tx, 'operation', 1, 'restore', calendar);
    assert.deepEqual(writes[0].documents, expected);
  }
});

test('status and bulk enqueue also skip invalid lesson mappings', async () => {
  const invalid = { ...valid, lesson_id: '' };
  const status = fakeTx([invalid]);
  await enqueueRescheduleSync(status.tx, 'cancel', calendar, 'operation');
  assert.deepEqual(status.writes, []);
  const bulk = fakeTx([invalid]);
  const result = await enqueueCalendarsSyncBulk(bulk.tx, [1]);
  assert.deepEqual(result.queuedIds, []);
  assert.deepEqual(result.skippedIds, [1]);
  assert.deepEqual(bulk.writes, []);
});


test('create, update and restore use identical defaults for nullable source fields', async () => {
  const nullFields = {
    subject: null, start_time: null, end_time: null, teacher: null,
    lesson_name: null, learn_number: null, lesson_status: null,
    lesson_document: null, lesson_noti: null,
  };
  const expected = {
    c_key: calendar.key, code: calendar.code, subject: '', start_time: '', end_time: '',
    teacher_name: '', title: '', learn_number: 0, lesson_status: 0, documents: [],
    lesson_noti: '', packages: [{ package_id: '10', lesson_id: '20' }],
  };
  for (const action of ['create', 'update', 'restore'] as const) {
    const { tx, writes } = fakeTx([valid], calendar.lesson_document, nullFields);
    await enqueueCalendarSync(tx, 'operation', 1, action, calendar);
    assert.deepEqual(writes, [{ ...expected, action }]);
  }
});
