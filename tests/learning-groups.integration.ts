// Explicit local URL only; all writes are in a new disposable database.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const supplied=process.env.TEST_LEARNING_GROUPS_DATABASE_URL;
assert.ok(supplied,'Set TEST_LEARNING_GROUPS_DATABASE_URL explicitly');
const url=new URL(supplied);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Local server only');
const database=`lms_group_app_test_${randomBytes(6).toString('hex')}`;
const admin=new PrismaClient({datasources:{db:{url:supplied}}});
url.pathname='/'+database;
process.env.DATABASE_URL=url.toString();
process.env.TEAMS_NOTIFICATIONS_ENABLED='false';
global.fetch=async()=>{throw Error('Integration test must not call external APIs')};
let db:PrismaClient|undefined, created=false;
(async()=>{
 try {
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);created=true;
  const push=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8'});
  assert.equal(push.status,0,push.stderr+'\n'+push.stdout);
  const {default:client}=await import('../src/lib/prisma');db=client;
  const {saveProgramSettings,saveLearningGroup}=await import('../src/modules/learning-groups/learning-group.service');
  const {createSingle,getCalendar,updateSchedule,rescheduleSession}=await import('../src/modules/livestream/livestream.service');
  const {syncCalendarStudents}=await import('../src/modules/livestream/calendar-student-sync.service');
  const {ensureCalendarTeachingUsers}=await import('../src/modules/livestream/calendar-user-sync.service');
  await saveProgramSettings('QA_SMALL',{teaching_model:'small_group',default_capacity:2});
  const a=await saveLearningGroup('QA_SMALL',{name:'Group A',capacity:2});
  const b=await saveLearningGroup('QA_SMALL',{name:'Group B',capacity:2});
  assert.equal(a.group_code,'N001');assert.equal(b.group_code,'N002');
  await db.teacher_profiles.create({data:{username:'teacher-qa',display_name:'QA Teacher',can_view_stream_key:1}});
  const lesson=await db.lessons.create({data:{subject_code:'QA_SMALL',subject_name:'QA',learn_number:1,lesson_name:'Lesson 1'}});
  const payload=(group:number,day:string)=>({code:'QA_SMALL',session_id:String(lesson.id),group_id:group,teacher:'teacher-qa',system_type:'topclass',lesson_count:0,start_time:`2031-12-${day}T12:00:00Z`,end_time:`2031-12-${day}T13:00:00Z`});
  const actor={userId:1,username:'qa-admin'};
  const ca:any=await createSingle(payload(a.id,'01'),actor);
  const cb:any=await createSingle(payload(b.id,'02'),actor);
  assert.equal(ca.lesson_count,0);assert.equal(cb.lesson_count,0);
  assert.match(ca.key,new RegExp(`_G${a.id}$`));assert.notEqual(ca.key,cb.key);
  await assert.rejects(createSingle({...payload(a.id,'03'),group_id:undefined},actor),/bắt buộc/);
  await assert.rejects(saveProgramSettings('QA_SMALL',{teaching_model:'large_class'}),/code riêng/);
  await assert.rejects(updateSchedule(ca.id,{group_id:b.id},'current',actor),/Không chuyển nhóm/);
  for(const c of [ca,cb]) await db.package_lesson_mapping.create({data:{key:c.key,package_id:'900',course_id:'800',lesson_id:String(7000+c.id),code:c.code,learn_number:1}});
  const users=Array.from({length:3},(_,i)=>({userid:String(100+i),username:`student${i}`,name:`Student ${i}`,product_id:'900'}));
  const result=await syncCalendarStudents([ca.id,cb.id],'01/12/2031',undefined,users);
  assert.equal(result.inserted,3);
  assert.equal((await syncCalendarStudents([ca.id,cb.id],'01/12/2031',undefined,users)).inserted,0);
  const studentRows=await db.users.findMany({where:{username:{startsWith:'student'}}});
  assert.equal(studentRows.filter(u=>u.calendar_id===ca.id).length,2);
  assert.equal(studentRows.filter(u=>u.calendar_id===cb.id).length,1);
  assert.ok(studentRows.every(u=>u.class_id?.includes(`_C${u.calendar_id}_1`)));
  await saveLearningGroup('QA_SMALL',{name:'Renamed A',capacity:2},a.id);
  await assert.rejects(saveLearningGroup('QA_SMALL',{name:'A',capacity:1},a.id),/nhỏ hơn/);
  await ensureCalendarTeachingUsers(db,ca);
  const teachers=await db.users.findMany({where:{username:'teacher-qa'}});
  assert.equal(teachers.length,2);assert.notEqual(teachers[0].calendar_id,teachers[1].calendar_id);
  const filtered=await getCalendar({code:'QA_SMALL',group_id:a.id,limit:20},null,true);
  assert.equal(filtered.total,1);assert.equal(filtered.data[0].group_id,a.id);
  const overflow=[...users,...Array.from({length:2},(_,i)=>({userid:String(200+i),username:`extra${i}`,name:'Extra',product_id:'900'}))];
  await assert.rejects(syncCalendarStudents([ca.id,cb.id],'01/12/2031',undefined,overflow),/Không đủ chỗ/);
  assert.equal(await db.users.count({where:{username:{in:['extra0','extra1']}}}),0);
  // A second occurrence retains existing group membership rather than redistributing students.
  const ca2:any=await createSingle({...payload(a.id,'05'),lesson_count:1},actor);
  const cb2:any=await createSingle({...payload(b.id,'06'),lesson_count:1},actor);
  for(const c of [ca2,cb2])await db.package_lesson_mapping.create({data:{key:c.key,package_id:'900',course_id:'800',lesson_id:String(7000+c.id),code:c.code,learn_number:1}});
  assert.equal((await syncCalendarStudents([ca2.id,cb2.id],'01/12/2031',undefined,users)).inserted,3);
  const next=await db.users.findMany({where:{username:{startsWith:'student'},calendar_id:{in:[ca2.id,cb2.id]}}});
  for(const u of next){const old=studentRows.find(p=>p.username===u.username)!;assert.equal(u.calendar_id===ca2.id,old.calendar_id===ca.id);}
  const beforeB=await db.calendar.findMany({where:{group_id:b.id},orderBy:{id:'asc'}});
  await assert.rejects(rescheduleSession(ca.id,{mode:'following',reason:'QA',new_session:{group_id:b.id,start_time:'2031-12-07T12:00:00Z',end_time:'2031-12-07T13:00:00Z'}},actor),/Không chuyển nhóm/);
  await rescheduleSession(ca.id,{mode:'following',reason:'QA group-only shift',send_notification:false,new_session:{start_time:'2031-12-07T12:00:00Z',end_time:'2031-12-07T13:00:00Z'}},actor);
  assert.deepEqual(await db.calendar.findMany({where:{group_id:b.id},orderBy:{id:'asc'}}),beforeB,'Moving A must not change B');
  const legacyLesson=await db.lessons.create({data:{subject_code:'QA_LIVE',subject_name:'QA',learn_number:1,lesson_name:'Legacy lesson'}});
  const legacy:any=await createSingle({code:'QA_LIVE',session_id:String(legacyLesson.id),teacher:'teacher-qa',system_type:'topclass',start_time:'2031-12-10T12:00:00Z',end_time:'2031-12-10T13:00:00Z'},actor);
  assert.equal(legacy.key,'tc_3132_QA_LIVE_1');assert.equal(legacy.group_id,null);
  assert.equal((await db.users.findFirstOrThrow({where:{username:'teacher-qa',code:'QA_LIVE'}})).calendar_id,null);
  // Changing a grouped teacher/banner must never touch shared stream records.
  await db.teacher_profiles.create({data:{username:'teacher-new',display_name:'New Teacher',can_view_stream_key:1}});
  const shared=await db.stream.create({data:{code:'QA_SMALL',learn_number:1,room_id:1,banner_url:'legacy-banner'}});
  await db.calendar.update({where:{id:cb2.id},data:{group_room_config:{rooms:[{room_id:1,banner_url:'old-group-banner'}]}}});
  await updateSchedule(cb2.id,{teacher:'teacher-new'},'current',actor);
  assert.equal((await db.stream.findUniqueOrThrow({where:{id:shared.id}})).banner_url,'legacy-banner');
  assert.notEqual(((await db.calendar.findUniqueOrThrow({where:{id:cb2.id}})).group_room_config as any).rooms[0].banner_url,'old-group-banner');
  await db.stream.delete({where:{id:shared.id}});
  // New model does not rewrite existing shared stream/config tables.
  assert.equal(await db.stream.count(),0);assert.equal(await db.room_config.count(),0);
  console.log('Passed real-DB grouped scheduling, scoped teachers, stable allocation, capacity rollback, filtering and legacy stream isolation.');
 } finally {
  await db?.$disconnect();
  if(created)await admin.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
  await admin.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
