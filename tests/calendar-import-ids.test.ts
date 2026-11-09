import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import { validateInternalCalendarImportMappings, importCalendarFromSheet, updateCalendarsFromSheet } from '../src/modules/livestream/calendar-import.service';
import { validateCalendarImportRows } from '../src/modules/livestream/livestream.io';
import type { CalendarImportRow } from '../src/modules/livestream/calendar-import.types';

const makeRow = (ids: Partial<CalendarImportRow> = {}): CalendarImportRow => ({
  row: 2, sourceFormat: 'direct', packageIds: ['100'], courseIds: ['200'], lessonIds: ['300'],
  calendar: {code: 'PROGRAM', subject:'Toán', lesson_name:'Bài 1', system_type:'topclass', learn_number: 1, lesson_count:0, session_id:1n,
    start_time:'2099-01-01T20:00:00Z', end_time:'2099-01-01T21:00:00Z', lesson_status:0}, ...ids,
});
const content = [
  {lesson_id:1n, package_id:'100', course_id:'200'},
  {lesson_id:1n, package_id:'101', course_id:'201'},
];

test('internal import retains supplied IDs and rejects invalid ID syntax', () => {
  const input = {code:'PROGRAM', subject:'Toán', lesson_name:'Bài 1', learn_number:1,
    live_date:'01/01/2099', time_range:'20:00-21:00', course_ids:'200', package_ids:'100', lesson_ids:'300'};
  const context = {code:'PROGRAM', subject:'Toán', systemType:'topclass' as const};
  const result = validateCalendarImportRows([input], context);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.importRows[0].courseIds, ['200']);
  assert.deepEqual(result.importRows[0].lessonIds, ['300']);
  assert.deepEqual(result.importRows[0].packageIds, ['100']);
  for (const field of ['course_ids','package_ids','lesson_ids']) {
    assert.equal(validateCalendarImportRows([{...input, [field]:'abc'}], context).errors.length, 1);
  }
});

