// Uses a NEW disposable database on the explicitly supplied local test server.
// No .env is loaded; production URLs and the default MySQL port are rejected.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const supplied=process.env.TEST_CALENDAR_SOURCE_DATABASE_URL;
assert.ok(supplied,'Set TEST_CALENDAR_SOURCE_DATABASE_URL to an isolated local MySQL server');
const url=new URL(supplied);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.port && url.port!=='3306','Only an isolated localhost test server on a non-default port is allowed');
assert.match(url.pathname,/^\/calendar_source_\w*test$/);
const database=`calendar_source_qa_${Date.now()}`;
const admin=new PrismaClient({datasources:{db:{url:supplied}}});
url.pathname='/'+database;
process.env.DATABASE_URL=url.toString();
process.env.TEAMS_NOTIFICATIONS_ENABLED='true';
process.env.TEAMS_WEBHOOKS_JSON='[{"name":"qa","url":"https://teams.test/never-send"}]';
global.fetch=async()=>{throw Error('Integration test must never make external requests')};
const temporary=mkdtempSync(path.join(tmpdir(),'lms-calendar-source-migrations-'));
const root=path.resolve('.');
const migrationName='20261014180000_calendar_source_from_program_code';
const checks:string[]=[];
const actor={userId:1,username:'qa-admin'};
let prisma:PrismaClient|undefined;
let servicePrisma:PrismaClient|undefined;
let created=false;
const cli=(command:string,args:string[],input?:string)=>{
 const result=spawnSync(command,args,{input,encoding:'utf8',env:{...process.env,MYSQL_PWD:decodeURIComponent(url.password)},maxBuffer:8*1024*1024});
 if(result.error)throw result.error;
 assert.equal(result.status,0,`${command} failed: ${result.stdout}\n${result.stderr}`);
 return result.stdout;
};
const mysql=(sql:string)=>cli('mysql',['--no-defaults','--protocol=TCP','-h',url.hostname,'-P',url.port,'-u',decodeURIComponent(url.username),database],sql);
const raw=(sql:string,...values:any[])=>prisma!.$executeRawUnsafe(sql,...values);
const query=(sql:string,...values:any[])=>prisma!.$queryRawUnsafe<any[]>(sql,...values);
const countQueue=async(key:string)=>(await query('SELECT COUNT(*) n FROM hocmai_sync_queue WHERE c_key=?',key))[0].n;
const mapKey=async(key:string,number=1)=>raw('INSERT INTO package_lesson_mapping (package_id,course_id,lesson_id,code,learn_number,`key`) VALUES (?,?,?,?,?,?)','11','22','33','QA',number,key);
const insertSql='INSERT INTO calendar (code,learn_number,start_time,end_time,`key`,lesson_name) VALUES (?, ?, ?, ?, ?, ?)';
const makePayload=(code:string,source?:string)=>({code,learn_number:1,system_type:'topclass',start_time:'2031-10-01T08:00:00Z',end_time:'2031-10-01T09:00:00Z',lesson_name:'QA lesson',...(source===undefined?{}:{calendar_source:source}),package_lesson_mappings:[{package_id:'11',course_id:'22',lesson_ids:['33']}]});

