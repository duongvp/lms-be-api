import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS,affectedOperations,commandOperation,fingerprint,positiveId,positiveBigId } from '../src/modules/calendar-approvals/calendar-approval.types';
import { normalizeCommand, changedFields } from '../src/modules/calendar-approvals/calendar-approval.plan';
import { assertScope, requirePermission } from '../src/modules/calendar-approvals/calendar-approval.access';
import prisma from '../src/lib/prisma';
import calendarPrisma,{inCalendarTransaction} from '../src/lib/calendar-transaction';
import {requireOfficialOperation,scheduleApprovalGate} from '../src/modules/calendar-approvals/calendar-approval.routes';

test('operation policy applies to bulk cancel/makeup, aliases and mapping changes',()=>{
 assert.equal(commandOperation({action:'updateBulk',payload:{operation:'cancel'}}),'cancel');
 assert.equal(commandOperation({action:'updateBulk',payload:{operation:'makeup'}}),'reschedule');
 assert.equal(commandOperation({action:'update',payload:{update_mode:'makeup'}}),'reschedule');
 assert.deepEqual(affectedOperations({action:'update',payload:{package_lesson_mappings:[]}}),['update','mapping']);
});
test('requests reject unsafe identities, forged fields and malformed create batches',()=>{
 assert.throws(()=>positiveId(0));assert.throws(()=>positiveBigId('-1'));assert.throws(()=>positiveBigId('1 OR 1=1'));
 assert.throws(()=>normalizeCommand({action:'create',payload:{deleted_at:'2026-01-01'}}),/Trường/);
 assert.throws(()=>normalizeCommand({action:'update',id:1,payload:{skip_teacher_user_sync:true}}),/Trường/);
 assert.throws(()=>normalizeCommand({action:'createBulk',payload:{calendars:[]}}));
 assert.throws(()=>normalizeCommand({action:'approve',payload:{}}));
 assert.equal(normalizeCommand({action:'update',id:2,payload:{update_mode:'following'}}).action,'reschedule');
 assert.equal(normalizeCommand({action:'update',id:2,payload:{update_mode:'current'}}).payload.update_mode,undefined);
 assert.equal(normalizeCommand({action:'create',payload:{code:'qa',reason:'request only'}}).payload.reason,undefined);
});
test('snapshot hashes detect changes within the same second; field diff ignores bookkeeping',()=>{
 assert.equal(fingerprint({b:1,a:{x:2}}),fingerprint({a:{x:2},b:1}));
 assert.notEqual(fingerprint({teacher:'A',updated_at:'same'}),fingerprint({teacher:'B',updated_at:'same'}));
 assert.deepEqual(changedFields({id:1,teacher:'A',updated_at:'old'},{id:1,teacher:'B',updated_at:'new'}),['teacher']);
});
test('role permissions and program scopes are both mandatory',()=>{
 const editor={permissions:['calendar.view','calendar.update'],roles:[],programScope:{mode:'RESTRICTED',programs:['allowed']}};
 assertScope(editor,'calendar.update',['allowed']);
 assert.throws(()=>assertScope(editor,'calendar.update',['allowed','other']));
 assert.throws(()=>requirePermission(editor,'calendar.approve'));
 assert.throws(()=>assertScope({...editor,programScope:{mode:'DENY'}},'calendar.update',['allowed']));
});
test('approve context reuses transaction including nested legacy transaction calls; isolated across async operations',async()=>{
 const tx:any={calendar:{findUnique:async()=>({id:42})}};
 const original=prisma.$transaction;let globalTransactions=0;
 (prisma as any).$transaction=async()=>{globalTransactions++;throw Error('must not open nested transaction');};
 try{
  await inCalendarTransaction(tx,async()=>{
    assert.equal((await calendarPrisma.calendar.findUnique({where:{id:42}}))?.id,42);
    assert.equal(await calendarPrisma.$transaction(async client=>(await client.calendar.findUnique({where:{id:42}}))?.id),42);
  });
  assert.equal(globalTransactions,0);
  await assert.rejects(calendarPrisma.$transaction(async()=>undefined),/must not/);
 }finally{prisma.$transaction=original;}
});
test('backend gate blocks legacy clients and import/operational bypasses for configured accounts',async()=>{
 const delegate=prisma.calendar_approval_accounts as any,original=delegate.findUnique;
 const originalRoles=prisma.userRoles.findMany;
 (prisma.userRoles as any).findMany=async()=>[{role:{id:1,name:'Existing role',approval_policy:{update:'SKIP'},rolePermissions:[]}}];
 delegate.findUnique=async()=>({can_approve:false,required_operations:['update','import'],version:1});
 const req:any={user:{userId:7},body:{},params:{id:'9'},header:()=>undefined};let status=0,body:any,next=0;
 const res:any={locals:{},status(code:number){status=code;return this;},json(value:any){body=value;return this;}};
 try{
  await new Promise<void>((resolve,reject)=>{res.json=(v:any)=>{body=v;resolve();return res;};scheduleApprovalGate('update')(req,res,(e?:any)=>e?reject(e):(next++,resolve()));});
  assert.equal(status,409);assert.equal(body.code,'APPROVAL_REQUIRED');assert.equal(next,0);
  await new Promise<void>((resolve,reject)=>{res.json=(v:any)=>{body=v;resolve();return res;};requireOfficialOperation(['import'])(req,res,(e?:any)=>e?reject(e):(next++,resolve()));});
  assert.equal(status,409);assert.equal(next,0);
  delegate.findUnique=async()=>null;
  await new Promise<void>((resolve,reject)=>{scheduleApprovalGate('update')(req,res,(e?:any)=>e?reject(e):(next++,resolve()));});
  assert.equal(next,1);
 }finally{delegate.findUnique=original;prisma.userRoles.findMany=originalRoles;}
});


