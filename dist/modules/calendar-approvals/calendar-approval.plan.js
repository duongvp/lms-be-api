"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshot = snapshot;
exports.changedFields = changedFields;
exports.normalizeCommand = normalizeCommand;
exports.buildPlan = buildPlan;
exports.dependencies = dependencies;
const dateTime_1 = require("../../utils/dateTime");
const client_1 = require("@prisma/client");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const auto_schedule_service_1 = require("../livestream/auto-schedule.service");
const livestream_service_1 = require("../livestream/livestream.service");
const calendar_approval_access_1 = require("./calendar-approval.access");
const calendar_approval_types_1 = require("./calendar-approval.types");
const WRITABLE = ['calendar_source', 'system_type', 'code', 'learn_number', 'session_id', 'sessionId', 'lesson_id', 'grade', 'subject_name', 'subject', 'teacher', 'assistant_teacher', 'lesson_name', 'channel_name', 'room', 'lesson_count', 'start_time', 'end_time', 'lesson_document', 'lesson_baitap', 'lesson_tomtat', 'lesson_phuongphap', 'lesson_luuy', 'lesson_ketqua', 'lesson_link', 'evg_banner', 'package_lesson_mappings', 'reason', 'change_reason', 'send_notification', 'allow_shared_staff_schedule', 'allow_past', 'course_end_time'];
const META = new Set(['calendar_source', 'system_type', 'code', 'learn_number', 'session_id', 'sessionId', 'lesson_id', 'grade', 'subject_name', 'room', 'reason', 'change_reason', 'send_notification', 'allow_shared_staff_schedule', 'allow_past', 'course_end_time', 'lesson_count']);
const SYSTEM = new Set(['id', 'key', 'created_at', 'updated_at', 'student_synced_at', 'group_id', 'group_room_config', 'waiting_video_playlist', 'live_ended_at', 'live_ended_by']);
function snapshot(row) { return Object.fromEntries(Object.entries((0, calendar_approval_types_1.jsonValue)(row)).filter(([k]) => !['updated_at', 'created_at', 'student_synced_at'].includes(k))); }
function changedFields(before, after) { return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter(k => !SYSTEM.has(k) && (0, calendar_approval_types_1.fingerprint)(before?.[k] ?? null) !== (0, calendar_approval_types_1.fingerprint)(after?.[k] ?? null)); }
function assertPayload(input, extra = []) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new ApiError_1.default('Dữ liệu lịch không hợp lệ', 422);
    const unknown = Object.keys(input).filter(k => ![...WRITABLE, ...extra].includes(k));
    if (unknown.length)
        throw new ApiError_1.default('Trường không được phép: ' + unknown.join(', '), 422);
}
function normalizeCommand(raw) {
    if (!raw || !['create', 'createBulk', 'update', 'updateBulk', 'delete', 'cancel', 'reschedule', 'swap', 'restore', 'mapping', 'auto', 'import'].includes(raw.action))
        throw new ApiError_1.default('Loại yêu cầu không hợp lệ', 422);
    const c = (0, calendar_approval_types_1.jsonValue)({ action: raw.action, payload: raw.payload || {}, ...(raw.id !== undefined ? { id: (0, calendar_approval_types_1.positiveId)(raw.id) } : {}) });
    if (!c.payload || typeof c.payload !== 'object' || Array.isArray(c.payload))
        throw new ApiError_1.default('Dữ liệu đề xuất không hợp lệ', 422);
    if (['update', 'delete', 'cancel', 'reschedule', 'restore'].includes(c.action) && !c.id)
        throw new ApiError_1.default('Thiếu ID lịch học', 422);
    if (c.action === 'import' && (!Array.isArray(c.payload.rows) || !c.payload.rows.length || c.payload.rows.length > 500 || !['create', 'update'].includes(c.payload.mode)))
        throw new ApiError_1.default('File cần từ 1 đến 500 lịch hợp lệ', 422);
    if (c.action === 'reschedule')
        c.payload.mode = c.payload.mode || c.payload.update_mode || 'cancel';
    if (c.action === 'auto') {
        const p = (0, auto_schedule_service_1.previewAutoSchedule)(c.payload);
        c.action = 'createBulk';
        c.payload = { calendars: p.calendars.map(({ auto_schedule, ...row }) => row), allow_shared_staff_schedule: c.payload.allow_shared_staff_schedule };
    }
    if (c.action === 'create' || c.action === 'update')
        assertPayload(c.payload, c.action === 'create' ? ['lesson_status', 'cancel_reason'] : ['update_mode', 'mode', 'new_session', 'source_state']);
    if (c.action === 'update' && c.payload.update_mode && c.payload.update_mode !== 'current') {
        c.action = 'reschedule';
        c.payload.mode = c.payload.update_mode;
    }
    if (c.action === 'createBulk') {
        if (!Array.isArray(c.payload.calendars) || !c.payload.calendars.length || c.payload.calendars.length > 500)
            throw new ApiError_1.default('Chọn từ 1 đến 500 lịch mỗi yêu cầu', 422);
        c.payload.calendars.forEach((row) => assertPayload(row, ['lesson_status', 'cancel_reason']));
    }
    if (c.action === 'update') {
        delete c.payload.update_mode;
        delete c.payload.mode;
    }
    const creates = c.action === 'create' ? [c.payload] : c.action === 'createBulk' ? c.payload.calendars : [];
    for (const row of creates)
        for (const k of ['reason', 'change_reason', 'send_notification', 'allow_past', 'course_end_time'])
            delete row[k];
    return c;
}
async function loadRows(tx, ids, deleted = false) {
    const rows = await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM calendar WHERE id IN (${client_1.Prisma.join(ids)}) ${deleted ? client_1.Prisma.empty : client_1.Prisma.sql `AND deleted_at IS NULL`} ORDER BY id`);
    if (rows.length !== ids.length)
        throw new ApiError_1.default('Có lịch không tồn tại hoặc không còn hợp lệ', 422);
    return rows;
}
async function buildPlan(tx, user, raw) {
    const command = normalizeCommand(raw), p = command.payload;
    let rows = [], codes = [], proposed = [], canceledOriginal = null;
    if (command.action === 'create' || command.action === 'createBulk' || command.action === 'import' && p.mode === 'create') {
        const reserved = new Map();
        const inputs = command.action === 'create' ? [p] : command.action === 'import' ? p.rows.map((r) => r.calendar) : p.calendars;
        for (const input of inputs) {
            if (input.session_id || input.sessionId) {
                const lesson = await tx.lessons.findUnique({ where: { id: BigInt(input.session_id || input.sessionId) } });
                if (!lesson || lesson.subject_code !== input.code)
                    throw new ApiError_1.default('Bài học phải thuộc đúng chương trình đề xuất', 422);
            }
            const { calendarData } = await livestream_service_1.approvalPreviewHelpers.prepareCreate(tx, { ...input }, reserved);
            const row = (0, calendar_approval_types_1.jsonValue)(calendarData);
            delete row.skip_teacher_user_sync;
            proposed.push({ ...row, package_lesson_mappings: command.action === 'import' ? p.rows[proposed.length].mappings || [] : input.package_lesson_mappings || [] });
            codes.push(calendarData.code);
            // Freeze occurrence numbers. A later request must not silently allocate another one.
            input.lesson_count = calendarData.lesson_count;
        }
    }
    else {
        const ids = command.action === 'import' ? p.rows.map((r) => (0, calendar_approval_types_1.positiveId)(r.id)) : command.action === 'swap' ? [(0, calendar_approval_types_1.positiveId)(p.first_id), (0, calendar_approval_types_1.positiveId)(p.second_id)] : command.action === 'updateBulk' ? [...new Set((p.ids || []).map(calendar_approval_types_1.positiveId))] : command.action === 'mapping' ? [...new Set((p.updates || []).map((v) => (0, calendar_approval_types_1.positiveId)(v.id)))] : [command.id];
        if (!ids.length || ids.length > 500)
            throw new ApiError_1.default('Chọn từ 1 đến 500 lịch mỗi yêu cầu', 422);
        if (command.action === 'updateBulk' && p.config_mode === 'separate') {
            const actual = (p.update_data || []).map((v) => (0, calendar_approval_types_1.positiveId)(v.id));
            if (actual.length !== ids.length || new Set(actual).size !== ids.length || actual.some((id) => !ids.includes(id)))
                throw new ApiError_1.default('Danh sách lịch cập nhật không khớp với các lịch đã chọn', 422);
        }
        rows = await loadRows(tx, ids, command.action === 'restore');
        codes = rows.map(r => r.code);
        if (command.action === 'reschedule' && p.source_state === 'canceled_without_makeup') {
            if (Number(rows[0].lesson_status) !== 1)
                throw new ApiError_1.default('Buổi học không ở trạng thái nghỉ', 422);
            const latest = await tx.calendar_change_logs.findFirst({ where: { calendar_id: rows[0].id, action: { notIn: ['delete', 'restore'] } }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
            if (!latest || latest.action !== 'cancel')
                throw new ApiError_1.default('Buổi nghỉ không còn đủ điều kiện tạo lịch bù', 422);
            canceledOriginal = latest.before_data?.source_session || rows[0];
        }
        if (command.action === 'reschedule' && p.new_session) {
            assertPayload(p.new_session, ['lesson_status']);
            if (p.new_session.code !== undefined && p.new_session.code !== rows[0].code || p.new_session.learn_number !== undefined && Number(p.new_session.learn_number) !== Number(rows[0].learn_number))
                throw new ApiError_1.default('Không được đổi chương trình hoặc bài học qua thao tác dời lịch', 422);
        }
        if (command.action === 'reschedule' && p.mode === 'following') {
            const current = rows[0];
            const following = await tx.calendar.findMany({ where: { code: current.code, system_type: current.system_type, start_time: { gt: current.start_time }, OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }] }, orderBy: [{ start_time: 'asc' }, { id: 'asc' }] });
            rows = [current, ...following];
            if (canceledOriginal && rows.length < 2)
                throw new ApiError_1.default("Không còn buổi tiếp theo để dời chuỗi", 422);
        }
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            let after = { ...(0, calendar_approval_types_1.jsonValue)(r) };
            if (command.action === 'import') {
                const item = p.rows.find((v) => Number(v.id) === Number(r.id));
                after = { ...after, ...item.data, ...(item.nextMappings !== undefined ? { package_lesson_mappings: item.nextMappings } : {}) };
            }
            else if (command.action === 'delete')
                after = null;
            else if (command.action === 'restore')
                after.deleted_at = null;
            else if (command.action === 'swap') {
                const other = rows.find(x => x.id !== r.id);
                const prefix = r.id === Number(p.first_id) ? 'first' : 'second';
                after.start_time = p[prefix + '_start_time'] || (0, calendar_approval_types_1.jsonValue)(other?.start_time);
                after.end_time = p[prefix + '_end_time'] || (0, calendar_approval_types_1.jsonValue)(other?.end_time);
            }
            else if (command.action === 'cancel' || command.action === 'reschedule') {
                const names = livestream_service_1.approvalPreviewHelpers.rescheduleNames(p);
                if (i === 0) {
                    after.lesson_status = 1;
                    after.cancel_reason = p.reason || p.change_reason;
                    after.lesson_name = names.canceledLessonName(r.lesson_name);
                }
                else
                    after = { ...after, ...(0, calendar_approval_types_1.jsonValue)(livestream_service_1.approvalPreviewHelpers.copySession(i === 1 && canceledOriginal ? canceledOriginal : rows[i - 1])), lesson_status: 0 };
            }
            else if (command.action === 'mapping')
                after.package_lesson_mappings = p.updates.find((x) => Number(x.id) === Number(r.id))?.package_lesson_mappings;
            else {
                let patch = command.action === 'update' ? p : p.config_mode === 'separate' ? p.update_data?.find((v) => Number(v.id) === Number(r.id)) : p.update_data;
                if (command.action === 'updateBulk' && ['cancel', 'makeup'].includes(p.operation)) {
                    after.lesson_status = 1;
                    after.cancel_reason = p.reason;
                }
                else {
                    patch = { ...(patch || {}) };
                    if (command.action === 'updateBulk') {
                        if (patch.start_date) {
                            for (const key of ['start_time', 'end_time'])
                                after[key] = patch.start_date + String(after[key]).slice(10);
                        }
                        for (const key of ['start_time', 'end_time'])
                            if (patch[key])
                                patch[key] = String(after[key]).slice(0, 10) + 'T' + patch[key] + ':00.000Z';
                    }
                    for (const [k, v] of Object.entries(patch))
                        if (WRITABLE.includes(k) && !['reason', 'change_reason', 'allow_past', 'send_notification'].includes(k))
                            after[k === 'room' ? 'channel_name' : k] = v;
                }
            }
            proposed.push(after);
        }
        if (command.action === 'reschedule' && p.mode !== 'cancel') {
            const source = p.mode === 'following' && rows.length > 1 ? rows[rows.length - 1] : canceledOriginal || rows[0];
            proposed.push({ ...(0, calendar_approval_types_1.jsonValue)(source), ...p.new_session, id: null, lesson_status: 0, deleted_at: null, lesson_name: p.mode === 'following' ? source.lesson_name : livestream_service_1.approvalPreviewHelpers.rescheduleNames(p).makeupLessonName(source.lesson_name) });
        }
    }
    codes = [...new Set([...codes, ...proposed.filter(Boolean).map(r => r.code).filter(Boolean)])].sort();
    const operation = (0, calendar_approval_types_1.commandOperation)(command), permission = (0, calendar_approval_types_1.operationPermission)(operation);
    (0, calendar_approval_access_1.assertScope)(user, permission, codes);
    if (command.action === 'import')
        (0, calendar_approval_access_1.assertScope)(user, p.mode === 'create' ? 'calendar.create' : 'calendar.update', codes);
    // Includes legacy request-only fields only after explicit normalization.
    const checkedFields = new Set();
    for (let i = 0; i < proposed.length; i++) {
        const after = proposed[i], before = rows[i] || null;
        let fields = changedFields(before, after).filter(k => !META.has(k) && !['deleted_at', 'key', 'package_lesson_mappings'].includes(k) && !(before === null && k === 'cancel_reason'));
        if (command.action === 'delete' || command.action === 'restore')
            fields = [];
        if (command.action === 'cancel' || command.action === 'reschedule')
            fields = fields.filter(k => !['cancel_reason', 'lesson_noti'].includes(k));
        if (fields.some(f => ['teacher', 'assistant_teacher'].includes(f)) && !(0, calendar_approval_access_1.hasPermission)(user, 'calendar.teacher.manage'))
            throw new ApiError_1.default('Không có quyền phân công giáo viên/trợ giảng', 403);
        const unchecked = fields.filter(f => !checkedFields.has(f));
        if (unchecked.length) {
            await field_permission_service_1.default.assertEditableFields(user.roleIds || [], 'calendar', unchecked);
            unchecked.forEach(f => checkedFields.add(f));
        }
        if (before && after && command.action === 'update' && (after.code !== before.code || Number(after.learn_number) !== Number(before.learn_number)))
            throw new ApiError_1.default('Không được thay đổi mã chương trình hoặc số bài', 422);
        if (after?.session_id) {
            const lesson = await tx.lessons.findUnique({ where: { id: BigInt(after.session_id) } });
            if (!lesson || lesson.subject_code !== after.code)
                throw new ApiError_1.default('Bài học không thuộc chương trình được phép thao tác', 422);
        }
        const changed = changedFields(before, after).filter(f => !['calendar_source'].includes(f));
        const mappingOnly = changed.every(f => f === 'package_lesson_mappings');
        const historicalCancelSource = !!canceledOriginal && i === 0;
        if (before && !mappingOnly && !historicalCancelSource && (before.live_ended_at || new Date(before.start_time) <= (0, dateTime_1.getVietnamWallClockDate)()))
            throw new ApiError_1.default('Buổi học đã bắt đầu hoặc đã kết thúc; không thể thay đổi lịch', 422);
        if (before && !historicalCancelSource && !['restore', 'mapping'].includes(command.action))
            livestream_service_1.approvalPreviewHelpers.assertModifiable(before, p);
        if (after?.start_time && after?.end_time && (!Number.isFinite(new Date(after.start_time).getTime()) || !Number.isFinite(new Date(after.end_time).getTime()) || new Date(after.end_time) <= new Date(after.start_time)))
            throw new ApiError_1.default('Giờ kết thúc phải sau giờ bắt đầu', 422);
    }
    // Canonical dependency snapshot deliberately includes all official schedules of
    // these programs, including mapping/lesson changes. Conservative stale detection.
    const base = await dependencies(tx, codes);
    return { command, operation, codes, before: (0, calendar_approval_types_1.jsonValue)(rows), proposed: (0, calendar_approval_types_1.jsonValue)(proposed), hash: (0, calendar_approval_types_1.fingerprint)(base) };
}
async function dependencies(tx, codes) {
    if (!codes.length)
        throw new ApiError_1.default('Không xác định được chương trình', 422);
    const rows = await tx.$queryRaw(client_1.Prisma.sql `SELECT * FROM calendar WHERE code IN (${client_1.Prisma.join(codes)}) ORDER BY id`);
    const keys = rows.map((r) => r.key).filter(Boolean);
    const mappings = keys.length ? await tx.package_lesson_mapping.findMany({ where: { key: { in: keys } }, orderBy: { id: 'asc' } }) : [];
    const lessons = await tx.lessons.findMany({ where: { subject_code: { in: codes } }, orderBy: { id: 'asc' } });
    return (0, calendar_approval_types_1.jsonValue)({ rows: rows.map(snapshot), mappings, lessons });
}
