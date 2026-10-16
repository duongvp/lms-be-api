import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveCalendarSource, assertCalendarSourceUnchanged, assertLivestreamCalendarSource, calendarSourceFromCode } from '../src/modules/livestream/calendar-source';
import { enqueueCalendarSync, enqueueCalendarsSyncBulk, enqueueRescheduleSync, reconcileCalendarMappingsAndEnqueue, withManualHocmaiQueue } from '../src/modules/livestream/hocmai-sync-queue.service';
import { validateBulkFinalStateConflicts, createSingle, createBulk, createValidatedInternalCalendarImport, createValidatedCalendarImport } from '../src/modules/livestream/livestream.service';

const calendar = (id: number, source?: string) => ({id, key:`key-${id}`, code:source==='feed'?'feed-QA':'QA', learn_number:id, calendar_source:source, lesson_status:0, lesson_document:'["doc"]'});
const mapping = (id: number) => ({id, key:`key-${id}`, code:'QA', learn_number:id, package_id:'1', course_id:'2', lesson_id:'3'});
const fakeTx = (calendars: any[]) => {
  const writes: any[]=[];
  const tx:any = {
    $queryRaw: async (sql:any,...values:any[]) => {
      const text=sql.strings?.join('') || String(sql);
      if(text.includes('FROM package_lesson_mapping'))return [mapping(1)];
      if(text.includes('WHERE id IN'))return calendars;
      return calendars.filter(c=>c.id===values[0]);
    },
    $executeRaw: async (...args:any[]) => {writes.push(args);return 1;},
    $executeRawUnsafe: async (sql:string) => {writes.push(sql);return 1;},
    package_lesson_mapping:{findMany:async()=>calendars.map(c=>mapping(c.id)),update:async()=>{writes.push('mapping-update')},deleteMany:async()=>{},create:async()=>{}},
    hocmai_sync_queue:{createMany:async ({data}:any)=>{writes.push(data)}},
  };
  return {tx,writes};
};

test('only omitted source defaults; invalid values have status 400',()=>{
 assert.equal(resolveCalendarSource(),'livestream');
 for(const value of ['livestream','feed'])assert.equal(resolveCalendarSource(value),value);
 for(const value of [null,'','Feed',' livestream',0,{},[],false])assert.throws(()=>resolveCalendarSource(value),(e:any)=>e.statusCode===400);
});

test('Livestream-only workflows reject Feed metadata instead of dropping it',()=>{
 assert.doesNotThrow(()=>assertLivestreamCalendarSource(undefined));
 assert.doesNotThrow(()=>assertLivestreamCalendarSource('livestream'));
 assert.doesNotThrow(()=>assertLivestreamCalendarSource('feed'));
 assert.throws(()=>assertLivestreamCalendarSource('bad'),(e:any)=>e.statusCode===400);
});

test('updates preserve source and reject conversions',()=>{
 for(const source of ['livestream','feed']){
  assert.doesNotThrow(()=>assertCalendarSourceUnchanged({code:source==='feed'?'feed-QA':'QA'},{}));
  assert.doesNotThrow(()=>assertCalendarSourceUnchanged({code:source==='feed'?'feed-QA':'QA'},{calendar_source:source}));
  assert.throws(()=>assertCalendarSourceUnchanged({code:source==='feed'?'feed-QA':'QA'},{calendar_source:source==='feed'?'livestream':'feed'}),(e:any)=>e.statusCode===400);
  assert.throws(()=>assertCalendarSourceUnchanged({code:source==='feed'?'feed-QA':'QA'},{calendar_source:null}),(e:any)=>e.statusCode===400);
 }
});

test('invalid create/bulk/import source fails before database or mapping access',async()=>{
 await assert.rejects(createSingle({calendar_source:'bad'}),/calendar_source/);
 await assert.rejects(createBulk({calendars:[{calendar_source:'feed'},{calendar_source:'bad'}]}),/calendar_source/);
 await assert.rejects(createBulk({calendar_source:'feed',calendars:[]}),/từng phần tử calendars/);
 const rows:any=[{calendar:{calendar_source:null}}];
 await assert.rejects(createValidatedInternalCalendarImport(rows),/calendar_source/);
 await assert.rejects(createValidatedCalendarImport(rows),/calendar_source/);
});

for(const action of ['create','update'] as const)test(`${action} queue reads stored source rather than caller source`,async()=>{
 const feed=fakeTx([calendar(1,'feed')]);
 assert.equal(await enqueueCalendarSync(feed.tx,'op',1,action,{id:1,calendar_source:'livestream'}),false);
 assert.deepEqual(feed.writes,[]);
 for(const source of [undefined,'livestream']){
  const live=fakeTx([calendar(1,source)]);
  assert.equal(await enqueueCalendarSync(live.tx,'op',2,action,{id:1,calendar_source:'feed'}),true);
  const payload=JSON.parse(live.writes[0][3]);
  assert.equal(payload.action,action);assert.equal(payload.c_key,'key-1');assert.deepEqual(payload.documents,['doc']);assert.equal(live.writes[0][4],'op');assert.equal(live.writes[0][5],2);
 }
});

