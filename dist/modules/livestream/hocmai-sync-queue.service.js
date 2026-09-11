"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueRescheduleSync = exports.withManualHocmaiQueue = exports.enqueueCalendarsSyncBulk = exports.reconcileCalendarMappingsAndEnqueue = exports.enqueueCalendarSync = void 0;
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const MANUAL_QUEUE_SESSION_VARIABLE = '@lms_manual_hocmai_queue';
const parseDocuments = (value) => {
    if (!value)
        return [];
    if (Array.isArray(value))
        return value;
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
};
const loadCalendarForSync = async (tx, calendarId) => {
    const rows = await tx.$queryRaw `
    SELECT
      id,
      \`key\`,
      code,
      subject,
      DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time,
      DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
      teacher,
      lesson_name,
      learn_number,
      lesson_status,
      lesson_document,
      lesson_noti
    FROM calendar
    WHERE id = ${calendarId}
    LIMIT 1
  `;
    if (!rows[0]) {
        throw new Error(`Không tìm thấy lịch học ${calendarId} để tạo queue HMO`);
    }
    return rows[0];
};
const loadPackagesForKey = async (tx, key) => tx.$queryRaw `
  SELECT package_id, lesson_id
  FROM package_lesson_mapping
  WHERE \`key\` = ${key}
  ORDER BY id ASC
`;
const insertQueue = async (tx, input) => {
    await tx.$executeRaw `
    INSERT INTO hocmai_sync_queue (
      c_key,
      action,
      payload,
      status,
      operation_id,
      sequence_no
    ) VALUES (
      ${input.key},
      ${input.action},
      ${JSON.stringify(input.payload)},
      0,
      ${input.operationId},
      ${input.sequenceNo}
    )
  `;
};
const buildCalendarPayload = (calendar, mappings, action) => ({
    c_key: String(calendar.key || ''),
    code: calendar.code || '',
    action,
    subject: calendar.subject || '',
    start_time: calendar.start_time || '',
    end_time: calendar.end_time || '',
    teacher_name: calendar.teacher || '',
    title: calendar.lesson_name || '',
    learn_number: calendar.learn_number ?? 0,
    lesson_status: calendar.lesson_status ?? 0,
    documents: parseDocuments(calendar.lesson_document),
    lesson_noti: calendar.lesson_noti || '',
    packages: mappings.map((mapping) => ({
        package_id: String(mapping.package_id),
        lesson_id: String(mapping.lesson_id),
    })),
});
const enqueueStatus = async (tx, operationId, sequenceNo, session) => {
    const calendar = await loadCalendarForSync(tx, Number(session.id));
    const key = String(calendar.key || '');
    if (!key)
        throw new Error('Lịch học không có key để tạo queue HMO');
    const mappings = await loadPackagesForKey(tx, key);
    if (!mappings.length)
        return false;
    await insertQueue(tx, {
        operationId,
        sequenceNo,
        key,
        action: 'update-status-lesson',
        payload: {
            c_key: key,
            status: String(calendar.lesson_status ?? 0),
            notify: calendar.lesson_noti,
            target: 'https://hocmai.vn',
        },
    });
    return true;
};
const enqueueCalendar = async (tx, operationId, sequenceNo, action, session) => {
    const calendar = await loadCalendarForSync(tx, Number(session.id));
    const key = String(calendar.key || '');
    if (!key)
        throw new Error('Lịch học không có key để tạo queue HMO');
    const mappings = await loadPackagesForKey(tx, key);
    // Calendar được phép tồn tại trước khi BA gán section lesson_id bên HMO.
    // Không tạo một job chắc chắn lỗi/đẩy packages rỗng trong trạng thái này.
    if (!mappings.length)
        return false;
    await insertQueue(tx, {
        operationId,
        sequenceNo,
        key,
        action,
        payload: buildCalendarPayload(calendar, mappings, action),
    });
    return true;
};
exports.enqueueCalendarSync = enqueueCalendar;
/**
 * Đồng bộ mapping của một lịch theo trạng thái HMO mới nhất mà không xóa/tạo
 * lại toàn bộ. Trigger DB (nếu có) được giữ nguyên; khi thực sự có thay đổi,
 * service luôn thêm một queue update đầy đủ sau cùng.
 */
