import test from 'node:test';
import assert from 'node:assert/strict';
import {allOperationsPolicy,resolveApprovalPolicy,validateApprovalPolicy} from '../src/modules/calendar-approvals/calendar-approval.policy';
import {OPERATIONS} from '../src/modules/calendar-approvals/calendar-approval.types';
const role=(id:number,policy:any)=>({id,name:'Role '+id,approval_policy:policy});
test('unconfigured operations and accounts default to REQUIRE',()=>{
 assert.equal(resolveApprovalPolicy([]).required_operations.length,OPERATIONS.length);
 assert.equal(resolveApprovalPolicy([role(1,{})]).effective_policy.update,'REQUIRE');
});
test('Role BTV requires each operation; User SKIP overrides only one operation',()=>{
 const policy=resolveApprovalPolicy([role(1,allOperationsPolicy('REQUIRE'))],{update:'SKIP'});
 assert.equal(policy.effective_policy.update,'SKIP');
 assert.equal(policy.inherited_policy.update,'REQUIRE');
 for(const operation of OPERATIONS.filter(op=>op!=='update'))assert.equal(policy.effective_policy[operation],'REQUIRE');
 assert.equal(policy.policy_sources.update,'USER');
});
test('User REQUIRE overrides Role SKIP, and INHERIT restores Role policy',()=>{
 const roles=[role(1,allOperationsPolicy('SKIP'))];
 assert.equal(resolveApprovalPolicy(roles,{update:'REQUIRE'}).effective_policy.update,'REQUIRE');
 assert.equal(resolveApprovalPolicy(roles,{update:'INHERIT'}).effective_policy.update,'SKIP');
 assert.equal(resolveApprovalPolicy(roles,{}).effective_policy.update,'SKIP');
});
test('multiple Roles aggregate REQUIRE independent of ordering; User override wins',()=>{
 const roles=[role(1,allOperationsPolicy('SKIP')),role(2,{...allOperationsPolicy('SKIP'),update:'REQUIRE'})];
 assert.equal(resolveApprovalPolicy(roles).effective_policy.update,'REQUIRE');
 assert.equal(resolveApprovalPolicy([...roles].reverse()).effective_policy.update,'REQUIRE');
 assert.equal(resolveApprovalPolicy(roles,{update:'SKIP'}).effective_policy.update,'SKIP');
});
test('Role and User payload validation rejects unknown operations and invalid policy values',()=>{
 assert.throws(()=>validateApprovalPolicy({update:'INHERIT'}));
 assert.throws(()=>validateApprovalPolicy({update:'ALLOW'},true));
 assert.throws(()=>validateApprovalPolicy({unknown:'SKIP'},true));
 assert.throws(()=>validateApprovalPolicy([]));
 assert.throws(()=>validateApprovalPolicy({update:['SKIP']},true));
 assert.deepEqual(validateApprovalPolicy({update:'INHERIT'},true),{update:'INHERIT'});
});