test('Feed without key is skipped before the Livestream key requirement',async()=>{
 const row={...calendar(1,'feed'),key:null};const {tx,writes}=fakeTx([row]);
 assert.equal(await enqueueCalendarSync(tx,'op',1,'create',{id:1}),false);assert.deepEqual(writes,[]);
});

test('status and reschedule queues skip Feed; Livestream ordering is preserved',async()=>{
 for(const action of ['cancel','makeup','following'] as const){
  const result=action==='cancel'?{id:1}:{canceled_session:{id:1},created_session:{id:2},shifted_sessions:[{id:3}]};
  const feed=fakeTx([calendar(1,'feed'),calendar(2,'feed'),calendar(3,'feed')]);
  await enqueueRescheduleSync(feed.tx,action,result,'operation');assert.deepEqual(feed.writes,[]);
  const live=fakeTx([calendar(1,'livestream'),calendar(2,'livestream'),calendar(3,'livestream')]);
  await enqueueRescheduleSync(live.tx,action,result,'operation');
  assert.ok(live.writes.length);assert.ok(live.writes.every(w=>w[4]==='operation'));
  assert.deepEqual(live.writes.map(w=>w[5]),live.writes.map((_,i)=>i+1));
 }
});

test('bulk resend skips Feed and reports missing calendars',async()=>{
 const {tx,writes}=fakeTx([calendar(1,'livestream'),calendar(2,'feed'),calendar(3)]);
 const result=await enqueueCalendarsSyncBulk(tx,[1,2,3,4,1],'op');
 assert.deepEqual(result.queuedIds,[1,3]);assert.deepEqual(result.skippedIds,[2]);assert.deepEqual(result.missingIds,[4]);
 assert.deepEqual(writes[0].map((r:any)=>[r.c_key,r.sequence_no]),[['key-1',1],['key-3',2]]);
});

test('Feed mapping reconciliation still changes mapping without enqueue',async()=>{
 const row=calendar(1,'feed');const {tx,writes}=fakeTx([row]);
 const result=await reconcileCalendarMappingsAndEnqueue(tx,row,[{package_id:'1',course_id:'2',lesson_id:'changed'}]);
 assert.equal(result.changed,true);assert.deepEqual(writes,['mapping-update']);
});

test('manual queue flag is cleared even if business operation fails',async()=>{
 const {tx,writes}=fakeTx([]);
 await assert.rejects(withManualHocmaiQueue(tx,async()=>{throw Error('failure')}),/failure/);
 assert.deepEqual(writes,['SET @lms_manual_hocmai_queue = 1','SET @lms_manual_hocmai_queue = 0']);
});

test('three trigger bodies are unchanged except the source condition; migration matches canonical SQL',()=>{
 const canonical=readFileSync('prisma/sql/calendar_triggers.sql','utf8');
 const old=readFileSync('prisma/sql/rollback_calendar_source_triggers.sql','utf8').slice(readFileSync('prisma/sql/rollback_calendar_source_triggers.sql','utf8').indexOf('DROP TRIGGER'));
 assert.equal(canonical.replaceAll("\n       AND NEW.code NOT LIKE 'feed-%'",''),old);
 assert.equal(canonical.match(/AND NEW.code NOT LIKE 'feed-%'/g)?.length,3);
 const migration=readFileSync('prisma/migrations/20261014180000_calendar_source_from_program_code/migration.sql','utf8');
 assert.ok(migration.includes(canonical.replace('DELIMITER $$','').replaceAll('END$$','END;').replace('DELIMITER ;','')));
});


test('bulk final-state conflicts are isolated by source for teacher, assistant and program', () => {
 const base = {teacher:'same-teacher',assistant_teacher:'same-assistant',code:'same-program',start_time:new Date('2031-01-01T08:00:00Z'),end_time:new Date('2031-01-01T09:00:00Z')};
 assert.doesNotThrow(()=>validateBulkFinalStateConflicts([{...base,id:1,calendar_source:'livestream'},{...base,id:2,code:'feed-same-program'}]));
 for (const source of ['livestream','feed']) assert.throws(()=>validateBulkFinalStateConflicts([{...base,id:1,calendar_source:source},{...base,id:2,calendar_source:source}]),/Trùng|trùng/);
 assert.throws(()=>validateBulkFinalStateConflicts([{...base,id:1},{...base,id:2,calendar_source:'livestream'}]),/Trùng|trùng/);
});


test('source follows only the program-code prefix, with case-insensitive legacy codes', () => {
 for(const code of ['feed-nguvan-8-2027','FEED-tongontoantsav2027']) assert.equal(calendarSourceFromCode(code),'feed');
 for(const code of ['nguvan-8-2027','my-feed-program','feedx-program',undefined]) assert.equal(calendarSourceFromCode(code),'livestream');
});