const reconcileCalendarMappingsAndEnqueue = async (tx, calendar, desiredMappings, operationId = crypto_1.default.randomUUID(), sequenceNo = 1, enqueueFullPayload = true, allowEmptyDesiredMappings = false) => {
    const calendarId = Number(calendar?.id ?? calendar?.calendar_id);
    if (!Number.isInteger(calendarId) || calendarId <= 0) {
        throw new Error('Không xác định được ID lịch học để đồng bộ mapping HMO');
    }
    const programCode = String(calendar?.code ?? calendar?.program_code ?? calendar?.subject_code ?? '').trim();
    if (!programCode || programCode === 'undefined' || programCode === 'null') {
        throw new Error(`Lịch ${calendarId} không xác định được mã chương trình để đồng bộ mapping HMO`);
    }
    const learnNumber = Number(calendar?.learn_number);
    if (!Number.isInteger(learnNumber) || learnNumber <= 0) {
        throw new Error(`Lịch ${calendarId} không xác định được số bài để đồng bộ mapping HMO`);
    }
    const normalizedCalendar = {
        ...calendar,
        id: calendarId,
        code: programCode,
    };
    const key = String(calendar?.key || '').trim();
    if (!key)
        throw new Error(`Lịch ${calendarId} chưa có key để đồng bộ mapping HMO`);
    if (!desiredMappings.length && !allowEmptyDesiredMappings) {
        throw new Error(`Lịch ${calendarId} không có mapping HMO hợp lệ; mapping hiện tại được giữ nguyên`);
    }
    const desiredByPair = new Map();
    desiredMappings.forEach((raw) => {
        const mapping = {
            package_id: String(raw.package_id || '').trim(),
            course_id: String(raw.course_id || '').trim(),
            lesson_id: String(raw.lesson_id || '').trim(),
        };
        if (!mapping.package_id || !mapping.course_id || !mapping.lesson_id) {
            throw new Error(`Lịch ${calendarId} có mapping HMO không đầy đủ`);
        }
        const pairKey = `${mapping.package_id}::${mapping.course_id}`;
        const previous = desiredByPair.get(pairKey);
        if (previous && previous.lesson_id !== mapping.lesson_id) {
            throw new Error(`Lịch ${calendarId} có nhiều Lesson ID cho Package ${mapping.package_id} / Course ${mapping.course_id}`);
        }
        desiredByPair.set(pairKey, mapping);
    });
    const current = await tx.package_lesson_mapping.findMany({
        where: { key },
        orderBy: { id: 'asc' },
    });
    const currentByPair = new Map();
    current.forEach((mapping) => {
        const pairKey = `${String(mapping.package_id)}::${String(mapping.course_id || '')}`;
        currentByPair.set(pairKey, [...(currentByPair.get(pairKey) || []), mapping]);
    });
    const retainedByPair = new Map();
    desiredByPair.forEach((desired, pairKey) => {
        const candidates = currentByPair.get(pairKey) || [];
        const retained = candidates.find((item) => String(item.lesson_id) === desired.lesson_id)
            || candidates[0];
        if (retained)
            retainedByPair.set(pairKey, retained);
    });
    const retainedIds = new Set(Array.from(retainedByPair.values()).map((item) => item.id));
    const deleteIds = current.filter((item) => !retainedIds.has(item.id)).map((item) => item.id);
    let changed = deleteIds.length > 0;
    if (deleteIds.length) {
        await tx.package_lesson_mapping.deleteMany({ where: { id: { in: deleteIds } } });
    }
    for (const [pairKey, desired] of desiredByPair) {
        const retained = retainedByPair.get(pairKey);
        if (!retained) {
            await tx.package_lesson_mapping.create({
                data: {
                    ...desired,
                    key,
                    code: programCode,
                    learn_number: learnNumber,
                },
            });
            changed = true;
            continue;
        }
        if (String(retained.lesson_id) !== desired.lesson_id
            || String(retained.code) !== programCode
            || Number(retained.learn_number) !== learnNumber) {
            await tx.package_lesson_mapping.update({
                where: { id: retained.id },
                data: {
                    lesson_id: desired.lesson_id,
                    code: programCode,
                    learn_number: learnNumber,
                },
            });
            changed = true;
        }
    }
    if (changed && enqueueFullPayload) {
        await enqueueCalendar(tx, operationId, sequenceNo, 'update', normalizedCalendar);
    }
    return { changed, operationId };
};
exports.reconcileCalendarMappingsAndEnqueue = reconcileCalendarMappingsAndEnqueue;
/**
 * Tạo lại queue từ ảnh chụp dữ liệu calendar hiện tại. Hàm chỉ đọc calendar /
 * mapping và INSERT hocmai_sync_queue, không ghi hay chạm updated_at calendar.
 */
