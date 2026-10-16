import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarSourceFromCode} from '../src/modules/livestream/calendar-source';
import {validateLessonProgramPayload} from '../src/modules/lessons/lesson.validation';
const program={system_type:'topclass',grade:8,subject_name:'Ngữ văn',subject_code:'nguvan-8-2027'};
test('program source only prefixes its code and is never persisted as a field',()=>{
 const live=validateLessonProgramPayload(program);
 const feed=validateLessonProgramPayload({...program,calendar_source:'feed'});
 assert.equal(live.subject_code,'nguvan-8-2027');assert.equal(feed.subject_code,'feed-nguvan-8-2027');
 assert.equal(Object.hasOwn(feed,'calendar_source'),false);
 assert.equal(validateLessonProgramPayload({...program,calendar_source:'feed',subject_code:feed.subject_code}).subject_code,feed.subject_code);
 assert.equal(validateLessonProgramPayload({...program,system_type:'topuni',grade:12,subject_code:'tongontoantsav2027',calendar_source:'feed'}).subject_code,'feed-tongontoantsav2027');
 assert.equal(calendarSourceFromCode(feed.subject_code),'feed');
});
test('contradictory or invalid program source is rejected',()=>{
 assert.throws(()=>validateLessonProgramPayload({...program,subject_code:'feed-nguvan-8-2027',calendar_source:'livestream'}),/feed-/);
 assert.throws(()=>validateLessonProgramPayload({...program,subject_code:'a'.repeat(26),calendar_source:'feed'}),/30 ký tự/);
 for(const calendar_source of ['bad',null,'']) assert.throws(()=>validateLessonProgramPayload({...program,calendar_source}),/calendar_source/);
});
