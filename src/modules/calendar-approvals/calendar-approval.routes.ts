import {approvalSubmissionReason,approvalSubmissionTitle} from './calendar-approval.reason';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import auth from '../auth/auth.middleware';
import ApiError from '../../utils/ApiError';
import { approvals, viewWhere } from './calendar-approval.service';
import { getAccountConfiguration, accountPolicy, freshUser, hasPermission, requirePermission, saveAccountPolicy } from './calendar-approval.access';
import { PERMISSIONS, positiveId, positiveBigId, affectedOperations, type Command, jsonValue } from './calendar-approval.types';
import { normalizeCommand } from './calendar-approval.plan';

const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void Promise.resolve(fn(req,res)).catch(next);};
export const calendarApprovalRoutes=Router();
calendarApprovalRoutes.use(auth.authenticate);
calendarApprovalRoutes.get('/capabilities',handle(async(req,res)=>res.json({success:true,data:await approvals.capabilities(req.user)})));
calendarApprovalRoutes.get('/accounts',handle(async(req,res)=>{
  requirePermission(req.user,PERMISSIONS.manage);
  const q=String(req.query.q||'').slice(0,100);
  const users=await prisma.users.findMany({where:{userRoles:{some:{role:{isActive:true}}},...(q?{OR:[{username:{contains:q}},{name:{contains:q}}]}:{})},take:100,orderBy:{id:'desc'},select:{id:true,username:true,name:true}});
  return res.json({success:true,data:await Promise.all(users.map(async u=>({...u,...await accountPolicy(u.id)})))});
}));
calendarApprovalRoutes.get('/accounts/:userId',handle(async(req,res)=>{requirePermission(req.user,PERMISSIONS.manage);return res.json({success:true,data:await getAccountConfiguration(positiveId(req.params.userId))});}));
calendarApprovalRoutes.put('/accounts/:userId',handle(async(req,res)=>res.json({success:true,data:await saveAccountPolicy(await freshUser(req.user.userId),positiveId(req.params.userId),req.body)})));
calendarApprovalRoutes.get('/notifications',handle(async(req,res)=>{
  const user=await freshUser(req.user.userId); const access=viewWhere(user);
  const unread=req.query.unread==='true'; const limit=Math.min(50,Math.max(1,Number(req.query.limit||20)));
  if(!Number.isInteger(limit)) throw new ApiError('Phân trang không hợp lệ',400);
  // Request scope is checked at read time, not just when recipients were created.
  const ids=Prisma.sql`SELECT id FROM calendar_approval_requests WHERE ${access}`;
  // Keep durable delivery/audit history, but show one current business alert per
  // request. Withdrawal is an invalidation signal, not a second review alert.
  // Select latest BEFORE filtering unread so an older unread receipt cannot
  // reappear after the user reads the latest notification.
  const current=Prisma.sql`SELECT MAX(latest.id) FROM calendar_approval_notifications latest WHERE latest.recipient_id=${user.userId} AND latest.event_type <> 'request.withdrawn' GROUP BY latest.request_id`;
  const records=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT n.id,n.request_id,n.event_type,n.read_at,n.created_at,r.operation,r.title,r.creator_name,r.status FROM calendar_approval_notifications n JOIN calendar_approval_requests r ON r.id=n.request_id WHERE n.recipient_id=${user.userId} AND n.id IN (${current}) AND n.request_id IN (${ids}) ${unread?Prisma.sql`AND n.read_at IS NULL`:Prisma.empty} ORDER BY n.id DESC LIMIT ${limit}`);
  const counts=await prisma.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) AS unread,MAX(n.id) AS through_id FROM calendar_approval_notifications n WHERE n.recipient_id=${user.userId} AND n.id IN (${current}) AND n.request_id IN (${ids}) AND n.read_at IS NULL`);
  return res.json({success:true,data:jsonValue({rows:records,unread:Number(counts[0].unread),through_id:String(counts[0].through_id||0)})});
}));
calendarApprovalRoutes.post('/notifications/read-all',handle(async(req,res)=>{
  const user=await freshUser(req.user.userId),through=positiveBigId(req.body.through_id),where=viewWhere(user);
  await prisma.$executeRaw(Prisma.sql`UPDATE calendar_approval_notifications SET read_at=UTC_TIMESTAMP(3) WHERE recipient_id=${user.userId} AND id<=${through} AND read_at IS NULL AND request_id IN (SELECT id FROM calendar_approval_requests WHERE ${where})`);
  return res.json({success:true});
}));
calendarApprovalRoutes.patch('/notifications/:id/read',handle(async(req,res)=>{
  const id=positiveBigId(req.params.id);const row=await prisma.calendar_approval_notifications.findFirst({where:{id,recipient_id:req.user.userId}});
  if(!row) throw new ApiError('Không tìm thấy thông báo',404);
  await approvals.detail(req.user,row.request_id);
  await prisma.calendar_approval_notifications.updateMany({where:{id,recipient_id:req.user.userId,read_at:null},data:{read_at:new Date()}});
  return res.json({success:true});
}));
calendarApprovalRoutes.get('/',handle(async(req,res)=>res.json({success:true,data:await approvals.list(req.user,req.query)})));
calendarApprovalRoutes.post('/',handle(async(req,res)=>res.status(201).json({success:true,data:await approvals.create(req.user,req.body,req.header('Idempotency-Key'))})));
calendarApprovalRoutes.patch('/:id/read',handle(async(req,res)=>{
  const id=positiveBigId(req.params.id);await approvals.detail(req.user,id);
  await prisma.calendar_approval_notifications.updateMany({where:{request_id:id,recipient_id:req.user.userId,read_at:null},data:{read_at:new Date()}});
  return res.json({success:true});
}));
calendarApprovalRoutes.get('/:id/history',handle(async(req,res)=>res.json({success:true,data:await approvals.history(req.user,positiveBigId(req.params.id))})));
calendarApprovalRoutes.get('/:id',handle(async(req,res)=>res.json({success:true,data:await approvals.detail(req.user,positiveBigId(req.params.id))})));
calendarApprovalRoutes.patch('/:id',handle(async(req,res)=>res.json({success:true,data:await approvals.edit(req.user,positiveBigId(req.params.id),req.body)})));
for(const action of ['submit','approve','reject','cancel','withdraw']) calendarApprovalRoutes.post(`/:id/${action}`,handle(async(req,res)=>res.json({success:true,data:await approvals.transition(req.user,positiveBigId(req.params.id),action,req.body)})));