test('approval reason header validates permission, UTF-8, blank and oversized input',async()=>{
 const {approvalSubmissionReason}=await import('../src/modules/calendar-approvals/calendar-approval.reason');
 let raw:string|undefined,status=0,body:any;
 const req:any={user:{permissions:[PERMISSIONS.submit],roles:[]},header:()=>raw};
 const res:any={status:(code:number)=>{status=code;return res;},json:(value:any)=>{body=value;return res;}};
 assert.equal(approvalSubmissionReason(req,res),undefined);assert.equal(status,409);assert.equal(body.code,'APPROVAL_REASON_REQUIRED');
 raw=encodeURIComponent('  Thay đổi theo kế hoạch mới  ');assert.equal(approvalSubmissionReason(req,res),'Thay đổi theo kế hoạch mới');
 for(const invalid of ['   ','x'.repeat(1001)]){raw=encodeURIComponent(invalid);assert.throws(()=>approvalSubmissionReason(req,res),/1 đến 1000/);}
 raw='%E0%A4';assert.throws(()=>approvalSubmissionReason(req,res),/không hợp lệ/);
 raw=encodeURIComponent('x'.repeat(1000));assert.equal(approvalSubmissionReason(req,res)?.length,1000);
 req.user.permissions=[];assert.throws(()=>approvalSubmissionReason(req,res),/quyền/);
});


test('approval titles are separate metadata, bounded and Unicode safe',async()=>{
 const {approvalTitle,approvalSubmissionTitle}=await import('../src/modules/calendar-approvals/calendar-approval.reason');
 assert.equal(approvalTitle(undefined),null);assert.equal(approvalTitle(null),null);
 assert.equal(approvalTitle('  Ôn tập bổ sung  '),'Ôn tập bổ sung');
 for(const value of ['', '   ', 'x'.repeat(256), {}, 12])assert.throws(()=>approvalTitle(value),/tiêu đề/);
 assert.equal(approvalTitle('x'.repeat(255))?.length,255);
 assert.equal(approvalSubmissionTitle({header:()=>encodeURIComponent('Ôn tập bổ sung')} as any),'Ôn tập bổ sung');
 assert.throws(()=>approvalSubmissionTitle({header:()=>'%E0%A4'} as any),/không hợp lệ/);
});
