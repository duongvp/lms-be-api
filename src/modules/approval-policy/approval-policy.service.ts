import ApiError from '../../utils/ApiError';
import {APPROVAL_MODULES, type ApprovalModule} from './approval-policy.registry';
export type PolicyValue = 'REQUIRE' | 'SKIP';
export type UserPolicyValue = PolicyValue | 'INHERIT';
export type ModulePolicyMap = Record<string, Record<string, UserPolicyValue>>;
type Role = {id: string | number | bigint; name: string; approval_policy?: unknown};
const object = (value:unknown):value is Record<string,unknown> => Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

// The only legacy adapter: old flat action maps belonged to the calendar module.
// New policy storage and APIs always namespace actions under their module key.
export function normalizeModulePolicies(value: unknown): ModulePolicyMap {
  if (!object(value)) return {};
  if (Object.values(value).some(v=>typeof v==='string')) return {calendar:{...value}} as ModulePolicyMap;
  return Object.fromEntries(Object.entries(value).map(([key,actions])=>[key,object(actions)?{...actions}:actions])) as ModulePolicyMap;
}
export function validateModulePolicies(value: unknown, userOverride=false, modules:readonly ApprovalModule[]=APPROVAL_MODULES):ModulePolicyMap {
  if (!object(value)) throw new ApiError('Chính sách phê duyệt không hợp lệ',400);
  const normalized=normalizeModulePolicies(value), allowed=userOverride?['REQUIRE','SKIP','INHERIT']:['REQUIRE','SKIP'];
  for(const [key,actions] of Object.entries(normalized)) {
    const module=modules.find(m=>m.key===key);
    if(!module||!object(actions)) throw new ApiError('Chức năng này chưa hỗ trợ cấu hình phê duyệt',400);
    for(const [action,policy] of Object.entries(actions)) {
      if(!module.actions.some(a=>a.key===action)||typeof policy!=='string'||!allowed.includes(policy)) throw new ApiError('Thao tác hoặc giá trị chính sách phê duyệt không hợp lệ',400);
    }
  }
  return normalized;
}
export function resolveModuleApprovalPolicy(roles:Role[], overrides:ModulePolicyMap={}, modules:readonly ApprovalModule[]=APPROVAL_MODULES) {
  const inherited:ModulePolicyMap={},effective:ModulePolicyMap={},sources:Record<string,Record<string,'USER'|'ROLE'|'DEFAULT'>>={};
  const rolePolicies=roles.map(role=>normalizeModulePolicies(role.approval_policy));
  for(const module of modules) {
    inherited[module.key]={};effective[module.key]={};sources[module.key]={};
    for(const {key:action} of module.actions) {
      const inheritedValue=rolePolicies.length
        ? rolePolicies.some(policy=>{const value=policy[module.key]?.[action];return (value==='REQUIRE'||value==='SKIP'?value:module.defaultPolicy)==='REQUIRE';})?'REQUIRE':'SKIP'
        : module.defaultPolicy;
      const override=overrides[module.key]?.[action];
      inherited[module.key][action]=inheritedValue;
      effective[module.key][action]=override==='REQUIRE'||override==='SKIP'?override:inheritedValue;
      sources[module.key][action]=override==='REQUIRE'||override==='SKIP'?'USER':roles.length?'ROLE':'DEFAULT';
    }
  }
  return {module_inherited_policy:inherited,module_effective_policy:effective,module_policy_sources:sources};
}
export function policyForAction(moduleKey:string,action:string,roles:Role[],overrides:ModulePolicyMap={},modules:readonly ApprovalModule[]=APPROVAL_MODULES):PolicyValue {
  const module=modules.find(m=>m.key===moduleKey);
  if(!module?.actions.some(a=>a.key===action)) throw new ApiError('Chức năng hoặc thao tác chưa hỗ trợ phê duyệt',422);
  return resolveModuleApprovalPolicy(roles,overrides,modules).module_effective_policy[moduleKey][action] as PolicyValue;
}
