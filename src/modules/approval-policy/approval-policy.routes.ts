import {Router} from 'express';
import auth from '../auth/auth.middleware';
import {getAccountConfiguration,saveAccountPolicy,freshUser,hasPermission} from '../calendar-approvals/calendar-approval.access';
import ApiError from '../../utils/ApiError';
import {positiveId} from '../calendar-approvals/calendar-approval.types';
import {APPROVAL_MODULES} from './approval-policy.registry';
export const approvalPolicyRoutes=Router();
approvalPolicyRoutes.use(auth.authenticate);
approvalPolicyRoutes.get('/modules',(_req,res)=>res.json({success:true,data:APPROVAL_MODULES}));

const handle=(fn:any)=>(req:any,res:any,next:any)=>{void Promise.resolve(fn(req,res)).catch(next);};
const configurationActor=async(req:any)=>{
 const actor=await freshUser(req.user.userId);
 if(!APPROVAL_MODULES.some(module=>hasPermission(actor,module.managePermission))) throw new ApiError('Không có quyền cấu hình phê duyệt',403);
 return actor;
};
approvalPolicyRoutes.get('/accounts/:id',handle(async(req:any,res:any)=>{
 await configurationActor(req);
 return res.json({success:true,data:await getAccountConfiguration(positiveId(req.params.id))});
}));
approvalPolicyRoutes.put('/accounts/:id',handle(async(req:any,res:any)=>res.json({success:true,data:await saveAccountPolicy(await configurationActor(req),positiveId(req.params.id),req.body)})));
