import { Router, Request, Response, NextFunction } from 'express';
import auth from '../auth/auth.middleware';
import { Prisma } from '@prisma/client';
import * as service from './salary.service';
import { report, reportData, confirmTeaching } from './teaching-report.service';
import { prisma, scope, check } from './salary-common';
import { fail, id, numberId, text, json, retryableTransactionError } from './salary-domain';
import { workbook } from './salary-export';
const router = Router();
router.use(auth.authenticate);
const run = (fn: (req: Request) => Promise<any>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json({ success: true, data: json(await fn(req)) });
    }
    catch (e: any) {
        if (e?.code === 'P2002')
            return next(Object.assign(Error('Dữ liệu đã được ghi bởi yêu cầu khác; tải lại để đối soát'), { statusCode: 409 }));
        if (retryableTransactionError(e))
            return next(Object.assign(Error('Dữ liệu đang được thao tác; vui lòng thử lại'), { statusCode: 409 }));
        next(e);
    }
};
const can = (p: string) => auth.authorize([p]);
router.get('/options', auth.authorize(['teaching_report.view', 'salary.view', 'salary.rate.manage', 'salary.period.create']), run(async (req) => {
    const permission = ['teaching_report.view', 'salary.view', 'salary.rate.manage', 'salary.period.create'].find(p => req.user.permissions?.includes('*') || req.user.roles?.includes('admin') || req.user.permissions?.includes(p))!;
    const allowed = scope(req.user, permission);
    const programs = await prisma.$queryRaw<any[]>(Prisma.sql `SELECT DISTINCT code FROM calendar WHERE deleted_at IS NULL ${allowed === null ? Prisma.empty : allowed.length ? Prisma.sql `AND code IN (${Prisma.join(allowed)})` : Prisma.sql `AND 1=0`} ORDER BY code LIMIT 1001`);
    const teachers = await prisma.teacher_profiles.findMany({ select: { id: true, username: true, display_name: true, can_view_stream_key: true, status: true }, orderBy: { display_name: 'asc' }, take: 5000 });
    const hasGroups = await prisma.$queryRaw<any[]> `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_groups'`;
    const groups = hasGroups.length ? await prisma.$queryRaw<any[]>(Prisma.sql `SELECT id,code,group_code,name FROM learning_groups ${allowed === null ? Prisma.empty : allowed.length ? Prisma.sql `WHERE code IN (${Prisma.join(allowed)})` : Prisma.sql `WHERE 1=0`} ORDER BY code,id LIMIT 5000`) : [];
    return { programs: programs.map(c => c.code), teachers, groups: groups.map(g => ({ ...g, id: Number(g.id) })) };
}));
router.get('/report', can('teaching_report.view'), run(req => report(req.user, req.query)));
router.post('/teaching-records/confirm', can('teaching_record.confirm'), run(req => confirmTeaching(req.user, req.body)));
router.post('/teaching-records/:id/revise', can('teaching_record.revise'), run(req => confirmTeaching(req.user, req.body, req.params.id)));
router.get('/overview', can('salary.view'), run(req => service.overview(req.user, req.query)));
router.get('/rates', can('salary.rate.manage'), run(req => service.listRates(req.user, req.query)));
router.post('/rates', can('salary.rate.manage'), run(req => service.createRate(req.user, req.body)));
router.get('/periods', can('salary.view'), run(req => service.listPeriods(req.user, req.query)));
router.post('/periods', can('salary.period.create'), run(req => service.createPeriod(req.user, req.body)));
router.get('/periods/:id', can('salary.view'), run(req => service.getPeriod(req.user, req.params.id)));
router.post('/periods/:id/preview', can('salary.view'), can('salary.period.calculate'), run(req => service.previewPeriod(req.user, req.params.id)));
router.post('/periods/:id/recalculate', can('salary.view'), can('salary.period.calculate'), run(req => service.recalculatePeriod(req.user, req.params.id, req.body)));
router.post('/periods/:id/adjustments', can('salary.view'), can('salary.adjust'), run(req => service.adjustment(req.user, req.params.id, req.body)));
router.post('/periods/:id/payments', can('salary.view'), can('salary.pay'), run(req => service.payment(req.user, req.params.id, req.body)));
router.delete('/periods/:id/items/:itemId', can('salary.view'), can('salary.period.calculate'), run(req => service.releaseItem(req.user, req.params.id, req.params.itemId, req.body)));
router.get('/periods/:id/history', can('salary.view'), can('salary.audit.view'), run(req => service.history(req.user, req.params.id, req.query)));
for (const [action, permission] of Object.entries({ submit: 'salary.review', return: 'salary.review', approve: 'salary.approve', reopen: 'salary.reopen' }))
    router.post(`/periods/:id/${action}`, can('salary.view'), can(permission), run(req => service.changePeriod(req.user, req.params.id, action, req.body)));
const download = (res: Response, buffer: Buffer, name: string) => { res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); res.send(buffer); };
router.get('/report/export', can('teaching_report.view'), can('teaching_report.export'), async (req, res, next) => {
    try {
        const data = await reportData(req.user, req.query);
        const codes = [...new Set(data.sessions.map(s => s.code))];
        if (codes.length)
            check(req.user, 'teaching_report.export', codes);
        download(res, workbook({ 'Tong hop': data.teachers, 'Chi tiet': data.sessions, 'Cong xac nhan': data.records, 'Metadata': [data.metadata] }), 'bao-cao-giang-day');
    }
    catch (e) {
        next(e);
    }
});
router.get('/periods/:id/export', can('salary.view'), can('salary.export'), async (req, res, next) => {
    try {
        const data = await service.getPeriod(req.user, req.params.id);
        check(req.user, 'salary.export', data.period.scope as string[]);
        download(res, workbook({ 'Tong hop': data.teachers, 'Chi tiet': data.items, 'Dieu chinh': data.adjustments, 'Thanh toan': data.payments, 'Metadata': [{ ...data.period, total: data.total, paid: data.paid, unpaid: data.unpaid }] }), `bang-luong-${data.period.id}-v${data.period.revision}`);
    }
    catch (e) {
        next(e);
    }
});
export default router;
