import {PERMISSIONS} from '../../src/modules/calendar-approvals/calendar-approval.types';
import {allOperationsPolicy} from '../../src/modules/calendar-approvals/calendar-approval.policy';
const labels:Record<string,string>={submit:'Gửi yêu cầu duyệt lịch',approve:'Phê duyệt lịch',reject:'Từ chối yêu cầu lịch',review:'Xem yêu cầu duyệt lịch',history:'Xem lịch sử duyệt lịch',manage:'Cấu hình duyệt lịch theo tài khoản'};
/** One-time compatibility conversion; cleared flags must never restore revoked roles. */
export async function syncCalendarApprovalRbac(prisma:any) {
 return prisma.$transaction(async(tx:any)=>{
  await tx.$queryRaw`SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
  for(const [key,code] of Object.entries(PERMISSIONS)) await tx.permissions.upsert({where:{code},create:{code,name:labels[key]},update:{name:labels[key]}});
  const role=await tx.roles.upsert({where:{code:'schedule_approver'},create:{code:'schedule_approver',name:'Người duyệt lịch',isActive:true,approval_policy:{calendar:allOperationsPolicy('SKIP')},fieldPolicy:{modules:{calendar:{fields:{'*':{visible:true,editable:false}}}}}},update:{}});
  const codes=['calendar.view',PERMISSIONS.review,PERMISSIONS.approve,PERMISSIONS.reject,PERMISSIONS.history];
  const permissions=await tx.permissions.findMany({where:{code:{in:codes}}});
  if(permissions.length!==codes.length) throw new Error('Thiếu quyền xem lịch học trong hệ thống phân quyền');
  for(const permission of permissions) await tx.rolePermissions.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},create:{roleId:role.id,permissionId:permission.id},update:{}});
  // Provision an assignable role template without assigning it from account policies.
  const submitter=await tx.roles.upsert({where:{code:'schedule_submitter'},create:{code:'schedule_submitter',name:'Người gửi duyệt lịch',isActive:true,approval_policy:{calendar:allOperationsPolicy('SKIP')}},update:{}});
  const submitPermission=await tx.permissions.findUniqueOrThrow({where:{code:PERMISSIONS.submit}});
  await tx.rolePermissions.upsert({where:{roleId_permissionId:{roleId:submitter.id,permissionId:submitPermission.id}},create:{roleId:submitter.id,permissionId:submitPermission.id},update:{}});
  const legacy=await tx.calendar_approval_accounts.findMany({where:{can_approve:true},select:{user_id:true}});
  for(const account of legacy) await tx.userRoles.upsert({where:{userId_roleId:{userId:account.user_id,roleId:role.id}},create:{userId:account.user_id,roleId:role.id},update:{}});
  await tx.calendar_approval_accounts.updateMany({where:{can_approve:true},data:{can_approve:false}});
  return {convertedAccounts:legacy.length};
 });
}
