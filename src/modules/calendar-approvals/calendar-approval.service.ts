import {approvalTitle} from './calendar-approval.reason';
import { applyApprovedCalendarImport } from '../livestream/calendar-import.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { inCalendarTransaction, currentCalendarTransaction, setCalendarWriteObserver } from '../../lib/calendar-transaction';
import ApiError from '../../utils/ApiError';
import FieldPermissionService from '../roles/field-permission.service';
import * as calendars from '../livestream/livestream.service';
import { freshUser, requirePermission, hasPermission, accountPolicy, approvers, assertScope } from './calendar-approval.access';
import { buildPlan, dependencies, changedFields } from './calendar-approval.plan';
import { PERMISSIONS, type Command, fingerprint, jsonValue, operationPermission } from './calendar-approval.types';

type User = Awaited<ReturnType<typeof freshUser>>;
export async function approvalTransaction<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> {
  return prisma.$transaction(async tx=>{
    const lock=await tx.$queryRaw<any[]>`SELECT id FROM calendar_approval_mutex WHERE id=1 FOR UPDATE`;
    if(lock.length!==1) throw new ApiError("Thiếu khóa giao dịch lịch. Kiểm tra migration workflow.",503);
    return inCalendarTransaction(tx,()=>work(tx));
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:15_000,timeout:180_000});
}
async function lockRequest(tx:any,id:bigint) {
  const rows=await tx.$queryRaw<any[]>`SELECT id FROM calendar_approval_requests WHERE id=${id} FOR UPDATE`;
  if(!rows.length) throw new ApiError('Không tìm thấy yêu cầu',404);
  return tx.calendar_approval_requests.findUniqueOrThrow({where:{id}});
}
export function viewWhere(user:any, mine=false):Prisma.Sql {
  requirePermission(user,'calendar.view');
  const scope=user.programScope;
  const scopeSql=hasPermission(user,'*')||user.roles?.includes('admin')||scope?.mode==='ALL'?Prisma.sql`1=1`:scope?.mode==='RESTRICTED'?Prisma.sql`JSON_CONTAINS(${JSON.stringify(scope.programs)}, program_codes)`:Prisma.sql`1=0`;
  return Prisma.sql`${scopeSql} AND ${mine||!hasPermission(user,PERMISSIONS.review)?Prisma.sql`created_by=${user.userId}`:Prisma.sql`(status <> 'DRAFT' OR created_by=${user.userId})`}`;
}
async function canView(user:User,record:any) {
  assertScope(user,'calendar.view',record.program_codes as string[]);
  if(record.created_by!==user.userId) { requirePermission(user,PERMISSIONS.review); if(record.status==='DRAFT') throw new ApiError(record.revision>1?'Yêu cầu đang được thu hồi để chỉnh sửa. Phiên bản cũ không còn chờ duyệt.':'Bản nháp chỉ dành cho người tạo',record.revision>1?409:403); }
}
async function decisionActorName(r:any) {
  if(!r.decided_by)return null;
  const db=currentCalendarTransaction()||prisma;
  const decision=await db.calendar_approval_audit.findFirst({where:{request_id:r.id,revision:r.revision,actor_id:r.decided_by,action:r.status==='APPROVED'?'request.approved':'request.rejected'},orderBy:{id:'desc'},select:{actor_name:true}});
  if(decision)return decision.actor_name;
  const actor=await db.users.findUnique({where:{id:r.decided_by},select:{username:true}});
  return actor?.username||`Tài khoản #${r.decided_by}`;
}
async function present(user:User,r:any,policy?:Awaited<ReturnType<typeof accountPolicy>>) {
  const before=r.before_data as any[],after=r.proposed_data as any[];
  const project=async(rows:any[])=>{
    const filtered=await FieldPermissionService.filterVisibleRecords(user.roleIds,'calendar',rows.map(row=>row||{}));
    // Lesson identity is technical metadata, like the calendar ID, needed to resolve the outline.
    return rows.map((row,i)=>row?{...filtered[i],id:row.id??null,session_id:row.session_id??null}:null);
  };
  const b=await project(before),a=await project(after);
  policy=policy||await accountPolicy(user.userId);
  const canReview=r.status==='PENDING'&&r.created_by!==user.userId&&policy.can_approve;
  const cancellation=r.status==='CANCELLED'?await (currentCalendarTransaction()||prisma).calendar_approval_audit.findFirst({where:{request_id:r.id,revision:r.revision,action:'request.cancelled'},orderBy:{id:'desc'},select:{created_at:true}}):null;
  const result={...jsonValue(r),cancelled_at:cancellation?.created_at?.toISOString()||null,decider_name:await decisionActorName(r),command:undefined,base_hash:undefined,idempotency_key:undefined,input_hash:undefined,before_data:b,proposed_data:a,editable_action:r.created_by===user.userId?(r.command as any).action:undefined,
    // Applied results can contain full legacy records; expose only safe IDs.
    result_data:r.result_data?{calendar_ids:(r.result_data as any).calendar_ids||[]}:null,
    changes:[...b.map(old=>{const next=a.find(row=>row?.id!=null&&String(row.id)===String(old?.id))||null;return {before:old,after:next,fields:changedFields(old,next)};}),...a.filter(row=>row&&(!row.id||!b.some(old=>old?.id!=null&&String(old.id)===String(row.id)))).map(row=>({before:null,after:row,fields:changedFields(null,row)}))],
    capabilities:{withdraw:r.created_by===user.userId&&r.status==='PENDING'&&hasPermission(user,PERMISSIONS.submit),approve:canReview&&hasPermission(user,PERMISSIONS.approve),reject:canReview&&hasPermission(user,PERMISSIONS.reject),edit:r.created_by===user.userId&&['DRAFT','REJECTED','CONFLICTED'].includes(r.status),submit:r.created_by===user.userId&&r.status==='DRAFT'&&hasPermission(user,PERMISSIONS.submit),cancel:r.created_by===user.userId&&['DRAFT','PENDING'].includes(r.status)}};
  return result;
}
async function audit(tx:any,user:User,r:any,action:string,before:any,after:any,reason:string) {
  await tx.calendar_approval_audit.create({data:{created_at:new Date(),request_id:r.id,revision:r.revision,actor_id:user.userId,actor_name:user.username,action,before_data:jsonValue(before),after_data:jsonValue(after),reason}});
}
async function notify(tx:any,r:any,eventType:string,recipients:number[]) {
  const event=randomUUID();
  if(recipients.length) await tx.calendar_approval_notifications.createMany({data:[...new Set(recipients)].map(recipient_id=>({event_id:event,request_id:r.id,recipient_id,event_type:eventType,created_at:new Date()})),skipDuplicates:true});
}
async function submit(tx:any,user:User,r:any,submissionReason?:unknown,submissionTitle?:unknown) {
  requirePermission(user,PERMISSIONS.submit);
  if(r.created_by!==user.userId||r.status!=='DRAFT') throw new ApiError('Chỉ người tạo được gửi bản nháp',409);
  const reason=String(submissionReason??r.reason).trim();
  if(!reason||reason.length>1000)throw new ApiError('Vui lòng nhập lý do gửi duyệt từ 1 đến 1000 ký tự.',422);
  const title=approvalTitle(submissionTitle===undefined?r.title:submissionTitle);
  const plan=await buildPlan(tx,user,r.command);
  const recipients=await approvers(plan.codes,user.userId,tx);
  if(!recipients.length) throw new ApiError('Chưa có tài khoản được phép duyệt toàn bộ chương trình trong yêu cầu. Nhờ quản trị viên cấu hình người duyệt.',422);
  const effective=await accountPolicy(user.userId,tx);
  const policySnapshot=jsonValue({module_effective_policy:effective.module_effective_policy,module_overrides:effective.module_overrides,effective_policy:effective.effective_policy,overrides:effective.overrides,roles:effective.roles,version:effective.version});
  const updated=await tx.calendar_approval_requests.update({where:{id:r.id},data:{title,reason,approval_policy_snapshot:policySnapshot,status:'PENDING',command:jsonValue(plan.command),before_data:plan.before,proposed_data:plan.proposed,base_hash:plan.hash,program_codes:plan.codes,submitted_at:new Date(),lock_version:{increment:1}}});
  await tx.calendar_approval_revisions.create({data:{request_id:r.id,revision:r.revision,command:jsonValue(plan.command),before_data:plan.before,proposed_data:plan.proposed,base_hash:plan.hash,program_codes:plan.codes,title,reason,submitted_by:user.userId,approval_policy_snapshot:policySnapshot,submitted_at:new Date()}});
  await audit(tx,user,r,r.revision>1?'request.resubmitted':'request.submitted',{status:r.status},{status:'PENDING'},reason);
  await notify(tx,r,r.revision>1?'request.resubmitted':'request.submitted',recipients);
  return updated;
}
export const approvals = {
  async capabilities(user:any) {
    const fresh=await freshUser(user.userId); const account=await accountPolicy(user.userId);
    return {...account,can_request:['calendar.create','calendar.update','calendar.delete'].some(p=>hasPermission(fresh,p)),can_submit:hasPermission(fresh,PERMISSIONS.submit),can_manage:hasPermission(fresh,PERMISSIONS.manage),can_review:hasPermission(fresh,PERMISSIONS.review)};
  },
  async create(user:any,input:any,key?:string,trustedImport=false) {
    user=await freshUser(user.userId);
    if(!input||typeof input!=='object'||!input.command||typeof input.command!=='object') throw new ApiError('Thiếu nội dung yêu cầu',422);
    if(input.command?.action==='import'&&!trustedImport) throw new ApiError('Yêu cầu import phải được tạo từ file đã kiểm tra trên server',422);
    const reason=String(input.reason||input.command?.payload?.reason||'').trim();
    if(reason.length>1000||(!reason&&input.command?.action!=='create'&&input.command?.action!=='createBulk'&&input.command?.action!=='auto')) throw new ApiError('Vui lòng nhập lý do thay đổi (tối đa 1000 ký tự)',422);
    if(key&&(!/^[\w-]{8,100}$/.test(key))) throw new ApiError('Idempotency-Key không hợp lệ',400);
    const title=approvalTitle(input.title);
    const inputHash=fingerprint({command:input.command,reason,...(title?{title}:{}),submit:input.submit===true});
    return approvalTransaction(async tx=>{
      user=await freshUser(user.userId);
      if(key) {
        const existing=await tx.calendar_approval_requests.findUnique({where:{created_by_idempotency_key:{created_by:user.userId,idempotency_key:key}}});
        if(existing) {
          if(existing.input_hash!==inputHash) throw new ApiError('Idempotency-Key đã được dùng cho nội dung khác',409);
          return present(user,existing);
        }
      }
      const command=jsonValue(input.command);
      const plan=await buildPlan(tx,user,command);
      const policy = await accountPolicy(user.userId,tx);
      let r=await tx.calendar_approval_requests.create({data:{approval_policy_snapshot:jsonValue({module_effective_policy:policy.module_effective_policy,module_overrides:policy.module_overrides,effective_policy:policy.effective_policy,overrides:policy.overrides,roles:policy.roles,version:policy.version}),created_at:new Date(),public_id:randomUUID(),created_by:user.userId,creator_name:user.username,operation:plan.operation,command:jsonValue(plan.command),program_codes:plan.codes,before_data:plan.before,proposed_data:plan.proposed,base_hash:plan.hash,title,reason,idempotency_key:key||null,input_hash:inputHash}});
      await audit(tx,user,r,'request.created',{}, {status:'DRAFT'},reason);
      if(input.submit===true) r=await submit(tx,user,r);
      return present(user,r);
    });
  },
  async list(user:any,query:any) {
    user=await freshUser(user.userId);
    const page=Math.max(1,Number(query.page||1)),limit=Math.min(100,Math.max(1,Number(query.limit||20)));
    if(!Number.isSafeInteger(page)||!Number.isSafeInteger(limit)) throw new ApiError('Phân trang không hợp lệ',400);
    let where=viewWhere(user,query.mine==='true');
    if(query.status) {if(!['DRAFT','PENDING','APPROVED','REJECTED','CANCELLED','CONFLICTED','DIRECT_APPLIED'].includes(query.status)) throw new ApiError('Trạng thái không hợp lệ',400); where=Prisma.sql`${where} AND status=${query.status}`;}
    if(query.program) where=Prisma.sql`${where} AND JSON_CONTAINS(program_codes,${JSON.stringify(String(query.program))})`;
    const rows=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT id FROM calendar_approval_requests WHERE ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
    const totals=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) AS total FROM calendar_approval_requests WHERE ${where}`);
    const records=rows.length?await prisma.calendar_approval_requests.findMany({where:{id:{in:rows.map(r=>r.id)}},orderBy:{id:'desc'}}):[];
    const policy=await accountPolicy(user.userId);
    return {rows:await Promise.all(records.map(r=>present(user,r,policy))),total:Number(totals[0].total),page,limit};
  },
  async detail(user:any,id:bigint) {
    user=await freshUser(user.userId);
    const r=await prisma.calendar_approval_requests.findUnique({where:{id}});
    if(!r) throw new ApiError('Không tìm thấy yêu cầu',404);
    await canView(user,r);
    const result=await present(user,r);
    if(r.status==='PENDING') {
      const current=await dependencies(prisma,r.program_codes as string[]);
      return {...result,base_changed:fingerprint(current)!==r.base_hash};
    }
    return result;
  },
  async edit(user:any,id:bigint,input:any) {
    user=await freshUser(user.userId);
    return approvalTransaction(async tx=>{
      user=await freshUser(user.userId);
      const r=await lockRequest(tx,id); await canView(user,r);
      if(r.created_by!==user.userId||!['DRAFT','REJECTED','CONFLICTED'].includes(r.status)||input.lock_version!==r.lock_version) throw new ApiError('Yêu cầu đã thay đổi hoặc không thể chỉnh sửa',409);
      if(input.command?.action==='import') throw new ApiError('Không sửa payload import. Hãy nhập lại file để kiểm tra.',422);
      let command=input.command||r.command;
      if(input.edit_patch) {
        command=jsonValue(r.command);
        if(!['create','update','cancel','reschedule'].includes(command.action)) throw new ApiError('Yêu cầu hàng loạt/import cần chỉnh sửa bằng công cụ tương ứng rồi gửi lại.',422);
        if(command.action==='reschedule') command.payload.new_session={...command.payload.new_session,...input.edit_patch};
        else command.payload={...command.payload,...input.edit_patch};
      }
      const reason=String(input.reason??r.reason).trim(); if(!reason||reason.length>1000) throw new ApiError('Vui lòng nhập lý do hợp lệ',422);
      command=jsonValue(command);
      const plan=await buildPlan(tx,user,command);
      const next=await tx.calendar_approval_requests.update({where:{id},data:{status:'DRAFT',revision:r.status==='DRAFT'?r.revision:r.revision+1,lock_version:{increment:1},command:jsonValue(plan.command),before_data:plan.before,proposed_data:plan.proposed,base_hash:plan.hash,program_codes:plan.codes,reason,decision_reason:null,decided_by:null,decided_at:null}});
      await audit(tx,user,next,'request.edited',{status:r.status},{status:'DRAFT'},reason); return present(user,next);
    });
  },
  async transition(user:any,id:bigint,action:string,input:any) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new ApiError('Thiếu phiên bản yêu cầu',422);
    const sessionId=user.sessionId;
    user=await freshUser(user.userId);
    const result=await approvalTransaction(async tx=>{
      if(sessionId) {
        const session=await tx.auth_sessions.findUnique({where:{id:sessionId}});
        if(!session||session.revoked_at||session.expires_at<=new Date()||session.user_id!==user.userId) throw new ApiError('Phiên đăng nhập không còn hợp lệ',401);
      }
      user=await freshUser(user.userId);
      const r=await lockRequest(tx,id); await canView(user,r);
      if(action==='approve'&&r.status==='APPROVED'&&r.revision===input.revision) return {record:await present(user,r)};
      if(['approve','reject'].includes(action)&&r.status!=='PENDING') {
        const who=await decisionActorName(r);
        const message=r.status==='APPROVED'?`Yêu cầu đã được duyệt bởi ${who}.`:r.status==='REJECTED'?`Yêu cầu đã bị từ chối bởi ${who}.`:'Yêu cầu không còn chờ duyệt.';
        throw new ApiError(message,409);
      }
      if(action==='withdraw') {
        if(r.created_by!==user.userId) throw new ApiError('Chỉ người gửi được thu hồi yêu cầu để chỉnh sửa.',403);
        requirePermission(user,PERMISSIONS.submit);
        if(r.status!=='PENDING') throw new ApiError('Chỉ có thể thu hồi yêu cầu đang chờ duyệt. Yêu cầu có thể đã được xử lý; vui lòng tải lại.',409);
      }
      if(input.lock_version!==r.lock_version||input.revision!==r.revision) throw new ApiError('Yêu cầu vừa thay đổi. Vui lòng mở lại chi tiết.',409);
      if(action==='withdraw') {
        // Notify everyone who previously received this request, including reviewers
        // whose assignment changed while their old detail/confirmation stayed open.
        const previous=await tx.calendar_approval_notifications.findMany({where:{request_id:id,recipient_id:{not:r.created_by}},select:{recipient_id:true}});
        const recipients=[...previous.map(n=>n.recipient_id),...await approvers(r.program_codes as string[],r.created_by,tx)];
        const next=await tx.calendar_approval_requests.update({where:{id},data:{status:'DRAFT',revision:{increment:1},lock_version:{increment:1},submitted_at:null,decision_reason:null,decided_by:null,decided_at:null}});
        await audit(tx,user,r,'request.withdrawn',{status:'PENDING',revision:r.revision},{status:'DRAFT',revision:next.revision},'Thu hồi để chỉnh sửa');
        await notify(tx,r,'request.withdrawn',recipients);
        return {record:await present(user,next)};
      }

      if(action==='submit') return {record:await present(user,await submit(tx,user,r,input.reason,input.title))};
      if(action==='cancel') {
        if(r.created_by!==user.userId||!['DRAFT','PENDING'].includes(r.status)) throw new ApiError('Không thể hủy yêu cầu này',409);
        const next=await tx.calendar_approval_requests.update({where:{id},data:{status:'CANCELLED',lock_version:{increment:1}}});
        await audit(tx,user,r,'request.cancelled',{status:r.status},{status:'CANCELLED'},r.reason);
        await notify(tx,r,'request.cancelled',await approvers(r.program_codes as string[],r.created_by,tx));
        return {record:await present(user,next)};
      }
      if(!['approve','reject'].includes(action)||r.status!=='PENDING') throw new ApiError('Yêu cầu không còn chờ duyệt',409);
      requirePermission(user,PERMISSIONS.review); const policy=await accountPolicy(user.userId,tx);
      requirePermission(user,action==='approve'?PERMISSIONS.approve:PERMISSIONS.reject);
      assertScope(user,action==='approve'?PERMISSIONS.approve:PERMISSIONS.reject,r.program_codes as string[]);
      if(!policy.can_approve||r.created_by===user.userId) throw new ApiError('Không được duyệt yêu cầu của chính mình hoặc tài khoản chưa được cấu hình duyệt',403);
      const decisionReason=String(input.reason||'').trim();
      if(decisionReason.length>1000||(action==='reject'&&!decisionReason)) throw new ApiError('Bắt buộc nhập lý do từ chối (tối đa 1000 ký tự)',422);
      let status='REJECTED',resultData:any=null;
      if(action==='approve') {
        const creator=await freshUser(r.created_by);
        requirePermission(creator,PERMISSIONS.submit);
        const current=fingerprint(await dependencies(tx,r.program_codes as string[]));
        if(current!==r.base_hash) {
          const conflicted=await tx.calendar_approval_requests.update({where:{id},data:{status:'CONFLICTED',lock_version:{increment:1}}});
          await audit(tx,user,r,'request.conflicted',{status:'PENDING'},{status:'CONFLICTED'},'Dữ liệu lịch hoặc đề cương đã thay đổi');
          await notify(tx,r,'request.conflicted',[r.created_by]);
          return {record:await present(user,conflicted),conflict:true};
        }
        const plan=await buildPlan(tx,creator,r.command);
        // Load visibility once for the whole batch rather than one DB lookup
        // for every field of every calendar.
        const fields=[...new Set(plan.proposed.flatMap((row:any,i:number)=>changedFields(plan.before[i],row)))].filter(f=>!['key','deleted_at','calendar_source','id'].includes(f));
        const visible:Record<string,any>=await FieldPermissionService.filterVisibleRecord(user.roleIds,'calendar',Object.fromEntries(fields.map(f=>[f,true])));
        if(fields.some(f=>!visible[f])) throw new ApiError('Bạn chưa có quyền xem đầy đủ các trường thay đổi để duyệt',403);
        const applied=await applyCommand(plan.command,creator);
        // Audit stores the official post-commit candidate. API only exposes IDs.
        const ids=collectCalendarIds(applied);
        resultData={calendar_ids:ids,operation_id:randomUUID()}; status='APPROVED';
        await audit(tx,user,r,'calendar.applied',r.before_data,{result:jsonValue(applied),requested_by:r.created_by},r.reason);
      }
      const next=await tx.calendar_approval_requests.update({where:{id},data:{status,decided_by:user.userId,decided_at:new Date(),decision_reason:decisionReason||null,result_data:resultData||Prisma.JsonNull,lock_version:{increment:1}}});
      await audit(tx,user,r,action==='approve'?'request.approved':'request.rejected',{status:'PENDING'},{status},decisionReason||r.reason);
      await notify(tx,r,action==='approve'?'request.approved':'request.rejected',[r.created_by,...(await approvers(r.program_codes as string[],r.created_by,tx)).filter(id=>id!==user.userId)]);
      return {record:await present(user,next)};
    });
    if(result.conflict) throw new ApiError('Lịch hoặc đề cương đã thay đổi. Yêu cầu cần đối chiếu và gửi lại.',409);
    return result.record;
  },
  async history(user:any,id:bigint) {
    user=await freshUser(user.userId);requirePermission(user,PERMISSIONS.history);
    await this.detail(user,id);
    // Transition log intentionally excludes unrestricted snapshot payloads.
    const logs=await prisma.calendar_approval_audit.findMany({where:{request_id:id},orderBy:{id:'asc'},select:{id:true,revision:true,actor_name:true,action:true,reason:true,created_at:true}});
    return jsonValue(logs);
  },
};
function collectCalendarIds(value:any):number[] {
  const ids=new Set<number>();
  const visit=(v:any)=>{if(!v||typeof v!=='object')return;if(v.id&&v.start_time&&v.code)ids.add(Number(v.id));if(Array.isArray(v))v.forEach(visit);else Object.values(v).forEach(visit);};visit(value);return [...ids];
}
export async function applyCommand(c:Command,actor:any) {
  const p=jsonValue(c.payload);
  switch(c.action) {
    case 'import':return applyApprovedCalendarImport(currentCalendarTransaction()!,p,actor);
    case 'create':return calendars.createSingle(p,actor);
    case 'createBulk':return calendars.createBulk(p,actor);
    case 'update':return calendars.updateSchedule(c.id!,p,'current',actor);
    case 'updateBulk':return ['cancel','makeup'].includes(p.operation)?calendars.bulkRescheduleSessions(p,actor):calendars.updateBulk(p,actor);
    case 'delete':return calendars.deleteSession(c.id!,actor);
    case 'cancel':return calendars.cancelSession(c.id!,p,actor);
    case 'reschedule':return calendars.rescheduleSession(c.id!,p,actor);
    case 'swap':return calendars.swapSessionTimes(p,actor);
    case 'restore':return calendars.restoreSession(c.id!,actor);
    case 'mapping':return calendars.updateCalendarMappings(p,actor);
    default:throw new ApiError('Thao tác không được hỗ trợ',422);
  }
}


// Direct edits are still official immediately for accounts whose policy does
// not require review. Persist their activity in the same transaction so they
// also invalidate notification/list clients without pretending to be approved.
setCalendarWriteObserver(async(tx,action,actor,before,after,payload)=>{
  const fields=['id','session_id','code','learn_number','subject','start_time','end_time','teacher','assistant_teacher','lesson_name','lesson_document','lesson_baitap','channel_name','lesson_status','cancel_reason','key','system_type','lesson_count','deleted_at','evg_stream','evg_banner','lesson_link'];
  const stable=(rows:any[])=>rows.map(row=>Object.fromEntries(fields.map(f=>[f,row[f]??null]))).sort((a,b)=>Number(a.id)-Number(b.id));
  before=stable(before);after=stable(after);
  if(fingerprint(before)===fingerprint(after)) return;
  const codes=[...new Set<string>([...before,...after].map(row=>String(row.code)).filter(Boolean))].sort();
  if(!codes.length)return;
  const operation=action.includes('create')?'create':action==='deleteSession'?'delete':action==='restoreSession'?'restore':action==='cancelSession'?'cancel':action.includes('reschedule')||action.includes('Reschedule')?'reschedule':action==='swapSessionTimes'?'swap':action==='updateCalendarMappings'?'mapping':'update';
  const reason=String(payload?.reason||payload?.change_reason||'Thay đổi lịch trực tiếp').trim().slice(0,1000);
  const r=await tx.calendar_approval_requests.create({data:{created_at:new Date(),public_id:randomUUID(),created_by:actor.userId,creator_name:actor.username,operation,status:'DIRECT_APPLIED',command:{action:'direct',operation},program_codes:codes,before_data:jsonValue(before),proposed_data:operation==='delete'?[null]:jsonValue(after),base_hash:fingerprint(before),reason,submitted_at:new Date(),decided_at:new Date(),result_data:{calendar_ids:after.map(row=>Number(row.id))}}});
  await audit(tx,actor,r,'calendar.changed',before,after,reason);
  await notify(tx,r,'calendar.changed',[actor.userId,...await approvers(codes,actor.userId,tx)]);
});
