import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarDetailReportRouter, DETAIL_PERMISSIONS as P } from '../src/modules/livestream/calendar-detail-report.route';
import { calendarDetailReportService as service } from '../src/modules/livestream/calendar-detail-report.service';
import FieldPermissionService from '../src/modules/roles/field-permission.service';
const user = (permissions: string[], mode = 'ALL', programs: string[] = []) => ({ userId: 1, roleIds: ['1'], roles: [], permissions, programScope: { mode, programs } });
const request = (path: string, who: any, query: any = {}, calendarId = '12') => new Promise<{ status: number; body: any }>((resolve, reject) => {
  const router = createCalendarDetailReportRouter(async () => ['permission-program']);
  const req = { method: 'GET', url: path, originalUrl: path, baseUrl: '', params: { calendarId }, query, user: who } as any;
  const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: any) { resolve({ status: this.statusCode, body }); }, setHeader() {}, send(body: any) { resolve({ status: this.statusCode, body }); } } as any;
  (router as any).handle(req, res, (error: any) => error ? resolve({ status: error.statusCode || 500, body: { message: error.message } }) : reject(Error('Unexpected unmatched route')));
});
test('HTTP route enforces view AND detail, program scope, separate source permissions and export AND rights', async () => {
  const originalStudents = service.students, originalEvents = service.events, originalFields = FieldPermissionService.filterVisibleRecords;
  let calls = 0;
  (service as any).students = async (_id: number, _filters: any, caps: any) => { calls++; return { rows: [], caps }; };
  (service as any).events = async (_id: number, _student: number, filters: any, caps: any) => {
    calls++;
    if (filters.source === 'chat' && !caps.chat || filters.source === 'moderation' && !caps.moderation) throw Object.assign(Error('Forbidden source'), { statusCode: 403 });
    return { rows: [], next_cursor: null };
  };
  (FieldPermissionService as any).filterVisibleRecords = async (_roles: any, _module: any, rows: any) => rows;
  try {
    assert.equal((await request('/students', user(['calendar.view']))).status, 403);
    assert.equal((await request('/students', user([P.view]))).status, 403);
    assert.equal(calls, 0);
    const allowed = ['calendar.view', P.view];
    assert.equal((await request('/students', user(allowed, 'DENY'))).status, 403);
    assert.equal((await request('/students', user(allowed, 'RESTRICTED', ['raw-calendar-code']))).status, 403);
    assert.equal(calls, 0);
    assert.equal((await request('/students', user(allowed, 'RESTRICTED', ['permission-program']))).status, 200);
    const basic = await request('/students', user(allowed));
    assert.deepEqual(basic.body.data.caps, { chat: false, moderation: false, activities: false });
    assert.equal((await request('/students/1/events', user(allowed), { source: 'chat' })).status, 403);
    assert.equal((await request('/students/1/events', user([...allowed, P.chat]), { source: 'chat' })).status, 200);
    assert.equal((await request('/students/1/events', user([...allowed, P.chat]), { source: 'moderation' })).status, 403);
    assert.equal((await request('/export/students', user([...allowed, P.export]))).status, 403);
    assert.equal((await request('/export/students', user([...allowed, 'calendar.export']))).status, 403);
    const exported = await request('/export/students', user([...allowed, 'calendar.export', P.export]));
    assert.equal(exported.status, 200); assert.ok(Buffer.isBuffer(exported.body));
    assert.equal((await request('/students', { ...user([]), roles: ['admin'] })).status, 200);
    assert.equal((await request('/students', user(['*']))).status, 200);
    assert.equal((await request('/students', user(['*']), {}, '12 OR 1')).status, 400);
    (FieldPermissionService as any).filterVisibleRecords = async () => [{}];
    const before = calls;
    assert.equal((await request('/students', user(allowed))).status, 403);
    assert.equal(calls, before);
  } finally {
    service.students = originalStudents; service.events = originalEvents; FieldPermissionService.filterVisibleRecords = originalFields;
  }
});