const enqueueCalendarsSyncBulk = async (tx, calendarIds, operationId = crypto_1.default.randomUUID()) => {
    const ids = Array.from(new Set(calendarIds));
    if (!ids.length)
        return { operationId, queuedIds: [], skippedIds: [], missingIds: [] };
    const calendars = await tx.$queryRaw(client_1.Prisma.sql `
    SELECT
      id,
      \`key\`,
      code,
      subject,
      DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time,
      DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
      teacher,
      lesson_name,
      learn_number,
      lesson_status,
      lesson_document,
      lesson_noti
    FROM calendar
    WHERE id IN (${client_1.Prisma.join(ids)})
  `);
    const keys = calendars.map((calendar) => String(calendar.key || '')).filter(Boolean);
    const mappings = keys.length
        ? await tx.package_lesson_mapping.findMany({
            where: { key: { in: keys } },
            select: { key: true, package_id: true, lesson_id: true, id: true },
            orderBy: { id: 'asc' },
        })
        : [];
    const mappingsByKey = new Map();
    mappings.forEach((mapping) => {
        const key = String(mapping.key || '');
        const current = mappingsByKey.get(key) || [];
        current.push({ package_id: mapping.package_id, lesson_id: mapping.lesson_id });
        mappingsByKey.set(key, current);
    });
    const queuedIds = [];
    const skippedIds = [];
    const rows = [];
    calendars.forEach((calendar) => {
        const id = Number(calendar.id);
        const key = String(calendar.key || '');
        const calendarMappings = mappingsByKey.get(key) || [];
        if (!key || !calendarMappings.length) {
            skippedIds.push(id);
            return;
        }
        queuedIds.push(id);
        rows.push({
            c_key: key,
            action: 'update',
            payload: JSON.stringify(buildCalendarPayload(calendar, calendarMappings, 'update')),
            status: 0,
            operation_id: operationId,
            sequence_no: rows.length + 1,
        });
    });
    if (rows.length)
        await tx.hocmai_sync_queue.createMany({ data: rows });
    const foundIds = new Set(calendars.map((calendar) => Number(calendar.id)));
    return {
        operationId,
        queuedIds,
        skippedIds,
        missingIds: ids.filter((id) => !foundIds.has(id)),
    };
};
exports.enqueueCalendarsSyncBulk = enqueueCalendarsSyncBulk;
/**
 * Các trigger calendar vẫn tạo queue cho CRUD thông thường. Riêng nghiệp vụ
 * dời lịch cần một outbox có thứ tự nên trigger được tạm bỏ qua trên đúng
 * connection của transaction này, sau đó service ghi queue một lần duy nhất.
 */
const withManualHocmaiQueue = async (tx, operation) => {
    await tx.$executeRawUnsafe(`SET ${MANUAL_QUEUE_SESSION_VARIABLE} = 1`);
    try {
        return await operation();
    }
    finally {
        try {
            await tx.$executeRawUnsafe(`SET ${MANUAL_QUEUE_SESSION_VARIABLE} = 0`);
        }
        catch (error) {
            // Khi transaction đã timeout/đóng, connection cũng không còn được tái sử dụng
            // trong transaction này. Không để câu SET dọn session che mất lỗi nghiệp vụ gốc.
            if (error?.code !== 'P2028')
                throw error;
        }
    }
};
exports.withManualHocmaiQueue = withManualHocmaiQueue;
const enqueueRescheduleSync = async (tx, action, result, operationId = crypto_1.default.randomUUID()) => {
    let sequenceNo = 1;
    const canceledSession = action === 'cancel'
        ? result
        : result.canceled_session;
    if (!canceledSession) {
        throw new Error('Thiếu lịch nghỉ để tạo queue dời lịch HMO');
    }
    if (action === 'following' || action === 'makeup') {
        // K1 được chuyển sang slot sau/lịch bù; row nghỉ dùng K1_huy là một key
        // hoàn toàn mới trên HMO, nên create bản ghi nghỉ rồi update lại K1.
        await enqueueCalendar(tx, operationId, sequenceNo++, 'create', canceledSession);
        if (action === 'following') {
            for (const shiftedSession of result.shifted_sessions || []) {
                await enqueueCalendar(tx, operationId, sequenceNo++, 'update', shiftedSession);
            }
        }
        if (!result.created_session) {
            throw new Error('Thiếu lịch mới để tạo queue dời lịch HMO');
        }
        await enqueueCalendar(tx, operationId, sequenceNo, 'update', result.created_session);
        return operationId;
    }
    await enqueueStatus(tx, operationId, sequenceNo++, canceledSession);
    if (action !== 'cancel') {
        if (!result.created_session) {
            throw new Error('Thiếu lịch mới để tạo queue dời lịch HMO');
        }
        await enqueueCalendar(tx, operationId, sequenceNo, 'create', result.created_session);
    }
    return operationId;
};
exports.enqueueRescheduleSync = enqueueRescheduleSync;
