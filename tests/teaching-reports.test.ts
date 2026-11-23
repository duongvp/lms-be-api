import test from 'node:test';
import assert from 'node:assert/strict';
import {day,intervalSeconds,paginate,scheduleOverlaps} from '../src/modules/teaching-reports/report-domain';
import {resolveIdentity,resolveProfile} from '../src/modules/teaching-reports/report.service';
const session=(start:string,end:string)=>({start_time:new Date('2020-01-01T'+start+'Z'),end_time:new Date('2020-01-01T'+end+'Z')});
test('union shared and overlapping schedules without multiplying staff duration',()=>assert.equal(intervalSeconds([session('19:00:00','20:00:00'),session('19:00:00','20:00:00'),session('19:30:00','20:30:00')]),5400));
test('sum distinct teaching intervals and ignore invalid durations',()=>assert.equal(intervalSeconds([session('19:00:00','20:00:00'),session('21:00:00','22:00:00'),session('22:00:00','21:00:00')]),7200));
test('empty teaching schedules have zero duration',()=>assert.equal(intervalSeconds([]),0));
test('reject invalid report day',()=>assert.throws(()=>day('2020-02-30')));
test('resolve by unique username and do not guess duplicate teacher names',()=>{const profiles=[{id:1,username:'gv1',display_name:'Cô A'},{id:2,username:'gv2',display_name:'Cô A'}];assert.equal(resolveProfile(profiles,'gv1')?.id,1);assert.equal(resolveProfile(profiles,'Cô A'),null);});
test('pagination uses complete collection and validates sort',()=>{const rows=[{id:1,name:'A'},{id:2,name:'B'}];assert.equal(paginate(rows,{page:1,limit:1},['name'],'name').pagination.total,2);assert.throws(()=>paginate(rows,{sort:'private'},['name'],'name'));});
test('historical full-name aliases resolve to display-name profiles, but collisions remain unresolved',()=>{
 const profiles=[{id:1,username:' GV1 ',display_name:'Cô Linh',aliases:['Dương Thùy Linh']},{id:2,username:'gv2',display_name:'Cô Oanh',aliases:['Chu Thị Lâm Oanh']}];
 assert.equal(resolveProfile(profiles,'  Dương  Thùy Linh ')?.id,1);
 assert.equal(resolveProfile(profiles,'gv1')?.id,1);
 assert.equal(resolveProfile([...profiles,{id:3,username:'gv3',aliases:['Dương Thùy Linh']}],'Dương Thùy Linh'),null);
 assert.equal(resolveProfile(profiles,'Nguyễn Thanh Tùng'),null);
});

test('current staff names take priority over another profile historical alias',()=>{
 const profiles=[
  {id:1,username:'teacher-fixture',display_name:'Thiều Thị Dung',aliases:['Hoàng Quỳnh Trang']},
  {id:2,username:'assistant-fixture',display_name:'Hoàng Quỳnh Trang',aliases:['Thiều Thị Dung']},
 ];
 assert.equal(resolveProfile(profiles,'  THIỀU  THỊ DUNG  ')?.id,1);
 assert.equal(resolveProfile(profiles,'Hoàng Quỳnh Trang'.normalize('NFD'))?.id,2);
 assert.equal(resolveIdentity(profiles,'Thiều Thị Dung').status,'matched');
 assert.equal(resolveProfile([...profiles,{id:3,username:'other-fixture',display_name:'teacher-fixture'}],'teacher-fixture')?.id,1);
});

test('duplicate current names and duplicate alias-only matches remain ambiguous',()=>{
 const profiles=[
  {id:1,username:'teacher-1',display_name:'Thiều Thị Dung'},
  {id:2,username:'teacher-2',display_name:'Thiều Thị Dung'},
  {id:3,username:'teacher-3',display_name:'Cô Dung',aliases:['Thiều Thị Dung']},
 ];
 assert.deepEqual(resolveIdentity(profiles,'Thiều Thị Dung'),{profile:null,status:'ambiguous'});
 const aliases=[profiles[2],{id:4,username:'teacher-4',display_name:'Tên khác',aliases:['Thiều Thị Dung']}];
 assert.deepEqual(resolveIdentity(aliases,'Thiều Thị Dung'),{profile:null,status:'ambiguous'});
 assert.equal(resolveProfile([profiles[2]],'Thiều Thị Dung')?.id,3);
 assert.deepEqual(resolveIdentity(profiles,'Không có hồ sơ'),{profile:null,status:'missing'});
});

test('overlap warnings include nested and identical intervals, exclude touching endpoints and invalid ranges',()=>{
 const rows=[{id:1,...session('19:00:00','21:00:00')},{id:2,...session('19:30:00','20:00:00')},{id:3,...session('19:30:00','20:00:00')},{id:4,...session('21:00:00','22:00:00')},{id:5,...session('22:00:00','21:00:00')}];
 const result=scheduleOverlaps(rows);
 assert.deepEqual(result.get(1),{count:2,calendar_ids:[2,3]});
 assert.deepEqual(result.get(2),{count:2,calendar_ids:[1,3]});
 assert.equal(result.get(4)?.count,0);assert.equal(result.has(5),false);
});
test('overlap detection matches exhaustive results and caps examples without losing counts',()=>{
 const rows=Array.from({length:80},(_,id)=>({id,start_time:new Date((id*17%50)*60000),end_time:new Date(((id*17%50)+1+(id*7%30))*60000)}));
 const result=scheduleOverlaps(rows);
 for(const s of rows){const others=rows.filter(o=>o.id!==s.id && o.start_time<s.end_time && o.end_time>s.start_time);const actual=result.get(s.id)!;assert.equal(actual.count,others.length);assert.equal(actual.calendar_ids.length,Math.min(5,others.length));assert.ok(actual.calendar_ids.every(id=>others.some(o=>o.id===id)));}
});