test('checks content pair relationships and actual HMO lesson IDs; blanks preserve mapping', async () => {
  const originalMappings = prisma.lesson_course_mapping.findMany;
  const originalFetch = global.fetch;
  const originalToken = process.env.HMO_COURSE_OUTLINE_TOKEN;
  const originalQuery = prisma.$queryRaw;
  const originalCalendars = prisma.calendar.findMany;
  const originalTransaction = prisma.$transaction;
  const originalAssignedMappings = prisma.package_lesson_mapping.findMany;
  let requests: string[] = [];
  let databaseReads = 0;
  let apiMode = 'success';
  (prisma.lesson_course_mapping as any).findMany = async () => {databaseReads++; return content;};
  process.env.HMO_COURSE_OUTLINE_TOKEN = 'test-token';
  global.fetch = async (input) => {
    const url = new URL(String(input)); requests.push(`${url.searchParams.get('package')}:${url.searchParams.get('course')}`);
    if (apiMode === 'timeout') throw Object.assign(new Error('timeout'), {name:'TimeoutError'});
    if (apiMode === 'missing') return new Response(JSON.stringify({status:'error', data:null}));
    const course = url.searchParams.get('course');
    return new Response(JSON.stringify({status:'success', data:{course:{id:course, sections:[{id:'999', lessons:[{id:course==='200'?'300':'301'}, {id:course==='200'?'302':'303'}]}]}}}));
  };
  try {
    const blank = await validateInternalCalendarImportMappings([makeRow({packageIds:[],courseIds:[],lessonIds:[]})]);
    assert.deepEqual(blank.errors, []);
    assert.equal(blank.mappingsByRow.size, 0);
    assert.equal(databaseReads, 0);
    assert.deepEqual(requests, []);

    for (const ids of [{packageIds:['999']}, {courseIds:['999']}, {packageIds:['100'],courseIds:['201']}, {packageIds:['100','999']}]) {
      const result = await validateInternalCalendarImportMappings([makeRow(ids)]);
      assert.ok(result.errors.length > 0);
      assert.deepEqual(requests, []);
    }
    const result = await validateInternalCalendarImportMappings([makeRow(), makeRow({row:3})]);
    assert.deepEqual(result.errors.map(error=>error.errorCode), ['DUPLICATE_SCHEDULE_IN_FILE']);
    assert.deepEqual(requests, ['100:200']); // deduplicates HMO calls
    requests = [];
    const valid = await validateInternalCalendarImportMappings([makeRow({packageIds:[],courseIds:[]})]);
    assert.deepEqual(valid.errors, []);
    assert.deepEqual(valid.mappingsByRow.get(2), [{package_id:'100',course_id:'200',lesson_id:'300'}]);
    assert.deepEqual(requests.sort(), ['100:200','101:201']); // no cross product
    const wrongLesson = await validateInternalCalendarImportMappings([makeRow({lessonIds:['999']})]);
    assert.equal(wrongLesson.errors[0].errorCode, 'LESSON_NOT_FOUND');
    assert.equal(wrongLesson.errors[0].row, 2);
    const section = await validateInternalCalendarImportMappings([makeRow({lessonIds:['999']})]);
    assert.equal(section.errors[0].errorCode, 'LESSON_NOT_FOUND');
    const multiple = await validateInternalCalendarImportMappings([makeRow({lessonIds:['300','302']})]);
    assert.equal(multiple.errors[0].errorCode, 'INVALID_LESSON_ID');
    const courseOnly = await validateInternalCalendarImportMappings([makeRow({lessonIds:[]})]);
    assert.deepEqual(courseOnly.errors, []);
    assert.equal(courseOnly.mappingsByRow.size, 0);
    apiMode = 'missing';
    assert.ok((await validateInternalCalendarImportMappings([makeRow()])).errors.some(error=>error.errorCode === 'COURSE_NOT_FOUND'));
    apiMode = 'timeout';
    assert.equal((await validateInternalCalendarImportMappings([makeRow()])).errors[0].errorCode,'HMO_TIMEOUT');
    apiMode = 'success';

    // Both entry points must validate IDs before opening a write transaction.
    (prisma as any).$queryRaw = async () => [{id:1n,subject_code:'PROGRAM',learn_number:1,system_type:'topclass',subject_name:'Toán',lesson_name:'Bài 1'}];
    (prisma.calendar as any).findMany = async (args: any) => args.where.OR ? [{id:1,key:'key',code:'PROGRAM',subject:'Toán',lesson_name:'Bài 1',learn_number:1,lesson_count:0,session_id:1n,lesson_status:0,system_type:'topclass',start_time:new Date('2099-01-01T20:00:00Z'),end_time:new Date('2099-01-01T21:00:00Z')}] : [];
    (prisma as any).$transaction = async () => {throw new Error('must not write invalid IDs');};
    const creating = await importCalendarFromSheet([makeRow({lessonIds:['999']})]);
    assert.equal(creating.status,'validation_error');
    assert.ok(creating.errors?.some(error=>error.errorCode==='LESSON_NOT_FOUND'));
    const updating = await updateCalendarsFromSheet([makeRow({sourceKey:'key',lessonIds:['999']})], undefined,'overwrite');
    assert.equal(updating.status,'validation_error');
    assert.ok(updating.errors?.some(error=>error.errorCode==='LESSON_NOT_FOUND'));

    const assigned: any = {id:1,key:'key',code:'PROGRAM',subject:'Toán',lesson_name:'Bài 1',learn_number:1,package_id:'100',course_id:'200',lesson_id:'299'};
    (prisma.package_lesson_mapping as any).findMany = async () => [{...assigned}];
    let writes = 0;
    const queued: any[] = [];
    const manualStatements: string[] = [];
    (prisma as any).$transaction = async (callback: any) => {
      writes++;
      const calendar = (await prisma.calendar.findMany({where:{OR:[{key:'key'}]}}))[0];
      return callback({
        calendar:{findMany:async()=>[calendar]},
        package_lesson_mapping:{
          findMany:async()=>[{...assigned}],
          update:async({data}:any)=>Object.assign(assigned,data),
        },
        hocmai_sync_queue:{findFirst:async()=>null},
        $executeRawUnsafe:async(sql:string)=>{manualStatements.push(sql);},
        $queryRaw:async(strings:TemplateStringsArray)=> strings.join('').includes('FROM package_lesson_mapping') ? [{...assigned}] : [calendar],
        $executeRaw:async(strings:TemplateStringsArray,...values:any[])=>{
          if(strings.join('').includes('INSERT INTO hocmai_sync_queue')) queued.push(JSON.parse(values[2]));
        },
      });
    };
    const blankUpdate = await updateCalendarsFromSheet([makeRow({sourceKey:'key',packageIds:[],courseIds:[],lessonIds:[]})], undefined, 'overwrite');
    assert.equal(blankUpdate.status, 'success');
    assert.equal(writes, 0);
    assert.equal(assigned.lesson_id, '299');
    const validUpdate = await updateCalendarsFromSheet([makeRow({sourceKey:'key'})], undefined, 'overwrite');
    assert.equal(validUpdate.status, 'success');
    assert.equal(validUpdate.count, 1);
    assert.equal(assigned.lesson_id, '300');
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0].packages, [{package_id:'100',lesson_id:'300'}]);
    assert.equal(manualStatements[0], 'SET @lms_manual_hocmai_queue = 1');
    assert.equal(manualStatements.at(-1), 'SET @lms_manual_hocmai_queue = 0');

  } finally {
    prisma.lesson_course_mapping.findMany = originalMappings;
    prisma.calendar.findMany = originalCalendars;
    prisma.$queryRaw = originalQuery;
    prisma.$transaction = originalTransaction;
    prisma.package_lesson_mapping.findMany = originalAssignedMappings;
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HMO_COURSE_OUTLINE_TOKEN; else process.env.HMO_COURSE_OUTLINE_TOKEN=originalToken;
  }
});
