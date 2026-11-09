import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { importCalendarFromSheet, updateCalendarsFromSheet } from '../src/modules/livestream/calendar-import.service';
import { buildCalendarTemplate, buildCalendarFile, parseCalendarImportFile, validateCalendarImportRows, CALENDAR_FILE_COLUMNS } from '../src/modules/livestream/livestream.io';
import type { CalendarImportRow } from '../src/modules/livestream/calendar-import.types';

const master = {id:1n,subject_code:'PROGRAM',subject_name:'Toán',learn_number:1,lesson_name:'Hàm số',system_type:'topclass'};
const calendar = {id:1,key:'original-key',code:'PROGRAM',subject:'Toán',learn_number:1,lesson_count:0,session_id:1n,
  lesson_name:'Hàm số',teacher:'Cô An',assistant_teacher:'assistant',system_type:'topclass',lesson_status:0,
  start_time:new Date('2099-01-01T20:00:00Z'),end_time:new Date('2099-01-01T21:00:00Z')};
const profiles = [
  {username:'teacher',display_name:'Cô An',can_view_stream_key:1,status:1},
  {username:'assistant',display_name:'Trợ giảng An',can_view_stream_key:0,status:1},
  {username:'inactive',display_name:'Cô Cũ',can_view_stream_key:1,status:0},
  {username:'duplicate1',display_name:'Trùng tên',can_view_stream_key:1,status:1},
  {username:'duplicate2',display_name:'Trùng tên',can_view_stream_key:1,status:1},
];
const row = (changes: any = {}): CalendarImportRow => ({
  row:2,sourceFormat:'direct',sourceKey:'original-key',packageIds:[],courseIds:[],lessonIds:[],
  calendar:{...calendar,start_time:calendar.start_time.toISOString(),end_time:calendar.end_time.toISOString(),teacher:'Cô An',assistant_teacher:'Trợ giảng An',...changes},
});

test('status is explained in every template header and parses as 0/rest, 1/study', () => {
  assert.equal(CALENDAR_FILE_COLUMNS.at(-1)?.header, 'Trạng thái buổi học\n(0 = nghỉ, 1 = học)');
  for (const format of ['xlsx','csv'] as const) {
    const parsed = parseCalendarImportFile(buildCalendarTemplate(format), `sample.${format}`);
    assert.equal(parsed[0].lesson_status, '1');
    assert.equal(validateCalendarImportRows([{...parsed[0],learn_number:''}],{code:'PROGRAM',subject:'Toán',systemType:'topclass'}).errors.length,1);
  }
});

