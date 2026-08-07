"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueRescheduleSync = exports.withManualHocmaiQueue = exports.enqueueCalendarSync = void 0;
const crypto_1 = __importDefault(require("crypto"));
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
const enqueueStatus = async (tx, operationId, sequenceNo, session) => {
    const calendar = await loadCalendarForSync(tx, Number(session.id));
    const key = String(calendar.key || '');
    if (!key)
        throw new Error('Lịch học không có key để tạo queue HMO');
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
};
const enqueueCalendar = async (tx, operationId, sequenceNo, action, session) => {
    const calendar = await loadCalendarForSync(tx, Number(session.id));
    const key = String(calendar.key || '');
    if (!key)
        throw new Error('Lịch học không có key để tạo queue HMO');
    const mappings = await loadPackagesForKey(tx, key);
    await insertQueue(tx, {
        operationId,
        sequenceNo,
        key,
        action,
        payload: {
            c_key: key,
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
        },
    });
};
exports.enqueueCalendarSync = enqueueCalendar;
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
        await tx.$executeRawUnsafe(`SET ${MANUAL_QUEUE_SESSION_VARIABLE} = 0`);
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
