import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import {getCalendar} from '../src/modules/livestream/livestream.service';
import {getCalendar as getCalendarController} from '../src/modules/livestream/livestream.controller';

const withEmptyList = async (run: (calls: any[]) => Promise<void>) => {
    const originals = {count: prisma.calendar.count, findMany: prisma.calendar.findMany, query: prisma.$queryRaw};
    const calls: any[] = [];
    (prisma.calendar.count as any) = async (args: any) => {calls.push({kind: 'count', ...args}); return 0;};
    (prisma.calendar.findMany as any) = async (args: any) => {calls.push({kind: 'find', ...args}); return [];};
    (prisma.$queryRaw as any) = async (sql: any) => {calls.push({kind: 'sql', text: sql.strings.join('')}); return [];};
    try {await run(calls);} finally {
        prisma.calendar.count = originals.count;
        prisma.calendar.findMany = originals.findMany;
        prisma.$queryRaw = originals.query;
    }
};

test('list defaults to Livestream for both count and page data, and supports explicit Feed', async () => {
    await withEmptyList(async calls => {
        await getCalendar({code: 'QA', keyword: 'lesson'});
        assert.ok(calls.filter(c => c.where).every(c => c.where.AND.some((condition:any)=>condition.code?.not?.startsWith === 'feed-')));
        assert.ok(calls.some(c => c.where?.OR?.length));
        calls.length = 0;
        await getCalendar({code: 'QA', calendar_source: 'feed'});
        assert.ok(calls.filter(c => c.where).every(c => c.where.AND.some((condition:any)=>condition.code?.startsWith === 'feed-')));
    });
});

test('legacy program scope uses stored code without requiring a curriculum lesson', async () => {
    await withEmptyList(async calls => {
        await getCalendar({code: 'QA'}, ['QA']);
        const sql = calls.find(c => c.kind === 'sql').text;
        assert.match(sql, /session_lesson\.subject_code IN/);
        assert.match(sql, /calendar_row\.session_id IS NULL\s+AND calendar_row\.code IN/);
        assert.doesNotMatch(sql, /EXISTS/);
        assert.ok(calls.filter(c => c.where).every(c => c.where.AND.length > 0));
    });
});

test('invalid list source is rejected before any database query', async () => {
    await withEmptyList(async calls => {
        await assert.rejects(getCalendar({code: 'QA', calendar_source: 'bad'}), /calendar_source/);
        assert.deepEqual(calls, []);
    });
});

test('calendar filters do not require a stored source column',async()=>{
 await withEmptyList(async calls=>{
  await getCalendar({calendar_source:'feed'},null,true);
  for(const call of calls) assert.equal(JSON.stringify(call).includes('calendar_source'),false);
 });
});

test('report selected IDs intersect program permissions and all calendar filters for count and rows', async () => {
    await withEmptyList(async calls => {
        await getCalendar({ calendar_ids: '4836,4837', calendar_source: 'feed', code: 'feed-QA' }, ['feed-QA'], true, true);
        for (const call of calls.filter(c => c.where)) {
            assert.ok(call.where.AND.some((condition: any) => JSON.stringify(condition.id?.in) === '[4836,4837]'));
            assert.ok(call.where.AND.some((condition: any) => JSON.stringify(condition.id?.in) === '[]'), 'Program scope must not be replaced by selected IDs');
            assert.ok(call.where.AND.some((condition: any) => condition.code?.startsWith === 'feed-'));
        }
    });
});

test('empty selected scope stays empty and invalid selected IDs fail before querying', async () => {
    await withEmptyList(async calls => {
        await getCalendar({ calendar_ids: '' }, null, true, true);
        assert.ok(calls.filter(c => c.where).every(c => c.where.AND.some((condition: any) => JSON.stringify(condition.id?.in) === '[]')));
        calls.length = 0;
        for (const calendar_ids of ['bad', '1,-2', '0', '1.5']) {
            await assert.rejects(getCalendar({ calendar_ids }, null, true, true), /calendar_ids/);
        }
        assert.equal(calls.length, 0);
    });
});