// Mounted AFTER existing route RBAC/field/scope middleware, before official writes.
export const approvalGate=(action:Command['action'])=>handle(async(req,res)=>{
  const account=await accountPolicy(req.user.userId);
  let command:Command={action,payload:req.body||{},...(['update','delete','cancel','reschedule','restore'].includes(action)?{id:positiveId(req.params.id)}:{})};
  if(!affectedOperations(command).some(op=>account.required_operations.includes(op))) return (res.locals.approvalNext as NextFunction)();
  command=normalizeCommand(command);
  if(req.header('X-Calendar-Submit-Approval')!=='true') return res.status(409).json({success:false,code:'APPROVAL_REQUIRED',message:'Thao tác này cần phê duyệt. Hãy gửi yêu cầu duyệt lịch trên LMS.'});
  const reason=approvalSubmissionReason(req,res,affectedOperations(command)[0]);if(!reason)return;
  const result=await approvals.create(req.user,{command,reason,title:approvalSubmissionTitle(req),submit:true},req.header('Idempotency-Key'));
  return res.status(202).json({success:true,data:{approval_required:true,request:result},message:'Đã gửi yêu cầu duyệt. Lịch chính thức chưa thay đổi.'});
});
export const scheduleApprovalGate=(action:Command['action'])=>(req:Request,res:Response,next:NextFunction)=>{res.locals.approvalNext=next;return approvalGate(action)(req,res,next);};

// Import and operational APIs which are not proposal commands must never bypass
// an account's approval policy. Read-only previews remain available.
export const requireOfficialOperation=(operations:string[])=>(req:Request,res:Response,next:NextFunction)=>{
  void accountPolicy(req.user.userId).then(account=>{
    if(account.required_operations.some(o=>operations.includes(o))) return res.status(409).json({success:false,code:'APPROVAL_REQUIRED',message:'Tài khoản cần phê duyệt thao tác này. Vui lòng tạo yêu cầu từ màn quản lý lịch; thao tác trực tiếp chưa được áp dụng.'});
    next();
  }).catch(next);
};
