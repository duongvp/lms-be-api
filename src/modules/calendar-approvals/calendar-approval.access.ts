import {APPROVAL_MODULES} from '../approval-policy/approval-policy.registry';
import {normalizeModulePolicies,resolveModuleApprovalPolicy,validateModulePolicies,type ModulePolicyMap} from '../approval-policy/approval-policy.service';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { resolveApprovalPolicy, validateApprovalPolicy, type UserPolicyMap } from './calendar-approval.policy';
import ApiError from '../../utils/ApiError';
import { assertProgramAccess, loadUserAccess, invalidateUserAccessCache } from '../../services/authorization.service';
import { PERMISSIONS, OPERATIONS, assertOperations, fingerprint, type ApprovalOperation, jsonValue, positiveId } from './calendar-approval.types';
export async function freshUser(userId: number) {
  invalidateUserAccessCache(userId);
  const { user, roles, permissionCodes, programScope } = await loadUserAccess(userId);
  return { userId, username: user.username, roles: roles.map(r => r.code), roleIds: roles.map(r => String(r.id)), permissions: permissionCodes, programScope };
}
export function hasPermission(user: any, permission: string) { return user?.permissions?.includes('*') || user?.permissions?.includes(permission) || user?.roles?.includes('admin'); }
export function requirePermission(user: any, permission: string) { if (!hasPermission(user,permission)) throw new ApiError(permission===PERMISSIONS.submit?'Tài khoản chưa có quyền gửi yêu cầu duyệt lịch. Vui lòng nhờ quản trị viên cấp quyền qua vai trò.':'Không có quyền thực hiện thao tác này',403); }
export const assertScope = (user: any, permission: string, codes: string[]) => {
  if (!codes.length) throw new ApiError('Không xác định được chương trình',422);
  codes.forEach(code => assertProgramAccess(user, permission, code));
};
export async function accountPolicy(userId: number, tx: any = prisma) {
  const [p, bindings] = await Promise.all([
    tx.calendar_approval_accounts.findUnique({where:{user_id:userId}}),
    tx.userRoles.findMany({where:{userId,role:{isActive:true}},include:{role:{include:{rolePermissions:{include:{permission:true}}}}}}),
  ]);
  const roles = bindings.map((binding:any) => binding.role);
  // Legacy rows remain interpretable during rolling migration; omitted operations were SKIP.
  const moduleOverrides=normalizeModulePolicies(p?.operation_overrides ?? (p ? Object.fromEntries(OPERATIONS.map(op=>[op,p.required_operations.includes(op)?'REQUIRE':'SKIP'])) : {}));
  const overrides=(moduleOverrides.calendar||{}) as UserPolicyMap;
  const moduleResolved=resolveModuleApprovalPolicy(roles,moduleOverrides);
  const resolved = resolveApprovalPolicy(roles, overrides);
  const permissions = roles.flatMap((r:any)=>r.rolePermissions?.map((rp:any)=>rp.permission.code)||[]);
  const canApprove = roles.some((r:any)=>r.code==='admin') || permissions.includes('*') || permissions.includes(PERMISSIONS.approve);
  const rolePolicy = roles.map((r:any)=>({id:String(r.id),name:r.name,approval_policy:normalizeModulePolicies(r.approval_policy)})).sort((a:any,b:any)=>a.id.localeCompare(b.id));
  return {user_id:userId,can_approve:Boolean(canApprove),approval_roles:roles.filter((r:any)=>r.code==='admin'||r.rolePermissions?.some((rp:any)=>['*',PERMISSIONS.approve].includes(rp.permission.code))).map((r:any)=>({id:String(r.id),name:r.name})),
    policy_modules:APPROVAL_MODULES,module_overrides:moduleOverrides,...moduleResolved,overrides,roles:rolePolicy,role_policy_hash:fingerprint(rolePolicy),...resolved,version:p?.version||0};
}
export async function getAccountConfiguration(userId:number) {
  const policy=await accountPolicy(userId);
  invalidateUserAccessCache(userId);
  const {programScope}=await loadUserAccess(userId);
  const programs=programScope.mode==='RESTRICTED' ? await prisma.scopeResources.findMany({where:{scopeType:'PROGRAM',scopeKey:{in:programScope.programs}},select:{scopeKey:true,displayName:true}}) : [];
  return {...policy,program_scope:programScope,program_names:programs.map(p=>({code:p.scopeKey,name:p.displayName||p.scopeKey}))};
}
export async function saveAccountPolicyInTransaction(actor:any,userId:number,input:any,tx:Prisma.TransactionClient) {
  positiveId(userId);
  if (!input||typeof input!=='object'||Array.isArray(input)) throw new ApiError('Cấu hình không hợp lệ',400);
  if ('can_approve' in input || 'approval_enabled' in input) throw new ApiError('Quyền phê duyệt được quản lý qua vai trò. Vui lòng thay đổi vai trò của tài khoản.',400);
  if (!Number.isInteger(input.version)) throw new ApiError('Cấu hình tài khoản không hợp lệ',400);
  const incomingModules:ModulePolicyMap = input.module_overrides !== undefined
    ? validateModulePolicies(input.module_overrides,true)
    : {calendar:input.overrides !== undefined ? validateApprovalPolicy(input.overrides,true)
      : Object.fromEntries(OPERATIONS.map(op=>[op,assertOperations(input.required_operations).includes(op)?'REQUIRE':'SKIP']))};
  for(const key of Object.keys(incomingModules)) requirePermission(actor,APPROVAL_MODULES.find(module=>module.key===key)!.managePermission);
  if(!Object.keys(incomingModules).length&&!APPROVAL_MODULES.some(module=>hasPermission(actor,module.managePermission))) throw new ApiError('Không có quyền cấu hình phê duyệt',403);
  await tx.$queryRaw`SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
  const users = await tx.$queryRaw<any[]>`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
  if (!users.length || !await tx.userRoles.findFirst({where:{userId,role:{isActive:true}}})) throw new ApiError('Không tìm thấy tài khoản quản trị có vai trò hoạt động',404);
  const before = await accountPolicy(userId,tx);
  if (input.role_policy_hash && input.role_policy_hash !== before.role_policy_hash) throw new ApiError('Quy định phê duyệt của vai trò vừa thay đổi. Vui lòng tải lại.',409);
  if (before.version !== input.version) throw new ApiError('Cấu hình vừa thay đổi. Vui lòng tải lại.',409);
  const moduleOverrides={...before.module_overrides,...incomingModules};
  const resolved = resolveApprovalPolicy(before.roles,moduleOverrides.calendar as UserPolicyMap||{});
  const operations = resolved.required_operations;
  const result = await tx.calendar_approval_accounts.upsert({where:{user_id:userId},create:{user_id:userId,required_operations:operations,operation_overrides:moduleOverrides,updated_by:actor.userId},update:{required_operations:operations,operation_overrides:moduleOverrides,version:{increment:1},updated_by:actor.userId}});
  await tx.calendar_approval_audit.create({data:{created_at:new Date(),actor_id:actor.userId,actor_name:actor.username,action:'account.configured',before_data:jsonValue(before),after_data:jsonValue(result),reason:'Cấu hình duyệt lịch theo tài khoản'}});
  return jsonValue(await accountPolicy(userId,tx));
}
export async function saveAccountPolicy(actor:any,userId:number,input:any) {
  await prisma.$transaction(tx=>saveAccountPolicyInTransaction(actor,userId,input,tx));
  invalidateUserAccessCache(userId);
  return getAccountConfiguration(userId);
}
export async function approvers(codes: string[], creatorId: number, tx: Prisma.TransactionClient | any = prisma) {
  const bindings = await tx.userRoles.findMany({
    where:{role:{isActive:true,OR:[{code:'admin'},{rolePermissions:{some:{permission:{code:PERMISSIONS.approve}}}}]}},
    select:{userId:true},
  });
  const accounts = [...new Set<number>(bindings.map((binding:any)=>binding.userId))].map(id=>({id}));
  const recipients: number[]=[];
  for(const p of accounts) {
    if (p.id===creatorId) continue;
    try {
      const user=await freshUser(p.id);
      assertScope(user,PERMISSIONS.review,codes); assertScope(user,PERMISSIONS.approve,codes);
      recipients.push(p.id);
    } catch { /* Missing/inactive roles and denied scope are not reviewers. */ }
  }
  return recipients;
}
