import crypto from 'crypto';
import { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;
type RescheduleAction = 'cancel' | 'makeup' | 'following';

type RescheduleResult = {
  canceled_session?: any;
  shifted_sessions?: any[];
  created_session?: any;
};

const MANUAL_QUEUE_SESSION_VARIABLE = '@lms_manual_hocmai_queue';

const parseDocuments = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadCalendarForSync = async (
  tx: TransactionClient,
  calendarId: number
) => {
  const rows = await tx.$queryRaw<any[]>`
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

const loadPackagesForKey = async (
  tx: TransactionClient,
  key: string
) => tx.$queryRaw<any[]>`
  SELECT package_id, lesson_id
  FROM package_lesson_mapping
  WHERE \`key\` = ${key}
  ORDER BY id ASC
`;

const insertQueue = async (
  tx: TransactionClient,
  input: {
    operationId: string;
    sequenceNo: number;
    key: string;
    action: string;
    payload: unknown;
  }
) => {
  await tx.$executeRaw`
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

const enqueueStatus = async (
  tx: TransactionClient,
  operationId: string,
  sequenceNo: number,
  session: any
) => {
  const calendar = await loadCalendarForSync(tx, Number(session.id));
  const key = String(calendar.key || '');
  if (!key) throw new Error('Lịch học không có key để tạo queue HMO');

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

const enqueueCalendar = async (
  tx: TransactionClient,
  operationId: string,
  sequenceNo: number,
  action: 'update' | 'create',
  session: any
) => {
  const calendar = await loadCalendarForSync(tx, Number(session.id));
  const key = String(calendar.key || '');
  if (!key) throw new Error('Lịch học không có key để tạo queue HMO');

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

/**
 * Các trigger calendar vẫn tạo queue cho CRUD thông thường. Riêng nghiệp vụ
 * dời lịch cần một outbox có thứ tự nên trigger được tạm bỏ qua trên đúng
 * connection của transaction này, sau đó service ghi queue một lần duy nhất.
 */
export const withManualHocmaiQueue = async <T>(
  tx: TransactionClient,
  operation: () => Promise<T>
): Promise<T> => {
  await tx.$executeRawUnsafe(`SET ${MANUAL_QUEUE_SESSION_VARIABLE} = 1`);
  try {
    return await operation();
  } finally {
    await tx.$executeRawUnsafe(`SET ${MANUAL_QUEUE_SESSION_VARIABLE} = 0`);
  }
};

export const enqueueRescheduleSync = async (
  tx: TransactionClient,
  action: RescheduleAction,
  result: RescheduleResult,
  operationId = crypto.randomUUID()
) => {
  let sequenceNo = 1;

  const canceledSession = action === 'cancel'
    ? result
    : result.canceled_session;

  if (!canceledSession) {
    throw new Error('Thiếu lịch nghỉ để tạo queue dời lịch HMO');
  }

  await enqueueStatus(tx, operationId, sequenceNo++, canceledSession);

  if (action === 'following') {
    for (const shiftedSession of result.shifted_sessions || []) {
      await enqueueCalendar(
        tx,
        operationId,
        sequenceNo++,
        'update',
        shiftedSession
      );
    }
  }

  if (action !== 'cancel') {
    if (!result.created_session) {
      throw new Error('Thiếu lịch mới để tạo queue dời lịch HMO');
    }
    await enqueueCalendar(
      tx,
      operationId,
      sequenceNo,
      'create',
      result.created_session
    );
  }

  return operationId;
};
