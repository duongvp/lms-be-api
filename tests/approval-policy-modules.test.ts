import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModulePolicies,validateModulePolicies,resolveModuleApprovalPolicy,policyForAction} from '../src/modules/approval-policy/approval-policy.service';
import {APPROVAL_MODULES,type ApprovalModule} from '../src/modules/approval-policy/approval-policy.registry';
const modules:ApprovalModule[]=[
 {key:'calendar',label:'Lịch',managePermission:'calendar.workflow.manage',defaultPolicy:'REQUIRE',actions:[{key:'update',label:'Sửa'}]},
 {key:'questions',label:'Câu hỏi',managePermission:'questions.workflow.manage',defaultPolicy:'REQUIRE',actions:[{key:'update',label:'Sửa'}]},
];
test('registry exposes only modules with an implemented approval workflow',()=>{
 assert.deepEqual(APPROVAL_MODULES.map(m=>m.key),['calendar']);
 assert.throws(()=>validateModulePolicies({questions:{update:'SKIP'}}));
});
test('legacy flat calendar policies normalize without changing action values',()=>{
 assert.deepEqual(normalizeModulePolicies({update:'SKIP',create:'REQUIRE'}),{calendar:{update:'SKIP',create:'REQUIRE'}});
 assert.deepEqual(validateModulePolicies({calendar:{update:'SKIP'}}),{calendar:{update:'SKIP'}});
});
test('shared resolver isolates identical action names across registered modules',()=>{
 const roles=[{id:1,name:'Editor',approval_policy:{calendar:{update:'REQUIRE'},questions:{update:'SKIP'}}}];
 assert.equal(policyForAction('calendar','update',roles,{},modules),'REQUIRE');
 assert.equal(policyForAction('questions','update',roles,{},modules),'SKIP');
 const overrides={calendar:{update:'SKIP' as const}};
 assert.equal(policyForAction('calendar','update',roles,overrides,modules),'SKIP');
 assert.equal(policyForAction('questions','update',roles,overrides,modules),'SKIP');
 assert.throws(()=>policyForAction('questions','delete',roles,{},modules));
});
test('User overrides and REQUIRE aggregation are independent per module',()=>{
 const roles=[{id:1,name:'One',approval_policy:{calendar:{update:'SKIP'},questions:{update:'REQUIRE'}}},{id:2,name:'Two',approval_policy:{calendar:{update:'REQUIRE'},questions:{update:'SKIP'}}}];
 const result=resolveModuleApprovalPolicy(roles,{questions:{update:'SKIP'}},modules);
 assert.equal(result.module_effective_policy.calendar.update,'REQUIRE');
 assert.equal(result.module_effective_policy.questions.update,'SKIP');
 assert.equal(result.module_policy_sources.questions.update,'USER');
 assert.equal(resolveModuleApprovalPolicy(roles,{questions:{update:'INHERIT'}},modules).module_effective_policy.questions.update,'REQUIRE');
 assert.throws(()=>validateModulePolicies({calendar:{update:'INHERIT'}},false,modules));
});