test('Excel uses Vietnamese headers and values, row numbers, numeric hours and colored headers', async()=>{
 const {teachingReportWorkbook}=await import('../src/modules/teaching-reports/report-export');
 const XLSX=(await import('xlsx-js-style')).default;
 const sessions=['ended','upcoming','ongoing','cancelled'].map((progress,index)=>({id:100+index,calendar_id:100+index,teacher_profile_id:900,assistant_ids:[901],code:'QA',lesson_name:index===0?'=SUM(A1:A2)':'Bài học',subject:'Toán',grade:6,start_time:new Date('2026-11-01T19:00:00Z'),end_time:new Date('2026-11-01T20:30:00Z'),scheduled_seconds:5400,progress,teacher:'Cô QA',teacher_username:'gv-qa',assistant_teacher:'Thầy QB',issues:[],overlaps:[]}));
 (sessions[0].overlaps as any[]).push({person_id:900,name:'Cô QA',role:'teacher',count:1,calendar_ids:[101],calendars:[{id:101,code:'QB',start_time:sessions[1].start_time,end_time:sessions[1].end_time}]});
 const teachers=['teacher','assistant'].map((role,index)=>({id:'900:'+role,teacher_profile_id:900+index,username:role==='teacher'?'gv-qa':'tg-qa',name:role==='teacher'?'Cô QA':'Thầy QB',role,assigned:4,ended:1,upcoming:1,cancelled:1,scheduled_hours:4.5,ended_hours:1.5,overlapping_calendars:2,programs:1,subjects:1}));
 const metadata={from:'2026-11-01',to_exclusive:'2026-12-01',timezone:'Asia/Ho_Chi_Minh',generated_at:'2026-11-23T05:00:00Z',duration_basis:'calendar_schedule',hours_mode:'per_assignment',personnel_overlap:'sum_per_assignment',overlap_scope:'filtered_report',overlap_examples_limit:5};
 const data={sessions,teachers,metadata} as any;
 const book=XLSX.read(teachingReportWorkbook(data),{type:'buffer',cellStyles:true,cellNF:true});
 assert.deepEqual(book.SheetNames,['Theo nhân sự','Lịch giảng dạy','Thông tin báo cáo']);
 const staff=XLSX.utils.sheet_to_json<any>(book.Sheets['Theo nhân sự']);
 assert.deepEqual(staff.map(row=>row['Vai trò']),['Giáo viên','Trợ giảng']);
 assert.deepEqual(staff.map(row=>row.STT),[1,2]);assert.equal(staff[0]['Giờ lịch đã kết thúc'],1.5);
 const lessons=XLSX.utils.sheet_to_json<any>(book.Sheets['Lịch giảng dạy']);
 assert.deepEqual(lessons.map(row=>row['Tiến độ lịch']),['Đã kết thúc theo lịch','Chưa diễn ra','Đang diễn ra','Nghỉ học']);
 assert.equal(lessons[0]['Bắt đầu theo lịch'],'01/11/2026 19:00');
 assert.equal(lessons[0]['Thời lượng theo lịch (giờ)'],1.5);
 assert.ok(lessons[0]['Lịch trùng giờ'].includes('Lịch STT 2 · QB'));
 assert.ok(!lessons[0]['Lịch trùng giờ'].includes('teacher'));
 const info=XLSX.utils.sheet_to_json<any>(book.Sheets['Thông tin báo cáo'])[0];
 assert.equal(info['Cách tính giờ nhân sự'],'Cộng theo từng lịch phân công');assert.equal(info['Đến ngày'],'30/11/2026');
 for(const sheet of Object.values(book.Sheets)){
  const rows=XLSX.utils.sheet_to_json<any[]>(sheet,{header:1});
  assert.equal(rows[0][0],'STT');assert.ok(!rows[0].some(header=>/id|_|role|metadata/i.test(String(header))));
  assert.equal(sheet.A1.s.fgColor.rgb,'1677FF');assert.ok(sheet['!autofilter']);
 }
 const formulaCell=Object.values(book.Sheets['Lịch giảng dạy']).find((cell:any)=>cell.v==='=SUM(A1:A2)') as any;
 assert.equal(formulaCell.t,'s');assert.equal(formulaCell.f,undefined);
 const empty=XLSX.read(teachingReportWorkbook({...data,sessions:[],teachers:[],metadata:{...metadata,hours_mode:'union'}}),{type:'buffer'});
 assert.equal(empty.Sheets['Theo nhân sự'].A1.v,'STT');assert.equal(empty.Sheets['Lịch giảng dạy'].A1.v,'STT');
 assert.equal(XLSX.utils.sheet_to_json<any>(empty.Sheets['Thông tin báo cáo'])[0]['Cách tính giờ nhân sự'],'Gộp giờ trùng theo người và vai trò');
});
