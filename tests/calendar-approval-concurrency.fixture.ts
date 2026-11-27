import assert from 'node:assert/strict';
import {freshUser} from '../src/modules/calendar-approvals/calendar-approval.access';
import {approvals} from '../src/modules/calendar-approvals/calendar-approval.service';

export async function verifyConcurrentApprovalDecisions(prisma:any,creatorId:number) {
 const roles=await prisma.roles.findMany({where:{code:{in:['qa_reviewer','schedule_approver']}}});
 const people=[];
 for(const suffix of ['one','two'])people.push(await prisma.users.create({data:{username:'qa-decision-'+suffix,name:'Decision '+suffix,code:'qa-decision-'+suffix,userRoles:{create:roles.map((role:any)=>({roleId:role.id}))},programScopePolicy:{create:{mode:'ALL'}}}}));
 const reviewers=await Promise.all(people.map(person=>freshUser(person.id)));
 const creator=await freshUser(creatorId);
 const checks=[];
 for(const [index,actions] of [['approve','reject'],['reject','approve']].entries()) {
  const code='qa-decision-'+index;
  const lesson=await prisma.lessons.create({data:{subject_code:code,subject_name:'QA',learn_number:1,lesson_name:'Original race'}});
  const calendar=await prisma.calendar.create({data:{code,session_id:lesson.id,learn_number:1,lesson_name:'Original race',key:code,start_time:new Date('2035-09-01T18:00:00Z'),end_time:new Date('2035-09-01T19:00:00Z')}});
  const request:any=await approvals.create(creator,{command:{action:'update',id:calendar.id,payload:{lesson_name:'Winner race'}},reason:'Concurrent decision',submit:true});
  const input={revision:request.revision,lock_version:request.lock_version,reason:'Checked by reviewer'};
  const results=await Promise.allSettled(actions.map((action,i)=>approvals.transition(reviewers[i],BigInt(request.id),action,input)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1,'exactly one of approve/reject wins');
  const winner=results.findIndex(result=>result.status==='fulfilled');
  const loser=results[1-winner] as PromiseRejectedResult;
  assert.equal(loser.reason.statusCode,409);
  assert.match(loser.reason.message,/được duyệt bởi|bị từ chối bởi/);
  const final=await prisma.calendar_approval_requests.findUniqueOrThrow({where:{id:BigInt(request.id)}});
  assert.equal(final.status,actions[winner]==='approve'?'APPROVED':'REJECTED');assert.equal(final.decided_by,people[winner].id);
  assert.equal(await prisma.calendar_approval_audit.count({where:{request_id:final.id,action:{in:['request.approved','request.rejected']}}}),1);
  assert.equal(await prisma.calendar_approval_audit.count({where:{request_id:final.id,action:'calendar.applied'}}),final.status==='APPROVED'?1:0);
  assert.equal((await prisma.calendar.findUniqueOrThrow({where:{id:calendar.id}})).lesson_name,final.status==='APPROVED'?'Winner race':'Original race');
  for(const reviewer of reviewers) {
   const detail:any=await approvals.detail(reviewer,final.id);
   assert.equal(detail.capabilities.approve,false);assert.equal(detail.capabilities.reject,false);
   assert.equal(detail.decider_name,people[winner].username);assert.ok(detail.decided_at);
  }
  if(final.status==='APPROVED') {
   const duplicate:any=await approvals.transition(reviewers[1-winner],final.id,'approve',input);
   assert.equal(duplicate.decided_by,people[winner].id);assert.equal(duplicate.decider_name,people[winner].username);
  }
  checks.push('concurrent '+actions.join('/')+' records one decision, hides both actions and exposes the winning reviewer');
 }
 return checks;
}
