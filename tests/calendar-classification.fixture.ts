import assert from 'node:assert/strict';
import {getCalendar,getCalendarHeaderFilterOptions} from '../src/modules/livestream/livestream.service';
import {getCalendarClassificationOptions} from '../src/modules/livestream/calendar-classification-filters';
export async function verifyCalendarClassification(prisma:any){
 const program='qa-classify-a',other='qa-classify-b',feed='feed-qa-classify';
 const createLesson=(code:string,subject_name:string,grade:number)=>prisma.lessons.create({data:{subject_code:code,subject_name,grade,learn_number:1,lesson_name:'Classification fixture'}});
 const a=await createLesson(program,'Toán',8),b=await createLesson(other,'Toán',9),f=await createLesson(feed,'Vật lí',8);
 const row=(code:string,session_id:bigint|null,key:string,day:number)=>({code,session_id,key,learn_number:1,subject:'Cached old subject',lesson_name:'Classification fixture',teacher:'QA',start_time:new Date(`2036-04-${day}T10:00:00Z`),end_time:new Date(`2036-04-${day}T11:00:00Z`)});
 const linked=await prisma.calendar.create({data:row('qa-classify-old',a.id,'qa-classify-linked',11)});
 const legacy=await prisma.calendar.create({data:row(program,null,'qa-classify-legacy',12)});
 await prisma.calendar.create({data:row(other,b.id,'qa-classify-other',13)});
 await prisma.calendar.create({data:row(feed,f.id,'qa-classify-feed',14)});
 const selected=await getCalendar({subject_name:'Toán',grade:8,limit:1,page:1},[program],true,true);
 assert.equal(selected.total,2);assert.equal(selected.data.length,1);assert.equal(selected.data[0].id,linked.id);
 const second=await getCalendar({subject_name:'Toán',grade:8,limit:1,page:2},[program],true,true);assert.equal(second.data[0].id,legacy.id);
 assert.equal((await getCalendar({subject_name:'Toán',grade:9},[program],true,true)).total,0);
 assert.equal((await getCalendar({subject_name:'Toán',grade:8},[],true,true)).total,0);
 assert.equal((await getCalendar({calendar_source:'feed',grade:8,subject_name:'Vật lí'},[feed],true,true)).total,1);
 assert.equal((await getCalendar({calendar_source:'livestream',grade:8,subject_name:'Vật lí'},[feed],true,true)).total,0);
 const combined=await getCalendar({subject_name:'Toán',grade:8,keyword:'Classification fixture',from_learn_number:1,to_learn_number:1,start_time:'2036-04-12T00:00:00Z',end_time:'2036-04-12T23:59:59Z'},[program],true,true);
 assert.equal(combined.total,1);assert.equal(combined.data[0].id,legacy.id);
 const options=await getCalendarClassificationOptions([program]);assert.deepEqual(options,[{code:program,subject_name:'Toán',grade:8}]);assert.deepEqual(await getCalendarClassificationOptions([]),[]);
 for(const grade of [0,13,8.5,'bad'])await assert.rejects(getCalendar({grade},[program],true,true),/Khối/);
 const header:any=await getCalendarHeaderFilterOptions({subject_name:'Toán',grade:9},[program],true);assert.ok(header);
 return ['subject/grade filters use curriculum identity and legacy lesson mapping, intersect permissions/source/date/search, and preserve pagination','classification options respect account program scope and invalid grades are rejected'];
}
