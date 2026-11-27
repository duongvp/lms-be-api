import type {Request,Response} from 'express';
import {requirePermission} from './calendar-approval.access';
import {PERMISSIONS} from './calendar-approval.types';
import ApiError from '../../utils/ApiError';

// Keep approval context separate from business payload.reason/change_reason.
export function approvalSubmissionReason(req:Request,res:Response,operation?:string):string|undefined {
 requirePermission(req.user,PERMISSIONS.submit);
 const raw=req.header('X-Calendar-Approval-Reason');
 if(raw===undefined){res.status(409).json({success:false,code:'APPROVAL_REASON_REQUIRED',operation,message:'Vui lòng nhập lý do gửi yêu cầu duyệt.'});return;}
 let reason:string;
 try{reason=decodeURIComponent(raw).trim();}catch{throw new ApiError('Lý do gửi duyệt không hợp lệ.',422);}
 if(!reason||reason.length>1000)throw new ApiError('Vui lòng nhập lý do gửi duyệt từ 1 đến 1000 ký tự.',422);
 return reason;
}

export function approvalTitle(value:unknown):string|null {
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||!value.trim()||value.trim().length>255)throw new ApiError('Vui lòng nhập tiêu đề yêu cầu từ 1 đến 255 ký tự.',422);
 return value.trim();
}
export function approvalSubmissionTitle(req:Request):string|null {
 const raw=req.header('X-Calendar-Approval-Title');
 if(raw===undefined)return null;
 let value:string;try{value=decodeURIComponent(raw);}catch{throw new ApiError('Tiêu đề yêu cầu không hợp lệ.',422);}
 return approvalTitle(value);
}
