import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateGroupUsers } from '../src/modules/learning-groups/group-allocation';
import { validateCalendarGroup, assertSameGroup, rosterScope } from '../src/modules/learning-groups/learning-group.service';
import { buildCalendarClassId, buildCalendarRoomClassId } from '../src/modules/livestream/calendar-user-sync.service';
import { checkConflict, validateBulkFinalStateConflicts } from '../src/modules/livestream/livestream.service';
import { getCalendarEvgStatuses } from '../src/modules/livestream/evg-status';

const targets=()=>[{id:11,groupId:1,capacity:2,usernames:[] as string[]},{id:22,groupId:2,capacity:2,usernames:[] as string[]}];
test('capacity partitions users once, deterministically; duplicate usernames are folded',()=>{
 assert.deepEqual(allocateGroupUsers(targets(),['C','a','b','A']),[{username:'A',calendarId:11},{username:'b',calendarId:11},{username:'C',calendarId:22}]);
});
test('existing placements and prior group are retained on rerun',()=>{
 const ts=targets();ts[0].usernames=['a'];
 assert.deepEqual(allocateGroupUsers(ts,['A','b'],new Map([['b',2]])),[{username:'b',calendarId:22}]);
 assert.deepEqual(allocateGroupUsers([ts[0]],['b'],new Map([['b',2]])),[]);
});
test('overflow rejects the batch without modifying existing allocation inputs',()=>{
 const ts=targets();assert.throws(()=>allocateGroupUsers(ts,['a','b','c','d','e']),/Không đủ chỗ/);
 assert.deepEqual(ts,targets());
});
test('legacy group validation preserves an omitted group and grouped validation is strict',async()=>{
 const old:any={code:'OLD'};
 await validateCalendarGroup({program_settings:{findUnique:async()=>null}},old);
 assert.deepEqual(old,{code:'OLD'});
 const client={program_settings:{findUnique:async()=>({teaching_model:'small_group'})},learning_groups:{findFirst:async()=>null}};
 await assert.rejects(validateCalendarGroup(client,{code:'SMALL'}),/bắt buộc/);
 await assert.rejects(validateCalendarGroup(client,{code:'SMALL',group_id:9}),/không hoạt động/);
 assert.throws(()=>assertSameGroup({group_id:1},{group_id:2}),/Không chuyển nhóm/);
});
test('legacy class IDs stay exact; grouped identities remain distinct on the same day and stable on a date change',()=>{
 const when=new Date('2030-12-01T12:00:00Z');
 const legacy=buildCalendarClassId('QA',when,1);
 assert.match(legacy,/^QA\d+11$/);
 assert.equal(buildCalendarClassId('QA',when,1,{id:11,group_id:1}),'QA_G1_C11_1');
 assert.equal(buildCalendarRoomClassId('QA',when,1,2,{id:11,group_id:1}),'QA_G1_C11_2');
 assert.notEqual(buildCalendarClassId('QA',when,1,{id:11,group_id:1}),buildCalendarClassId('QA',when,1,{id:22,group_id:2}));
 assert.equal(buildCalendarClassId('QA',new Date('2031-01-01'),1,{id:11,group_id:1}),'QA_G1_C11_1');
 assert.deepEqual(rosterScope({id:11,code:'QA',learn_number:1}),{code:'QA',learn_number:1});
 assert.deepEqual(rosterScope({id:11,group_id:1,code:'QA',learn_number:1}),{code:'QA',learn_number:1,calendar_id:11});
});
test('different groups may overlap, while the same teacher and same group remain protected',async()=>{
 const start=new Date('2030-12-01T12:00:00Z'),end=new Date('2030-12-01T13:00:00Z');
 const rows:any[]=[{id:1,group_id:1,code:'QA',teacher:'t1',start_time:start,end_time:end},{id:2,group_id:2,code:'QA',teacher:'t2',start_time:start,end_time:end}];
 assert.doesNotThrow(()=>validateBulkFinalStateConflicts(rows));
 assert.throws(()=>validateBulkFinalStateConflicts([{...rows[0]}, {...rows[1],group_id:1}]),/trùng/);
 assert.throws(()=>validateBulkFinalStateConflicts([{...rows[0]}, {...rows[1],teacher:'t1'}]),/trùng/);
 let condition:any;
 await checkConflict({code:'QA',group_id:2,start_time:start,end_time:end,client:{calendar:{findMany:async(q:any)=>{condition=q.where;return []}}}});
 assert.equal(condition.group_id,2);
});
test('group EVG readiness uses its own room config and never reads shared legacy streams',async()=>{
 const c:any={id:11,code:'QA',learn_number:1,group_id:1,start_time:new Date(),evg_stream:'evg11',lesson_link:'join-key',channel_name:'group-live',
  group_room_config:{evg:'evg',stream_key:'join-key',rooms:[{room_id:1,stream_key:'https://evg-stream.hocmai.net/live/alias/playlist.m3u8',banner_url:'https://example.test/banner.png',class_id:'QA_G1_C11_1'}]}};
 const client:any={stream:{findMany:()=>{throw Error('Must not read legacy streams')}},room_config:{findMany:()=>{throw Error('Must not read legacy room configs')}}};
 assert.equal((await getCalendarEvgStatuses(client,[c])).get(11)?.evg_provisioned,true);
 c.group_room_config.rooms[0].class_id='other';
 assert.equal((await getCalendarEvgStatuses(client,[c])).get(11)?.evg_provisioned,false);
});
