import assert from 'node:assert/strict';
import * as calendar from '../src/modules/livestream/livestream.service';
import {approvals} from '../src/modules/calendar-approvals/calendar-approval.service';
import {freshUser} from '../src/modules/calendar-approvals/calendar-approval.access';
import {inCalendarTransaction} from '../src/lib/calendar-transaction';
import {previewAutoSchedule} from '../src/modules/livestream/auto-schedule.service';
import {updateCalendarsFromSheet} from '../src/modules/livestream/calendar-import.service';
import {PERMISSIONS,jsonValue,type Command} from '../src/modules/calendar-approvals/calendar-approval.types';

export async function verifyCalendarApprovalParity(prisma:any) {
 const permissions=await prisma.permissions.findMany({where:{code:{in:['calendar.view','calendar.create','calendar.update','calendar.delete','calendar.import','calendar.teacher.manage',...Object.values(PERMISSIONS)]}}});
 const role=await prisma.roles.create({data:{code:'qa-parity',name:'QA parity',approval_policy:{calendar:Object.fromEntries(['create','update','delete','cancel','reschedule','swap','restore','mapping','import'].map(op=>[op,'REQUIRE']))},fieldPolicy:{modules:{calendar:{fields:{'*':{visible:true,editable:true}}}}},rolePermissions:{create:permissions.map((p:any)=>({permissionId:p.id}))}}});
 const users=[];
 for(const suffix of ['editor','reviewer'])users.push(await prisma.users.create({data:{username:'qa-parity-'+suffix,name:suffix,code:'qa-parity-'+suffix,userRoles:{create:{roleId:role.id}},programScopePolicy:{create:{mode:'ALL'}}}}));
 const actor=await freshUser(users[0].id),reviewer=await freshUser(users[1].id);
 const checks:string[]=[];
 const base=(code:string,lesson:any,index:number)=>({code,session_id:String(lesson.id),system_type:'topclass',learn_number:index+1,lesson_name:'Parity '+(index+1),start_time:`2036-06-${String(7+index*7).padStart(2,'0')}T18:00:00.000Z`,end_time:`2036-06-${String(7+index*7).padStart(2,'0')}T19:00:00.000Z`});
 const scenarios=['create','create-feed','create-shared','createBulk','auto','auto-topuni','auto-holiday','update','update-reason','update-silent','bulk-common','bulk-separate','cancel','makeup','following','bulk-cancel','bulk-makeup','swap','delete','restore','mapping','import-update'];
 for(const [index,name] of scenarios.entries()) {
  const code=(name==='create-feed'?'feed-':'')+'qa-parity-'+index;
  const lessons=[];for(let i=0;i<3;i++)lessons.push(await prisma.lessons.create({data:{subject_code:code,subject_name:'QA',system_type:name==='auto-topuni'?'topuni':'topclass',learn_number:i+1,lesson_name:'Parity '+(i+1)}}));
  const rows:any[]=[];
  if(!['create','create-feed','create-shared','createBulk','auto','auto-topuni','auto-holiday'].includes(name))for(let i=0;i<3;i++)rows.push(await calendar.createSingle(base(code,lessons[i],i),actor));
  if(name==='restore')await calendar.deleteSession(rows[0].id,actor);
  let command:Command;let direct:()=>Promise<any>;
  if(['create','create-feed'].includes(name)) {const payload={...base(code,lessons[0],0),...(name==='create-feed'?{calendar_source:'feed'}:{})};command={action:'create',payload};direct=()=>calendar.createSingle(payload,actor);}
  else if(name==='create-shared') {
   await prisma.teacher_profiles.upsert({where:{username:'qa-parity-teacher'},create:{username:'qa-parity-teacher',display_name:'QA parity shared',can_view_stream_key:1,teacher_type:1},update:{}});
   const slot={teacher:'qa-parity-teacher',lesson_name:'Shared parity',start_time:'2036-08-01T18:00:00.000Z',end_time:'2036-08-01T19:00:00.000Z'};
   await calendar.createSingle({code:'qa-shared-reference',system_type:'topclass',learn_number:1,...slot},actor);
   const payload={...base(code,lessons[0],0),...slot,allow_shared_staff_schedule:true};
   await assert.rejects(calendar.createSingle({...payload,allow_shared_staff_schedule:false},actor),/trùng/);
   command={action:'create',payload};direct=()=>calendar.createSingle(payload,actor);
  }
  else if(name==='createBulk') {const payload={calendars:lessons.slice(0,2).map((l,i)=>base(code,l,i))};command={action:'createBulk',payload};direct=()=>calendar.createBulk(payload,actor);}
  else if(name.startsWith('auto')) {const payload={program_code:code,system_type:(name==='auto-topuni'?'topuni':'topclass') as 'topuni'|'topclass',start_date:'2036-06-07',...(name==='auto-holiday'?{holidays:['2036-06-07']}:{}),blocks:[{lessons:lessons.map((l,i)=>({session_id:String(l.id),learn_number:i+1,sessions:[{weekday:6,start_time:'18:00',end_time:'19:00'}]}))}]};command={action:'auto',payload};direct=()=>calendar.createBulk({calendars:previewAutoSchedule(payload).calendars.map(({auto_schedule,...row}:any)=>row)},actor);}
  else if(name.startsWith('update')) {const payload={...(name!=='update'?{reason:'Original business reason'}:{}),...(name==='update-silent'?{send_notification:false}:{}),lesson_name:'Changed parity',start_time:'2036-06-07T20:00:00.000Z',end_time:'2036-06-07T21:00:00.000Z'};command={action:'update',id:rows[0].id,payload};direct=()=>calendar.updateSchedule(rows[0].id,payload,'current',actor);}
  else if(name.startsWith('bulk-')&&['bulk-common','bulk-separate'].includes(name)){const payload={ids:rows.map(r=>r.id),config_mode:name==='bulk-common'?'common':'separate',update_data:name==='bulk-common'?{start_time:'20:00',end_time:'21:00'}:rows.map((r,i)=>({id:r.id,start_date:`2036-07-${String(7+i*7).padStart(2,'0')}`,start_time:'20:00',end_time:'21:00'})),reason:'Parity'};command={action:'updateBulk',payload};direct=()=>calendar.updateBulk(payload,actor);}
  else if(name==='cancel'){const payload={reason:'Parity'};command={action:'cancel',id:rows[0].id,payload};direct=()=>calendar.cancelSession(rows[0].id,payload,actor);}
  else if(['makeup','following'].includes(name)){const payload={mode:name==='makeup'?'makeup':'following',reason:'Parity',new_session:{start_time:'2036-06-28T18:00:00.000Z',end_time:'2036-06-28T19:00:00.000Z'}};command={action:'reschedule',id:rows[0].id,payload};direct=()=>calendar.rescheduleSession(rows[0].id,payload,actor);}
  else if(['bulk-cancel','bulk-makeup'].includes(name)){const payload={ids:rows.slice(0,2).map(r=>r.id),operation:name==='bulk-cancel'?'cancel':'makeup',offset_days:1,reason:'Parity'};command={action:'updateBulk',payload};direct=()=>calendar.bulkRescheduleSessions(payload,actor);}
  else if(name==='swap'){const payload={first_id:rows[0].id,second_id:rows[1].id,first_start_time:'2036-06-14T20:00:00',first_end_time:'2036-06-14T21:00:00',reason:'Parity'};command={action:'swap',payload};direct=()=>calendar.swapSessionTimes(payload,actor);}
  else if(name==='delete'){command={action:'delete',id:rows[0].id,payload:{}};direct=()=>calendar.deleteSession(rows[0].id,actor);}
  else if(name==='restore'){command={action:'restore',id:rows[0].id,payload:{}};direct=()=>calendar.restoreSession(rows[0].id,actor);}
  else if(name==='import-update') {
   await prisma.package_lesson_mapping.create({data:{key:rows[0].key,code,learn_number:1,package_id:'901',course_id:'902',lesson_id:'903'}});
   const input=[{row:2,sourceFormat:'direct' as const,sourceKey:rows[0].key,packageIds:[],courseIds:[],lessonIds:[],calendar:{...base(code,lessons[0],0),lesson_count:rows[0].lesson_count,session_id:lessons[0].id,subject:'QA',start_time:'2036-06-07T20:00:00.000Z',end_time:'2036-06-07T21:00:00.000Z'}}];
   const preview=await updateCalendarsFromSheet(input,actor,'overwrite',true);
   assert.equal(preview.status,'preview',JSON.stringify(jsonValue(preview)));
   command={action:'import',payload:{mode:'update',rows:jsonValue(preview.rows)}};
   direct=()=>updateCalendarsFromSheet(input,actor,'overwrite');
  }
  else {await prisma.package_lesson_mapping.create({data:{key:rows[0].key,code,learn_number:1,package_id:'801',course_id:'802',lesson_id:'803'}});const payload={updates:[{id:rows[0].id,package_lesson_mappings:[]}]};command={action:'mapping',payload};direct=()=>calendar.updateCalendarMappings(payload,actor);}
  const snapshot=async(tx:any)=>{
   const data=jsonValue(await tx.calendar.findMany({where:{code,deleted_at:{}},orderBy:{key:'asc'}})) as any[];
   const queues=await tx.hocmai_sync_queue.findMany({where:{c_key:{in:data.map(row=>row.key).filter(Boolean)}},select:{c_key:true,action:true,status:true},orderBy:[{c_key:'asc'},{action:'asc'}]});
   const mappings=await tx.package_lesson_mapping.findMany({where:{key:{in:data.map(row=>row.key).filter(Boolean)}},select:{key:true,code:true,learn_number:true,package_id:true,course_id:true,lesson_id:true},orderBy:[{key:'asc'},{package_id:'asc'},{course_id:'asc'},{lesson_id:'asc'}]});
   return {mappings,rows:data.map(({id,created_at,updated_at,deleted_at,...row})=>({...row,deleted:Boolean(deleted_at)})),queues};
  };
  const submittedCommand=jsonValue(command);
  let expected:any;
  const rollback=new Error('rollback direct reference');
  try {await prisma.$transaction((tx:any)=>inCalendarTransaction(tx,async()=>{await direct();expected=await snapshot(tx);throw rollback;}),{timeout:180000});}catch(e){if(e!==rollback)throw new Error(name+' direct failed: '+(e as Error).message);}
  const before=await snapshot(prisma),queueBefore=await prisma.hocmai_sync_queue.count();
  let request:any;
  try {request=await approvals.create(actor,{command:submittedCommand,reason:'Parity',submit:true},undefined,submittedCommand.action==='import');}catch(e){throw new Error(name+' request failed: '+(e as Error).message);}
  assert.deepEqual(await snapshot(prisma),before,name+': pending must not write official schedules');
  assert.equal(await prisma.hocmai_sync_queue.count(),queueBefore,name+': pending must not enqueue official sync');
  try {await approvals.transition(reviewer,BigInt(request.id),'approve',{revision:request.revision,lock_version:request.lock_version});}catch(e){throw new Error(name+' approval failed: '+(e as Error).message);}
  assert.deepEqual(await snapshot(prisma),expected,name+': approved business result must equal existing direct service');
  checks.push(name);
 }
 return checks;
}
