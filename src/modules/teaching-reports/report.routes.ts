import { Router, Request, Response, NextFunction } from 'express';
import auth from '../auth/auth.middleware';
import { report, reportData, reportOptions } from './report.service';
import { json } from './report-domain';
import { check } from './report-common';
import { teachingReportWorkbook } from './report-export';
const router=Router();
router.use(auth.authenticate);
const run=(fn:(req:Request)=>Promise<any>)=>async(req:Request,res:Response,next:NextFunction)=>{try{res.json({success:true,data:json(await fn(req))});}catch(e){next(e);}};
router.get('/options',auth.authorize(['teaching_report.view']),run(req=>reportOptions(req.user,req.query)));
router.get('/',auth.authorize(['teaching_report.view']),run(req=>report(req.user,req.query)));
router.get('/export',auth.authorize(['teaching_report.view']),auth.authorize(['teaching_report.export']),async(req,res,next)=>{
    try {const data=await reportData(req.user,req.query);const codes=[...new Set(data.sessions.map(s=>s.code))];if(codes.length)check(req.user,'teaching_report.export',codes);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="bao-cao-giang-day.xlsx"');
    res.send(teachingReportWorkbook(data));}catch(e){next(e);}
});
export default router;