(async()=>{
 await admin.$executeRawUnsafe(`CREATE DATABASE \`${database}\``);created=true;
 prisma=new PrismaClient({datasources:{db:{url:url.toString()}}});
 cpSync('prisma/migrations',path.join(temporary,'migrations'),{recursive:true});
 rmSync(path.join(temporary,'migrations',migrationName),{recursive:true});
 writeFileSync(path.join(temporary,'schema.prisma'),readFileSync('prisma/schema.prisma','utf8'));
 cli(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(temporary,'schema.prisma')]);
 await mapKey('legacy');
 await raw(insertSql,'QA',1,'2031-10-01 08:00:00','2031-10-01 09:00:00','legacy','Legacy lesson');
 await raw('INSERT INTO calendar (calendar_source,code,learn_number,start_time,end_time,`key`) VALUES (?,?,?,?,?,?)','feed','feed-QA-OLD',1,'2031-10-02 08:00:00','2031-10-02 09:00:00','old-feed');
 await raw('INSERT INTO calendar (calendar_source,code,learn_number,start_time,end_time,`key`) VALUES (?,?,?,?,?,?)','feed','QA-MISMATCH',1,'2031-10-03 08:00:00','2031-10-03 09:00:00','mismatch');
 const triggerBefore=await query('SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME',database);
 const refusal=spawnSync('mysql',['--no-defaults','--protocol=TCP','-h',url.hostname,'-P',url.port,'-u',decodeURIComponent(url.username),database],{input:readFileSync('prisma/sql/calendar_source_from_program_code.sql','utf8'),encoding:'utf8',env:{...process.env,MYSQL_PWD:decodeURIComponent(url.password)}});
 assert.notEqual(refusal.status,0);assert.match(refusal.stderr,/chk_calendar_source_matches_program_prefix/);
 assert.deepEqual(await query('SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME',database),triggerBefore);
 assert.equal((await query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='calendar' AND COLUMN_NAME='calendar_source'",database))[0].n,1n);
 await raw('DELETE FROM calendar WHERE `key`=?','mismatch');
 const legacyBefore=(await query('SELECT * FROM calendar WHERE `key`=?','legacy'))[0];delete legacyBefore.calendar_source;
 const oldQueue=await query('SELECT * FROM hocmai_sync_queue ORDER BY id');
 cpSync(path.join(root,'prisma/migrations',migrationName),path.join(temporary,'migrations',migrationName),{recursive:true});
 cli(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(temporary,'schema.prisma')]);
 await prisma.$disconnect();prisma=new PrismaClient({datasources:{db:{url:url.toString()}}});
 assert.equal((await query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='calendar' AND COLUMN_NAME='calendar_source'",database))[0].n,0n);
 assert.deepEqual((await query('SELECT * FROM calendar WHERE `key`=?','legacy'))[0],legacyBefore);
 assert.deepEqual(await query('SELECT * FROM hocmai_sync_queue ORDER BY id'),oldQueue);
 checks.push('All historical migrations + prefix migration; column removed, IDs/keys/data/mapping/queue retained; mismatched source migration rejected BEFORE replacing triggers');
 // Real trigger insert/update/status checks require no source column.
 for(const code of ['QA-TRIGGER','feed-QA-TRIGGER','FEED-QA-UPPER']){
  const key=code;await mapKey(key);
  await raw(insertSql,code,1,'2031-12-01 08:00:00','2031-12-01 09:00:00',key,'Trigger lesson');
  await raw('UPDATE calendar SET lesson_name=? WHERE `key`=?','Updated',key);
  await raw('UPDATE calendar SET lesson_status=1 WHERE `key`=?',key);
  assert.equal(Number(await countQueue(key)),/^feed-/i.test(code)?0:3);
 }
 checks.push('Actual INSERT/UPDATE/status triggers skip lowercase and uppercase Feed prefixes; Livestream keeps all three actions');
 await raw('ALTER TABLE teacher_profiles ADD COLUMN can_view_stream_key TINYINT NOT NULL DEFAULT 1');
 await prisma.teacher_profiles.create({data:{username:'qa-teacher',display_name:'QA Teacher',teacher_type:1,can_view_stream_key:1}});
 await prisma.teacher_profiles.create({data:{username:'qa-assistant',display_name:'QA Assistant',teacher_type:0,can_view_stream_key:0}});
 const services=await import('../src/modules/livestream/livestream.service');
 const shared=await import('../src/lib/prisma');servicePrisma=shared.default;
 const payload=(code:string,date='2031-12-05')=>({...makePayload(code),start_time:date+'T08:00:00Z',end_time:date+'T09:00:00Z',teacher:'QA Teacher',assistant_teacher:'qa-assistant',lesson_count:0});
 const live=await services.createSingle(payload('QA-TWIN'));
 const feed=await services.createSingle(payload('feed-QA-TWIN'));
 assert.equal(live.lesson_count,0);assert.equal(feed.lesson_count,0);
 assert.notEqual(live.key,feed.key);assert.equal(Number(await countQueue(live.key!)),1);assert.equal(Number(await countQueue(feed.key!)),0);
 await assert.rejects(services.createSingle({...payload('feed-QA-TWIN'),lesson_count:1}),/trùng/);
 await assert.rejects(services.createSingle({...payload('QA-SPOOF'),calendar_source:'feed'}),/mã chương trình/);
 await services.updateBulk({ids:[live.id,feed.id],config_mode:'common',update_data:{start_time:'10:00',end_time:'11:00'}},actor);
 await services.updateBulk({ids:[live.id,feed.id],config_mode:'separate',update_data:[{id:live.id,start_time:'12:00',end_time:'13:00'},{id:feed.id,start_time:'12:00',end_time:'13:00'}]},actor);
 assert.equal(Number(await countQueue(feed.key!)),0);
 await assert.rejects(services.updateBulk({ids:[feed.id],config_mode:'common',update_data:{calendar_source:'livestream'}}),/mã chương trình/);
 const liveList=await services.getCalendar({limit:300},null,true);
 const feedList=await services.getCalendar({calendar_source:'feed',limit:300},null,true);
 assert.ok(liveList.data.every(c=>c.calendar_source==='livestream'&&!/^feed-/i.test(c.code)));
 assert.ok(feedList.data.every(c=>c.calendar_source==='feed'&&/^feed-/i.test(c.code)));
 assert.equal((await services.getCalendar({code:'feed-QA-TWIN',calendar_source:'feed'},['feed-QA-TWIN'])).total,1);

 // Existing conflict rules still apply to distinct programs within the same source.
 await assert.rejects(services.createSingle({...payload('QA-OTHER-LIVE'),start_time:'2031-12-05T12:00:00Z',end_time:'2031-12-05T13:00:00Z',assistant_teacher:null}),/trùng/);
 await assert.rejects(services.createSingle({...payload('feed-QA-OTHER'),start_time:'2031-12-05T12:00:00Z',end_time:'2031-12-05T13:00:00Z',teacher:null}),/trùng/);
 const blocker=await services.createSingle({...payload('QA-BLOCKER'),start_time:'2031-12-05T14:00:00Z',end_time:'2031-12-05T15:00:00Z'});
 const bulkBefore=await prisma.calendar.findMany({where:{id:{in:[live.id,feed.id]}},orderBy:{id:'asc'}});
 const bulkQueueBefore=await query('SELECT * FROM hocmai_sync_queue ORDER BY id');
 await assert.rejects(services.updateBulk({ids:[live.id,feed.id],config_mode:'common',update_data:{start_time:'14:00',end_time:'15:00'}},actor),/trùng/);
 assert.deepEqual(await prisma.calendar.findMany({where:{id:{in:[live.id,feed.id]}},orderBy:{id:'asc'}}),bulkBefore);
 assert.deepEqual(await query('SELECT * FROM hocmai_sync_queue ORDER BY id'),bulkQueueBefore);
 assert.equal(live.key,'tc_3132_QA-TWIN_1');
 assert.equal(feed.key,'tc_3132_feed-QA-TWIN_1');
 assert.ok(await prisma.users.count({where:{code:'feed-QA-TWIN',username:'qa-teacher'}}),'Feed teacher enrollment must stay enabled');
 assert.ok((await query('SELECT COUNT(*) n FROM teams_notification_outbox WHERE calendar_id=?',feed.id))[0].n>0n,'Feed Teams outbox must stay enabled');
 checks.push('Single/common/separate: source inferred from code; twin programs with same lesson/time/staff allowed; same-source duplicates and spoofed source rejected; filters work without source column');
 const {previewAutoSchedule}=await import('../src/modules/livestream/auto-schedule.service');
 const auto=(code:string)=>previewAutoSchedule({program_code:code,system_type:'topclass',start_date:'2032-01-05',blocks:[{lessons:[{learn_number:1,sessions:[{weekday:1,start_time:'08:00',end_time:'09:00',teacher:'QA Teacher',assistant_teacher:'qa-assistant'}]}]}]});
 const autoRows=[...auto('QA-AUTO').calendars,...auto('feed-QA-AUTO').calendars];
 const autoCreated=await services.createBulk({calendars:autoRows.map(({auto_schedule,...row})=>({...row,package_lesson_mappings:[{package_id:'11',course_id:'22',lesson_ids:['33']}]}))});
 assert.equal(Number(await countQueue(autoCreated.calendars[0].key!)),1);assert.equal(Number(await countQueue(autoCreated.calendars[1].key!)),0);
 await prisma.lessons.create({data:{subject_code:'feed-QA-AUTO',subject_name:'Feed QA',learn_number:1,grade:8,lesson_name:'QA lesson'}});
 assert.equal((await services.getProgramLessonsForScheduling('feed-QA-AUTO'))[0].scheduled_count,1);
 await prisma.calendar.update({where:{id:feed.id},data:{evg_stream:'qa-feed-evg'}});
 await assert.rejects(services.provisionCalendarEvgStream(feed.id,'qa-admin'),/Chưa cấu hình banner/);
 assert.equal((await prisma.calendar.findUnique({where:{id:feed.id}}))?.evg_stream,'qa-feed-evg','Missing banner must not change an incomplete EVG record');
 const resend=await services.resendCalendarsToHocmai([live.id,feed.id]);assert.ok(resend.skipped_ids.includes(feed.id));
 const makeup=await services.rescheduleSession(feed.id,{mode:'makeup',reason:'QA',new_session:{start_time:'2032-02-01T08:00:00Z',end_time:'2032-02-01T09:00:00Z'}},actor);
 assert.equal(makeup.created_session.code,'feed-QA-TWIN');assert.equal(Number(await countQueue(makeup.created_session.key!)),0);
 await services.createValidatedInternalCalendarImport([{row:2,calendar:{...makePayload('feed-QA-RAW'),skip_teacher_profile_validation:true}}] as any);
 await services.createValidatedCalendarImport([{row:2,calendar:makePayload('feed-QA-IMPORT'),mappings:[{package_id:'11',course_id:'22',lesson_id:'33'}]}] as any);
 for(const code of ['feed-QA-RAW','feed-QA-IMPORT']){const row=await prisma.calendar.findFirstOrThrow({where:{code}});assert.equal(Number(await countQueue(row.key!)),0);}
 checks.push('Automatic/bulk creation, lesson counts, EVG/resend, makeup and both import paths derive Feed from code and do not enqueue HMO');

 // Regression: following queries must work after the source column is removed.
 // Both sources keep original key/mapping movement and never touch the other source.
 const chainPayload=(code:string,n:number,date:string)=>({...payload(code,date),learn_number:n});
 const liveChain=[await services.createSingle(chainPayload('QA-CHAIN',1,'2033-03-03')),await services.createSingle(chainPayload('QA-CHAIN',2,'2033-03-10'))];
 const feedChain=[await services.createSingle(chainPayload('feed-QA-CHAIN',1,'2033-03-03')),await services.createSingle(chainPayload('feed-QA-CHAIN',2,'2033-03-10'))];
 for(const [chain,other] of [[feedChain,liveChain],[liveChain,feedChain]]){
   const otherBefore=await prisma.calendar.findMany({where:{id:{in:other.map(c=>c.id)}},orderBy:{id:'asc'}});
   const shifted=await services.rescheduleSession(chain[0].id,{mode:'following',reason:'Regression following',new_session:{start_time:'2033-03-17T08:00:00Z',end_time:'2033-03-17T09:00:00Z'}},actor);
   assert.equal(shifted.canceled_session.lesson_status,1);
   assert.equal(shifted.shifted_sessions[0].key,chain[0].key);
   assert.equal(shifted.created_session.key,chain[1].key);
   assert.equal(shifted.created_session.code,chain[0].code);
   assert.equal((await query('SELECT COUNT(*) n FROM package_lesson_mapping WHERE `key` IN (?,?)',chain[0].key,chain[1].key))[0].n,2n);
   assert.deepEqual(await prisma.calendar.findMany({where:{id:{in:other.map(c=>c.id)}},orderBy:{id:'asc'}}),otherBefore);
   const sourceQueue=await query('SELECT action FROM hocmai_sync_queue WHERE c_key IN (?,?,?) ORDER BY id',chain[0].key,chain[1].key,shifted.canceled_session.key);
   if(chain[0].code.startsWith('feed-')) assert.deepEqual(sourceQueue,[]);
   else assert.ok(sourceQueue.some(q=>q.action==='update-status-lesson')&&sourceQueue.some(q=>q.action==='update')&&sourceQueue.some(q=>q.action==='create'));
 }
 for(const code of ['QA-AFTER','feed-QA-AFTER']){
   const first=await services.createSingle(chainPayload(code,1,'2033-04-02'));
   await services.createSingle(chainPayload(code,2,'2033-04-09'));
   await services.rescheduleSession(first.id,{mode:'cancel',reason:'Regression cancel'},actor);
   const shifted=await services.rescheduleSession(first.id,{mode:'following',source_state:'canceled_without_makeup',reason:'Regression following after cancel',new_session:{start_time:'2033-04-16T08:00:00Z',end_time:'2033-04-16T09:00:00Z'}},actor);
   assert.equal(shifted.created_session.code,code);
   assert.equal(shifted.canceled_session.lesson_status,1);
   assert.equal(shifted.shifted_sessions.length,1);
 }
 checks.push('Live/Feed following and following after cancellation work without the source column; original key/mapping movements and Live queue actions preserved; opposite source calendars unchanged');

 // Source consistency with canonical lessons must not permit cross-source links.
 const internalFeed=await prisma.lessons.create({data:{subject_code:'feed-QA-INTERNAL',subject_name:'QA',learn_number:1,grade:8,lesson_name:'Internal Feed'}});
 const internalLive=await prisma.lessons.create({data:{subject_code:'QA-INTERNAL',subject_name:'QA',learn_number:1,grade:8,lesson_name:'Internal Live'}});
 await assert.rejects(services.createSingle({...makePayload('QA-INTERNAL'),session_id:String(internalFeed.id)}),/cùng nguồn/);
 await assert.rejects(services.createSingle({...makePayload('feed-QA-INTERNAL'),session_id:String(internalLive.id)}),/cùng nguồn/);
 const feedInternalCalendar=await services.createSingle({...makePayload('feed-QA-INTERNAL'),session_id:String(internalFeed.id)});
 assert.equal(Number(await countQueue(feedInternalCalendar.key!)),0);
 const liveInternalCalendar=await services.createSingle({...makePayload('QA-INTERNAL'),session_id:String(internalLive.id)});
 assert.equal(Number(await countQueue(liveInternalCalendar.key!)),1);
 const {syncCalendarsFromLessons}=await import('../src/modules/lessons/lesson.repository');
 await prisma.$transaction(async tx=>{
   await tx.lessons.update({where:{id:internalFeed.id},data:{lesson_name:'Renamed Feed'}});
   await tx.lessons.update({where:{id:internalLive.id},data:{lesson_name:'Renamed Live'}});
   await syncCalendarsFromLessons(tx,[internalFeed.id,internalLive.id]);
 });
 assert.equal((await prisma.calendar.findUniqueOrThrow({where:{id:feedInternalCalendar.id}})).lesson_name,'Renamed Feed');
 assert.equal((await prisma.calendar.findUniqueOrThrow({where:{id:liveInternalCalendar.id}})).lesson_name,'Renamed Live');
 assert.equal(Number(await countQueue(feedInternalCalendar.key!)),0);
 assert.ok(Number(await countQueue(liveInternalCalendar.key!))>1);
 checks.push('Internal lessons cannot cross source boundaries; indirect lesson updates remain enabled for both sources and only Live enqueues HMO');
 mysql(readFileSync('prisma/sql/calendar_source_from_program_code.sql','utf8'));
 checks.push('Standalone prefix migration is idempotent after column removal');
 console.log(JSON.stringify({ok:true,mysql:'8.0',checks},null,2));
})().catch(e=>{process.stderr.write(String(e.stack||e)+'\n');process.exitCode=1}).finally(async()=>{
 await servicePrisma?.$disconnect();await prisma?.$disconnect();if(created)await admin.$executeRawUnsafe(`DROP DATABASE \`${database}\``);await admin.$disconnect();rmSync(temporary,{recursive:true,force:true});
});
