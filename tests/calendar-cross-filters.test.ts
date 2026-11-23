import test from 'node:test';
import assert from 'node:assert/strict';
import {getCalendarCrossFilterOptions} from '../src/modules/livestream/livestream.service';
import {calendarFacetQuery, calendarProgress, calendarWeekday} from '../src/modules/livestream/calendar-faceted-filters';

const now = new Date('2026-11-23T12:00:00Z');
const row = (code: string, teacher: string, system_type: string, date: string, extra = {}) => ({
  code, teacher, system_type, start_time: new Date(date+'T19:00:00Z'), end_time: new Date(date+'T20:00:00Z'), lesson_status: 0, session_id: null, ...extra,
});
const fixture = [
  row('A','Cô An','topclass','2020-11-02'),
  row('A','Cô Bình','topuni','2020-11-03',{lesson_status:1}),
  row('B','Cô An','topuni','2020-11-02'),
  row('DENIED','Người ngoài phạm vi','topclass','2020-11-02'),
  row('stored-old-code','gv-chi','topclass','2020-11-04',{session_id:7n}),
  row('feed-A','Giáo viên Feed','topuni','2020-11-02'),
  row('A','Ngoài khoảng ngày','topclass','2020-12-02'),
];
const program = (r: typeof fixture[number]) => r.session_id === 7n ? 'B' : r.code;
const mockReads = () => {
  const calls: any[] = [];
  const buildQuery = async (query: any, scope: string[] | null, allowAll: boolean) => {
    assert.equal(allowAll,true);
    calls.push({query,scope});
    return {where:{query,scope}};
  };
  const db = {
    calendar: {findMany: async ({where:{query:q,scope},skip,take}:any) => {
      assert.equal(skip,undefined); assert.equal(take,undefined);
      return fixture.filter(r => (scope===null || scope.includes(program(r)))
        && (q.calendar_source==='feed' ? r.code.startsWith('feed-') : !r.code.startsWith('feed-'))
        && (!q.code || q.code===program(r)) && (!q.teacher || q.teacher.split(',').includes(r.teacher))
        && (!q.system_type || q.system_type.split(',').includes(r.system_type))
        && (!q.time_status || q.time_status.split(',').includes(calendarProgress(r,now)))
        && (!q.weekdays || q.weekdays.split(',').map(Number).includes(calendarWeekday(r.start_time)))
        && (!q.start_time || r.start_time>=new Date(q.start_time)) && (!q.end_time || r.start_time<=new Date(q.end_time)));
    }},
    lessons: {findMany:async()=>[{id:7n,subject_code:'B'}]},
    teacher_profiles: {findMany:async()=>[{username:'gv-chi',display_name:'Cô Chi'}]},
  };
  return {db:db as any, buildQuery:buildQuery as any, calls};
};
const base={calendar_source:'livestream',start_time:'2020-11-01T00:00:00Z',end_time:'2020-11-30T23:59:59Z'};

test('weekly links retain program scope and systems, including programs owned by linked lessons',async()=>{
  const mock=mockReads();
  const result=await getCalendarCrossFilterOptions({...base,week_links:'true'},['B'],mock.db,mock.buildQuery);
  assert.deepEqual(result.program_systems,[{code:'B',system_type:'topuni'},{code:'B',system_type:'topclass'}]);
  const empty=await getCalendarCrossFilterOptions({...base,week_links:'true'},[],mock.db,mock.buildQuery);
  assert.deepEqual(empty.program_systems,[]);
  assert.equal((await getCalendarCrossFilterOptions(base,['B'],mock.db,mock.buildQuery)).program_systems,undefined);
});

test('program and teacher choices cross-filter in both directions across the full result',async()=>{
  const mock=mockReads();
  const result=await getCalendarCrossFilterOptions({...base,code:'A',page:3,limit:1},['A','B'],mock.db,mock.buildQuery);
  assert.deepEqual(result.teachers.map(t=>t.value),['Cô An','Cô Bình']);
  assert.deepEqual(result.systems.sort(),['topclass','topuni']);
  assert.deepEqual(result.statuses.sort(),['cancelled','completed']);
  assert.deepEqual(result.weekdays,[1,2]);
  const reverse=await getCalendarCrossFilterOptions({...base,teacher:'Cô An'},['A','B'],mock.db,mock.buildQuery);
  assert.deepEqual(reverse.programs,['A','B']);
  const system=await getCalendarCrossFilterOptions({...base,system_type:'topuni'},['A','B'],mock.db,mock.buildQuery);
  assert.deepEqual(system.programs,['A','B']);
  assert.deepEqual(system.weekdays,[1,2]);
  assert.ok(mock.calls.every(c=>c.scope.join(',')==='A,B' && c.query.start_time===base.start_time && c.query.page===1));
});

test('choices retain scope, source and dates, and linked lessons determine the program',async()=>{
  const mock=mockReads();
  const result=await getCalendarCrossFilterOptions({...base,teacher:'gv-chi'},['B'],mock.db,mock.buildQuery);
  assert.deepEqual(result.programs,['B']);
  assert.equal(result.teachers.find(t=>t.value==='gv-chi')?.label,'Cô Chi');
  const restricted=await getCalendarCrossFilterOptions(base,['A'],mock.db,mock.buildQuery);
  assert.deepEqual(restricted.programs,['A']);
  assert.ok(!restricted.teachers.some(t=>/ngoài|Feed|chi/i.test(t.label)));
  const empty=await getCalendarCrossFilterOptions(base,[],mock.db,mock.buildQuery);
  assert.deepEqual(empty,{programs:[],teachers:[],systems:[],statuses:[],weekdays:[]});
  const feed=await getCalendarCrossFilterOptions({...base,calendar_source:'feed'},null,mock.db,mock.buildQuery);
  assert.deepEqual(feed.programs,['feed-A']);
});

test('each facet keeps the other conditions and cancelled status overrides time',()=>{
  const input={...base,code:'A',code_exact:'A',teacher:'Cô An',weekdays:'1,2',time_status:'completed',system_type:'topuni',from_learn_number:2,to_learn_number:8};
  const programQuery=calendarFacetQuery(input,'code');
  assert.equal(programQuery.code,undefined); assert.equal(programQuery.code_exact,undefined);
  assert.equal(programQuery.teacher,'Cô An'); assert.equal(programQuery.from_learn_number,2);
  assert.equal(calendarFacetQuery(input,'teacher').code,'A');
  assert.equal(calendarProgress({...fixture[0],lesson_status:1},now),'cancelled');
  assert.equal(calendarWeekday(new Date('2026-11-22T23:30:00Z')),7);
  assert.equal(input.code,'A');
});