test('create/update enforce metadata, original lesson title and active teaching roles before writes', async () => {
  const originals = {query:prisma.$queryRaw,calendars:prisma.calendar.findMany,profiles:prisma.teacher_profiles.findMany,transaction:prisma.$transaction};
  let transactions = 0;
  (prisma as any).$queryRaw = async () => [{...master}];
  (prisma.calendar as any).findMany = async (args:any) => args.where.OR ? (args.where.OR[0].key.in.includes('original-key') ? [{...calendar}] : []) : [];
  (prisma.teacher_profiles as any).findMany = async ({where}:any) => profiles.filter(profile=>profile.can_view_stream_key===where.can_view_stream_key && profile.status===where.status);
  (prisma as any).$transaction = async (operation:any) => {
    transactions++;
    return operation({$executeRawUnsafe:async()=>1,calendar:{findMany:async()=>[{...calendar}]}});
  };
  const invalidUpdate = async (input:CalendarImportRow, field?:string) => {
    const before = transactions;
    const result = await updateCalendarsFromSheet([input],undefined,'overwrite');
    assert.equal(result.status,'validation_error');
    if(field) assert.ok(result.errors?.some(error=>error.field===field), JSON.stringify(result.errors));
    assert.equal(transactions,before);
  };
  try {
    const exported = {...calendar, teacher_name:'Cô An', assistant_name:'Trợ giảng An',live_date:'01/01/2099',time_range:'20:00-21:00'};
    const context={code:'PROGRAM',subject:'Toán',systemType:'topclass' as const};
    for (const changed of [{learn_number:2},{lesson_count:1},{subject:'Vật lí'},{key:'edited-key'}]) {
      const parsed=parseCalendarImportFile(buildCalendarFile([{...exported,...changed}],'xlsx'),'edited.xlsx');
      const validated=validateCalendarImportRows(parsed,context);
      assert.deepEqual(validated.errors,[]);
      await invalidUpdate(validated.importRows[0]);
    }
    for (const changed of [{code:'OTHER'},{code:''},{subject:''},{system_type:''},{system_type:'topuni'}]) {
      const parsed=parseCalendarImportFile(buildCalendarFile([{...exported,...changed}],'csv'),'edited.csv');
      assert.ok(validateCalendarImportRows(parsed,context).errors.length>0);
    }
    await invalidUpdate({...row(),sourceKey:undefined},'Mã định danh lịch');
    await invalidUpdate({...row(),sourceKey:'edited-key'},'key');
    await invalidUpdate(row({subject:'Vật lí'}),'Môn');
    await invalidUpdate(row({code:'OTHER'}),'code');
    await invalidUpdate(row({learn_number:2}),'learn_number');
    await invalidUpdate(row({system_type:'topuni'}),'system_type');
    await invalidUpdate(row({lesson_count:1}),'lesson_count');
    await invalidUpdate(row({lesson_count:undefined}),'Lần học');
    const multiple = await updateCalendarsFromSheet([row({subject:'Vật lí',learn_number:2,lesson_count:1})],undefined,'overwrite');
    assert.equal(multiple.errors?.length,3);
    const wrongLesson = multiple.errors?.find(error=>error.field==='learn_number');
    assert.equal(wrongLesson?.reasonCode,'IMMUTABLE_FIELD');
    assert.equal(wrongLesson?.currentValue,'1');
    assert.equal(wrongLesson?.importedValue,'2');
    assert.match(wrongLesson?.suggestion || '',/Khôi phục/);

    await invalidUpdate(row({lesson_name:'Đổi tên hoàn toàn'}),'Tên bài giảng');
    await invalidUpdate(row({lesson_name:'Hàm mới số'}),'Tên bài giảng');
    for(const teacher of ['Không tồn tại','assistant','inactive','Trùng tên']) await invalidUpdate(row({teacher}),'Tên GV');
    for(const assistant_teacher of ['Không tồn tại','teacher','inactive']) await invalidUpdate(row({assistant_teacher}),'Trợ giảng');
    const invalidAssistants = await updateCalendarsFromSheet([row({assistant_teacher:'Không tồn tại 1,Không tồn tại 2'})],undefined,'overwrite');
    assert.equal(invalidAssistants.errors?.length,2);
    assert.ok(invalidAssistants.errors?.some(error=>error.message.includes('Không tồn tại 1')));
    assert.ok(invalidAssistants.errors?.some(error=>error.message.includes('Không tồn tại 2')));
    const badSkipped = await updateCalendarsFromSheet([row({teacher:'Không tồn tại'})],undefined,'skip');
    assert.equal(badSkipped.status,'validation_error');
    for(const lesson_name of ['Hàm số','[HỌC BÙ] Hàm số','Hàm số - Lần 2','[Lần 2] Hàm số (ôn tập)']) {
      const result=await updateCalendarsFromSheet([row({lesson_name})],undefined,'overwrite');
      assert.equal(result.status,'success');
    }
    const username = row({teacher:'teacher',assistant_teacher:'assistant'});
    assert.equal((await updateCalendarsFromSheet([username],undefined,'overwrite')).status,'success');
    assert.equal(username.calendar.teacher,'Cô An');
    assert.equal(username.calendar.assistant_teacher,'assistant');
    for(const changes of [{subject:'Vật lí'}, {lesson_name:'Tên tùy ý'}, {teacher:'inactive'}, {assistant_teacher:'teacher'}]) {
      const creating = {...row(changes),sourceKey:undefined};
      const before=transactions;
      assert.equal((await importCalendarFromSheet([creating])).status,'validation_error');
      assert.equal(transactions,before);
    }
    const findCalendar = prisma.calendar.findMany;
    (prisma.calendar as any).findMany = async (args:any) => args.where.OR ? [{...calendar,start_time:new Date('2020-01-01T20:00:00Z')}] : [];
    const writesBeforePast=transactions;
    const past = await updateCalendarsFromSheet([row()],undefined,'overwrite');
    assert.equal(past.status,'validation_error');
    assert.equal(transactions,writesBeforePast);
    assert.equal(past.errors?.[0].reasonCode,'PAST_SCHEDULE');
    assert.equal(past.errors?.[0].field,'start_time');
    assert.equal(past.errors?.[0].calendar?.startTime,'2020-01-01T20:00:00.000Z');
    assert.match(past.errors?.[0].suggestion || '',/bỏ dòng/);
    assert.doesNotMatch(past.errors?.[0].message || '',/original-key/);
    prisma.calendar.findMany=findCalendar;

    // The creation entry point also accepts a prefix/suffix and resolves profiles
    // before handing the complete row to its atomic creation service.
    (prisma as any).$transaction = async () => {transactions++;return {count:1};};
    const creating={...row({lesson_name:'[Lần 2] Hàm số (ôn tập)',teacher:'teacher'}),sourceKey:undefined};
    assert.equal((await importCalendarFromSheet([creating])).status,'success');
    assert.equal(creating.calendar.teacher,'Cô An');
    assert.equal(creating.calendar.assistant_teacher,'assistant');
    assert.equal(creating.calendar.session_id,1n);
    const withAffixes={...row({lesson_name:'',teacher:'teacher'}),sourceKey:undefined,lessonNamePrefix:'[HỌC BÙ] ',lessonNameSuffix:' (lần 2)'};
    assert.equal((await importCalendarFromSheet([withAffixes])).status,'success');
    assert.equal(withAffixes.calendar.lesson_name,'[HỌC BÙ] Hàm số (lần 2)');

  } finally {
    prisma.$queryRaw=originals.query;
    prisma.calendar.findMany=originals.calendars;
    prisma.teacher_profiles.findMany=originals.profiles;
    prisma.$transaction=originals.transaction;
  }
});

test('parser reports the exact column and correction for invalid dates, times and status', () => {
  const context={code:'PROGRAM',subject:'Toán',systemType:'topclass' as const};
  const valid={code:'PROGRAM',subject:'Toán',system_type:'topclass',key:'original-key',learn_number:1,lesson_count:0,lesson_name:'Hàm số',live_date:'01/01/2099',time_range:'20:00-21:00'};
  for (const [changes,field] of [[{live_date:'31/02/2099'},'Ngày live'],[{time_range:'aa'},'Khung giờ'],[{lesson_status:2},'Trạng thái buổi học'],[{subject:''},'Môn']] as const) {
    const result=validateCalendarImportRows([{...valid,...changes}],context);
    assert.equal(result.errors[0].field,field);
    assert.ok(result.errors[0].suggestion);
    assert.equal(result.errors[0].row,2);
  }
  const mismatch=validateCalendarImportRows([{...valid,code:'OTHER'}],context).errors[0];
  assert.equal(mismatch.currentValue,'PROGRAM');
  assert.equal(mismatch.importedValue,'OTHER');
});
