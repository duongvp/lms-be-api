import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {buildCalendarFile,buildCalendarUpdateFile,buildCalendarTemplate,buildOperationalCalendarWorkbook,CALENDAR_FILE_COLUMNS} from '../src/modules/livestream/livestream.io';
import {calendarSheetFormatting,workbookRequests} from '../src/integrations/google-sheet-write';
const row={code:'PROGRAM',subject:'Toán',key:'key',lesson_name:'Hàm số',learn_number:1,lesson_count:0,system_type:'topclass',live_date:'01/01/2099',weekday:'5',time_range:'20:00-21:00',lesson_status:0};

test('all Excel variants remain editable without sheet protection or floating notes',()=>{
 for(const buffer of [buildCalendarFile([row],'xlsx'),buildCalendarUpdateFile([row]),buildCalendarTemplate('xlsx'),buildOperationalCalendarWorkbook([row])]){
  const zip=XLSX.CFB.read(buffer,{type:'buffer'});
  for(let index=0;index<zip.FullPaths.length;index++){
   const path=zip.FullPaths[index];
   assert.equal(/comments|vmlDrawing/i.test(path),false);
   if(/\/xl\/worksheets\/sheet\d+\.xml$/.test(path)) assert.doesNotMatch(Buffer.from(zip.FileIndex[index].content).toString('utf8'),/<sheetProtection\b/);
  }
  const wb=XLSX.read(buffer,{type:'buffer'});
  const matrix=XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]],{header:1});
  assert.deepEqual(matrix[0],CALENDAR_FILE_COLUMNS.map(column=>column.header));
 }
});

test('Google export formatting adds no editing restrictions',()=>{
 const requests=calendarSheetFormatting(workbookRequests(buildOperationalCalendarWorkbook([row]),'test'));
 assert.equal(requests.some(request=>request.addProtectedRange||request.updateProtectedRange),false);
 assert.ok(requests.some(request=>request.updateBorders));
});
