import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
const supplied = process.env.TEST_SALARY_DATABASE_URL;
assert.ok(supplied, 'Set TEST_SALARY_DATABASE_URL explicitly');
const url = new URL(supplied!);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Local database only');
const name = 'lms_salary_test_' + randomBytes(6).toString('hex'), admin = new PrismaClient({ datasources: { db: { url: supplied } } });
url.pathname = '/' + name;
process.env.DATABASE_URL = url.toString();
process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false';
global.fetch = async () => { throw Error('No external API in salary integration'); };
let db: PrismaClient | undefined, created = false;
(async () => {
    try {
        await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        created = true;
        // Build the existing application schema without the payroll additions, then apply the actual migration.
        const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const dir = mkdtempSync(path.join(os.tmpdir(), 'salary-baseline-'));
        try {
            let base = readFileSync('prisma/schema.prisma', 'utf8').split('// Payroll is independent')[0].replace('  teaching_sources teaching_record_sources[]\n', '').replace('  teaching_records teaching_records[]\n', '').replace('  salary_items salary_items[]\n', '').replace('  salary_adjustments salary_adjustments[]\n', '').replace('  salary_payments salary_payments[]\n', '');
            writeFileSync(path.join(dir, 'schema.prisma'), base);
            const push = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema', path.join(dir, 'schema.prisma'), '--skip-generate'], { env: process.env, encoding: 'utf8' });
            assert.equal(push.status, 0, push.stderr + push.stdout);
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
        const apply = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '-h', url.hostname, '-P', url.port || '3306', '-u', decodeURIComponent(url.username), name], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, input: readFileSync('prisma/migrations/20261120180000_teacher_report_salary/migration.sql', 'utf8'), encoding: 'utf8' });
        assert.equal(apply.status, 0, apply.stderr);
        db = (await import('../src/lib/prisma')).default;
        const service = await import('../src/modules/teacher-salary/salary.service');
        const teaching = await import('../src/modules/teacher-salary/teaching-report.service');
        const { workbook } = await import('../src/modules/teacher-salary/salary-export');
        const XLSX = (await import('xlsx-js-style')).default;
        const u = { userId: 1, username: 'qa-admin', permissions: ['*'], roles: ['admin'], programScope: { mode: 'ALL', programs: [] } };
        const teacher = await db.teacher_profiles.create({ data: { username: 'qa-teacher', display_name: 'Teacher QA', can_view_stream_key: 1 } });
        const replacement = await db.teacher_profiles.create({ data: { username: 'qa-replacement', display_name: 'Replacement', can_view_stream_key: 1 } });
        const assistant = await db.teacher_profiles.create({ data: { username: 'qa-assistant', display_name: 'Assistant', can_view_stream_key: 0 } });
        const create = (code: string, day: string, status = 0) => db!.calendar.create({ data: { code, learn_number: 1, lesson_name: 'Lesson QA', subject: 'Toán 6', teacher: teacher.display_name, assistant_teacher: assistant.username, start_time: new Date(day + 'T19:00:00Z'), end_time: new Date(day + 'T20:00:00Z'), lesson_status: status, key: code + '-' + day } });
        const a = await create('SAL_A', '2020-11-01'), b = await create('SAL_B', '2020-11-01');
        const cancelled = await create('SAL_A', '2020-11-02', 1), future = await create('SAL_A', '2031-11-01');
        const before = await db.calendar.findMany();
        const report = await teaching.reportData(u, { from: '2020-11-01', to: '2020-12-01' });
        assert.equal(report.summary.assigned, 3);
        assert.equal(report.summary.completed, 0);
        assert.equal(report.summary.cancelled, 1);
        assert.ok(report.sessions.every(s => !('amount' in s)));
        assert.equal(report.sessions.find(s => s.id === a.id)!.shared_candidate_ids.length, 1);
        const body = { calendar_ids: [a.id, b.id], role: 'teacher', outcome: 'completed', session_kind: 'regular', teacher_profile_id: teacher.id, shared_confirmed: true, billing_code: 'SAL_A', actual_start_time: '2020-11-01T19:00:00Z', actual_end_time: '2020-11-01T20:00:00Z', evidence: 'Đã đối soát ghi hình', reason: 'QA xác nhận' };
        await assert.rejects(teaching.confirmTeaching(u, { ...body, calendar_ids: [future.id] }), /kết thúc/);
        await assert.rejects(teaching.confirmTeaching(u, { ...body, calendar_ids: [cancelled.id] }), /nghỉ\/hủy/);
        const record = await teaching.confirmTeaching(u, body);
        await assert.rejects(teaching.confirmTeaching(u, body), /đã có bản ghi công/);
        assert.equal((await teaching.reportData(u, { from: '2020-11-01', to: '2020-12-01' })).summary.completed, 1);
        await service.createRate(u, { name: 'GV theo giờ', dimensions: { role: 'teacher' }, pay_basis: 'hour', duration_basis: 'actual', amount: '200000', priority: 0, valid_from: '2020-01-01', valid_to: '2030-01-01', reason: 'QA đơn giá' });
        const p = await service.createPeriod(u, { name: 'Tháng 11/2020', from: '2020-11-01', to: '2020-12-01', codes: ['SAL_A', 'SAL_B'], reason: 'QA kỳ' });
        const preview = await service.previewPeriod(u, p.id);
        assert.equal(preview.issues.length, 0);
        assert.equal(preview.items.length, 1);
        assert.equal(preview.total.toString(), '200000');
        assert.equal(await db.salary_items.count(), 0);
        let detail = await service.recalculatePeriod(u, p.id, { expected_version: p.revision, reason: 'QA tính' });
        assert.equal(detail.items.length, 1);
        detail = await service.recalculatePeriod(u, p.id, { expected_version: detail.period.revision, reason: 'QA tính lại' });
        assert.equal(await db.salary_items.count(), 1);
        const second = await service.createPeriod(u, { name: 'Kỳ trùng', from: '2020-11-01', to: '2020-12-01', codes: ['SAL_A', 'SAL_B'], reason: 'QA overlap' });
        assert.match(JSON.stringify((await service.previewPeriod(u, second.id)).issues), /đã thuộc kỳ/);
        await assert.rejects(teaching.confirmTeaching(u, { ...body, expected_version: record.version }, record.id), /thuộc kỳ lương/);
        await service.adjustment(u, p.id, { expected_version: detail.period.revision, teacher_profile_id: teacher.id, code: 'SAL_A', kind: 'bonus', amount: '50000', reason: 'QA thưởng' });
        detail = await service.getPeriod(u, p.id);
        assert.equal(detail.total.toString(), '250000');
        detail = await service.recalculatePeriod(u, p.id, { expected_version: detail.period.revision, reason: 'QA tính cả thưởng' });
        assert.equal(detail.total.toString(), '250000');
        const action = (name: string) => service.changePeriod(u, p.id, name, { expected_version: detail.period.revision, calculation_hash: detail.period.calculation_hash, reason: 'QA ' + name });
        detail = await action('submit');
        assert.equal(detail.period.status, 'pending_review');
        await assert.rejects(service.recalculatePeriod(u, p.id, { expected_version: detail.period.revision, reason: 'QA' }), /nháp/);
        detail = await action('approve');
        assert.equal(detail.period.status, 'approved');
        const frozen = JSON.stringify(detail.items, (_, v) => typeof v === 'bigint' ? String(v) : v);
        await db.calendar.update({ where: { id: a.id }, data: { lesson_name: 'Changed after approval' } });
        assert.equal(JSON.stringify((await service.getPeriod(u, p.id)).items, (_, v) => typeof v === 'bigint' ? String(v) : v), frozen);
        const pay = { teacher_profile_id: teacher.id, amount: '100000', reference: 'QA ref 1', idempotency_key: 'qa-payment-1', reason: 'QA trả một phần', expected_version: detail.period.revision };
        await service.payment(u, p.id, pay);
        await service.payment(u, p.id, pay);
        assert.equal(await db.salary_payments.count(), 1);
        detail = await service.getPeriod(u, p.id);
        assert.equal(detail.unpaid.toString(), '150000');
        await assert.rejects(service.changePeriod(u, p.id, 'reopen', { expected_version: detail.period.revision, reason: 'QA' }), /đã có thanh toán/);
        await assert.rejects(service.payment(u, p.id, { ...pay, idempotency_key: 'overpay', amount: '999999', expected_version: detail.period.revision }), /vượt dư/);
        await service.payment(u, p.id, { ...pay, idempotency_key: 'qa-payment-2', reference: 'QA ref 2', amount: '150000', expected_version: detail.period.revision });
        detail = await service.getPeriod(u, p.id);
        assert.equal(detail.period.status, 'paid');
        const exported = workbook({ 'Tong hop': detail.teachers, 'Chi tiet': detail.items });
        const wb = XLSX.read(exported, { type: 'buffer' });
        const totals = XLSX.utils.sheet_to_json<any>(wb.Sheets['Tong hop']);
        assert.equal(totals[0].total, 250000);
        const denied = { userId: 2, username: 'limited', permissions: ['salary.view', 'salary.audit.view', 'teaching_report.view'], programScope: { mode: 'RESTRICTED', programs: ['SAL_A'] } };
        await assert.rejects(service.getPeriod(denied, p.id), /Không có quyền/);
        await assert.rejects(service.history(denied, p.id, {}), /Không có quyền/);
        const limited = await teaching.reportData(denied, { from: '2020-11-01', to: '2020-12-01' });
        assert.equal(limited.records.length, 0);
        assert.ok(limited.sessions.every(s => s.code === 'SAL_A'));
        // Freshness prevents chốt after a raw source edit; a substitute receives their own payee.
        const originalC = await create('SAL_C', '2020-11-30', 1);
        const c = await create('SAL_C', '2020-12-01');
        const r2 = await teaching.confirmTeaching(u, { ...body, calendar_ids: [c.id], teacher_profile_id: replacement.id, billing_code: 'SAL_C', session_kind: 'makeup', replaces_calendar_id: originalC.id, actual_start_time: '2020-12-01T19:00:00Z', actual_end_time: '2020-12-01T20:30:00Z' });
        assert.equal(r2.is_substitute, true);
        const p2 = await service.createPeriod(u, { name: 'Tháng 12', from: '2020-12-01', to: '2021-01-01', codes: ['SAL_C'], reason: 'QA' });
        let d2 = await service.recalculatePeriod(u, p2.id, { expected_version: 1, reason: 'QA' });
        assert.equal(d2.total.toString(), '300000');
        await db.calendar.update({ where: { id: c.id }, data: { teacher: 'Different' } });
        await assert.rejects(service.changePeriod(u, p2.id, 'submit', { expected_version: d2.period.revision, calculation_hash: d2.period.calculation_hash, reason: 'QA' }), /nguồn đã thay đổi/);
        assert.ok(await db.salary_audit_logs.count() > 10);
        assert.equal((await db.calendar.findUniqueOrThrow({ where: { id: b.id } })).key, b.key);
        assert.equal((await db.calendar.findMany()).length, before.length + 2);
        const raceCalendar = await create('SAL_RACE', '2021-01-01');
        await teaching.confirmTeaching(u, { ...body, calendar_ids: [raceCalendar.id], billing_code: 'SAL_RACE', actual_start_time: '2021-01-01T19:00:00Z', actual_end_time: '2021-01-01T20:00:00Z' });
        const raceA = await service.createPeriod(u, { name: 'Race A', from: '2021-01-01', to: '2021-02-01', codes: ['SAL_RACE'], reason: 'QA race' });
        const raceB = await service.createPeriod(u, { name: 'Race B', from: '2021-01-01', to: '2021-02-01', codes: ['SAL_RACE'], reason: 'QA race' });
        await Promise.all([service.recalculatePeriod(u, raceA.id, { expected_version: 1, reason: 'QA race' }), service.recalculatePeriod(u, raceB.id, { expected_version: 1, reason: 'QA race' })]);
        const raceItems = await db.salary_items.findMany({ where: { period_id: { in: [raceA.id, raceB.id] } } });
        assert.equal(raceItems.length, 1, 'Two overlapping writers must claim one work record only');
        let winner = await service.getPeriod(u, raceItems[0].period_id);
        winner = await service.changePeriod(u, winner.period.id, 'submit', { expected_version: winner.period.revision, calculation_hash: winner.period.calculation_hash, reason: 'QA race review' });
        winner = await service.changePeriod(u, winner.period.id, 'approve', { expected_version: winner.period.revision, calculation_hash: winner.period.calculation_hash, reason: 'QA race approve' });
        const racePayment = { teacher_profile_id: teacher.id, amount: '100000', reference: 'race ref', idempotency_key: 'same-race-payment', expected_version: winner.period.revision, reason: 'QA simultaneous payment' };
        await Promise.all([service.payment(u, winner.period.id, racePayment), service.payment(u, winner.period.id, racePayment)]);
        assert.equal(await db.salary_payments.count({ where: { idempotency_key: 'same-race-payment' } }), 1);
        const { updateSchedule } = await import('../src/modules/livestream/livestream.service');
        await updateSchedule(future.id, {teacher: replacement.display_name}, 'current', u);
        const assignmentAudit = await db.calendar_change_logs.findFirst({where: {calendar_id: future.id, action: 'teaching_assignment_update'}});
        assert.ok(assignmentAudit, 'A teacher-only schedule update must have an audit record');
        assert.equal((assignmentAudit.before_data as any).source_session.teacher, teacher.display_name);
        assert.equal((assignmentAudit.after_data as any).source_session.teacher, replacement.display_name);
        // Personnel drilldown must include assistants, not only primary teachers.
        const assisted = await create('SAL_A', '2020-12-05');
        const assistantWork = await teaching.confirmTeaching(u, { ...body, calendar_ids: [assisted.id], shared_confirmed: false, role: 'assistant', teacher_profile_id: assistant.id, actual_start_time: '2020-12-05T19:00:00Z', actual_end_time: '2020-12-05T20:00:00Z' });
        const personnelQuery = { from: '2020-12-01', to: '2021-01-01', person_id: assistant.id };
        const assistantDetail = await teaching.report(u, { ...personnelQuery, collection: 'records', teacher_id: teacher.id });
        assert.equal(assistantDetail.pagination.total, 1);
        assert.equal(assistantDetail.rows[0].id, String(assistantWork.id));
        assert.equal(assistantDetail.rows[0].role, 'assistant');
        const assistantTotals = await teaching.report(u, { ...personnelQuery, collection: 'teachers' });
        assert.equal(assistantTotals.pagination.total, 1);
        assert.equal(assistantTotals.rows[0].id, assistant.id);
        assert.equal(assistantTotals.rows[0].actual_hours, 1);
        assert.equal(assistantTotals.rows[0].completed, 1);
        assert.equal((await teaching.report(u, { ...personnelQuery, person_id: teacher.id, collection: 'records' })).pagination.total, 0);
        // Exercise the real authenticated HTTP routes, including permission AND guards.
        process.env.ACCESS_TOKEN_SECRET = 'salary-integration-only-secret';
        const jwt = (await import('jsonwebtoken')).default;
        const account = await db.users.create({ data: { username: 'qa-account', name: 'QA account', code: '', learn_number: 0 } });
        const role = await db.roles.create({ data: { code: 'qa_reporter', name: 'Reporter' } });
        const permission = await db.permissions.findUniqueOrThrow({ where: { code: 'teaching_report.view' } });
        await db.rolePermissions.create({ data: { roleId: role.id, permissionId: permission.id } });
        await db.userRoles.create({ data: { userId: account.id, roleId: role.id } });
        await db.userProgramScopePolicies.create({ data: { userId: account.id, mode: 'ALL' } });
        await db.auth_sessions.create({ data: { id: 'qa-session', user_id: account.id, refresh_token_hash: '0'.repeat(64), expires_at: new Date(Date.now() + 3600000) } });
        const token = jwt.sign({ type: 'access', sessionId: 'qa-session', userId: account.id }, process.env.ACCESS_TOKEN_SECRET);
        const app = (await import('../src/app')).default;
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>(r => server.once('listening', r));
        try {
            const port = (server.address() as any).port;
            const http = await import('node:http');
            const request = (path: string, method = 'GET', body?: any, bearer = token) => new Promise<{
                status: number;
                body: any;
            }>((resolve, reject) => {
                const req = http.request({ host: '127.0.0.1', port, path: '/api/teacher-salary/' + path, method, headers: { ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), 'Content-Type': 'application/json' } }, res => { let raw = ''; res.on('data', x => raw += x); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(raw) })); });
                req.on('error', reject);
                if (body)
                    req.write(JSON.stringify(body));
                req.end();
            });
            assert.equal((await request('report?from=2020-11-01&to=2020-12-01')).status, 200);
            const reportOnly = await request('report?from=2020-11-01&to=2020-12-01&collection=records');
            assert.ok(!JSON.stringify(reportOnly.body).includes('200000'));
            assert.equal((await request('periods')).status, 403);
            assert.equal((await request(`periods/${p.id}/approve`, 'POST', {})).status, 403);
            assert.equal((await request('report/export?from=2020-11-01&to=2020-12-01')).status, 403);
            assert.equal((await request('report?from=2020-11-01&to=2020-12-01', 'GET', undefined, '')).status, 401);
        }
        finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        console.log('PASS: real migration; shared teaching; future/cancel guards; idempotent calculation/payment; cross-period claim; partial/full payment; immutable approval; source drift; scoped salary; export reconciliation; substitute payee; audit.');
    }
    finally {
        await db?.$disconnect();
        if (created)
            await admin.$executeRawUnsafe(`DROP DATABASE \`${name}\``);
        await admin.$disconnect();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
