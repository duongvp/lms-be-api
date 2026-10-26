import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import { calendarSourceFromCode } from './calendar-source';
import { logger } from '../../utils/logger';

type Tx = Prisma.TransactionClient;
type QueueState = { id: number; status: number | null };
type CanceledCalendar = {
  id: number; key: string | null; code: string | null;
  lesson_status: number | null; lesson_noti: string | null;
};

// status=4 belongs to the LMS prerequisite gate. Neither the old nor the new
// HMO consumer may send it until the latest create for the key is successful.
const lockCalendar = async (tx: Tx, id: number) => {
  const rows = await tx.$queryRaw<CanceledCalendar[]>`
    SELECT id, \`key\`, code, lesson_status, lesson_noti
    FROM calendar WHERE id = ${id} FOR UPDATE
  `;
  return rows[0];
};

const latestCreate = async (tx: Tx, key: string) => {
  const rows = await tx.$queryRaw<QueueState[]>`
    SELECT id, status FROM hocmai_sync_queue
    WHERE c_key = ${key} AND action = 'create'
    ORDER BY id DESC LIMIT 1
  `;
  return rows[0];
};

export const retryCanceledStatusInTransaction = async (tx: Tx, id: number) => {
  // Serialize double clicks and the prerequisite gate on the same calendar.
  const calendar = await lockCalendar(tx, id);
  if (!calendar) throw new ApiError('Không tìm thấy lịch học', 404);
  if (Number(calendar.lesson_status) !== 1) throw new ApiError('Chỉ đồng bộ lại trạng thái cho lịch đã nghỉ học', 400);
  if (calendarSourceFromCode(calendar.code) === 'feed') throw new ApiError('Lịch Feed không đồng bộ trạng thái sang HMO', 400);
  const key = String(calendar.key || '').trim();
  if (!key) throw new ApiError('Lịch nghỉ chưa có Key để đồng bộ HMO', 400);

  const active = await tx.$queryRaw<QueueState[]>`
    SELECT id, status FROM hocmai_sync_queue
    WHERE c_key = ${key} AND action = 'update-status-lesson'
      AND status IN (0, 3, 4)
    ORDER BY id DESC LIMIT 1
  `;
  if (active[0]) {
    if (active[0].status === 4 && (await latestCreate(tx, key))?.status === 2) {
      throw new ApiError('Yêu cầu tạo lịch HMO đang thất bại. Cần xử lý tạo lịch trước khi đồng bộ trạng thái nghỉ.', 409);
    }
    return {
      state: active[0].status === 4 ? 'waiting_create' as const : 'pending' as const,
      queued: false, queue_id: active[0].id,
    };
  }

  const latest = await tx.$queryRaw<QueueState[]>`
    SELECT id, status FROM hocmai_sync_queue
    WHERE c_key = ${key} AND action = 'update-status-lesson'
    ORDER BY id DESC LIMIT 1
  `;
  if (latest[0]?.status === 1) return { state: 'already_synced' as const, queued: false, queue_id: latest[0].id };

  const created = await latestCreate(tx, key);
  if (!created) throw new ApiError('Chưa có yêu cầu tạo lịch HMO cho Key này. Cần kiểm tra lịch trên HMO trước khi gửi trạng thái nghỉ.', 409);
  if (created.status === 2) throw new ApiError('Yêu cầu tạo lịch HMO đang thất bại. Cần xử lý tạo lịch trước khi đồng bộ trạng thái nghỉ.', 409);
  const ready = created.status === 1;
  const operationId = crypto.randomUUID();
  const payload = JSON.stringify({
    c_key: key, status: '1', notify: calendar.lesson_noti, target: 'https://hocmai.vn',
    ...(!ready ? { _lms_create_queue_id: created.id } : {}),
  });
  // A new operation avoids depending on the historical failed status job.
  // Never reset/replay that job or the already-successful create/update jobs.
  await tx.hocmai_sync_queue.create({ data: {
    c_key: key, action: 'update-status-lesson', payload,
    status: ready ? 0 : 4, operation_id: operationId, sequence_no: 1,
  } });
  return { state: ready ? 'queued' as const : 'waiting_create' as const, queued: true, operation_id: operationId };
};

export const retryCanceledCalendarStatus = async (rawId: unknown, client = prisma) => {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError('ID lịch học không hợp lệ', 400);
  return client.$transaction(tx => retryCanceledStatusInTransaction(tx, id), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000, timeout: 15_000,
  });
};

export const releaseCanceledStatusInTransaction = async (tx: Tx, queueId: number, calendarId: number) => {
  const calendar = await lockCalendar(tx, calendarId);
  if (!calendar || Number(calendar.lesson_status) !== 1 || calendarSourceFromCode(calendar.code) === 'feed') return false;
  const key = String(calendar.key || '');
  const waiting = await tx.$queryRaw<Array<{ id: number; payload: string; operation_id: string | null }>>`
    SELECT id, payload, operation_id FROM hocmai_sync_queue
    WHERE id = ${queueId} AND c_key = ${key}
      AND action = 'update-status-lesson' AND status = 4
  `;
  if (!waiting[0]) return false;
  const pending = waiting[0];
  const reference = Number(JSON.parse(pending.payload)._lms_create_queue_id);
  // Use the primary key for manual retry gates, and the existing operation
  // index for reschedules. Avoid scanning queue history for every gate tick.
  const creates = Number.isSafeInteger(reference) && reference > 0
    ? await tx.$queryRaw<QueueState[]>`
        SELECT id, status FROM hocmai_sync_queue
        WHERE id = ${reference} AND c_key = ${key} AND action = 'create'
      `
    : await tx.$queryRaw<QueueState[]>`
        SELECT id, status FROM hocmai_sync_queue
        WHERE operation_id = ${pending.operation_id} AND c_key = ${key} AND action = 'create'
        ORDER BY id DESC LIMIT 1
      `;
  const created = creates[0];
  if (created?.status !== 1) return false;
  const active = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM hocmai_sync_queue
    WHERE c_key = ${key} AND action = 'update-status-lesson' AND status IN (0, 3)
    LIMIT 1
  `;
  if (active[0]) return false;
  // No calendar mutation: its business status remains canceled throughout.
  // Refresh only the unsent payload, then make it visible to the HMO consumer.
  const payload = JSON.stringify({ c_key: key, status: '1', notify: calendar.lesson_noti, target: 'https://hocmai.vn' });
  const changed = await tx.$executeRaw`
    UPDATE hocmai_sync_queue SET status = 0, payload = ${payload}, last_error = NULL
    WHERE id = ${queueId} AND status = 4
  `;
  return changed === 1;
};

const GATE_RUN_BUDGET_MS = 5_000;

export const releaseReadyCanceledStatuses = async (
  client = prisma,
  options: { now?: () => number } = {}
) => {
  // Monotonic time; never abandon an in-flight transaction to meet a deadline.
  // The budget stops starting new transactions, not an existing DB operation.
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  // Filter prerequisites and conflicting active requests BEFORE LIMIT. Rows
  // blocked on another consumer must not occupy all 100 candidate positions.
  // The transaction still rechecks both conditions under the calendar lock.
  const candidates = await client.$queryRaw<Array<{ queue_id: number; calendar_id: number }>>`
    SELECT q.id AS queue_id, c.id AS calendar_id
    FROM hocmai_sync_queue AS q
    JOIN calendar AS c ON c.\`key\` = q.c_key AND c.lesson_status = 1
    JOIN hocmai_sync_queue AS created ON created.id = COALESCE(
      CAST(JSON_UNQUOTE(JSON_EXTRACT(
        CASE WHEN JSON_VALID(q.payload) THEN q.payload ELSE '{}' END,
        '$._lms_create_queue_id'
      )) AS UNSIGNED),
      (SELECT MAX(source.id) FROM hocmai_sync_queue AS source
       WHERE source.operation_id = q.operation_id AND source.c_key = q.c_key AND source.action = 'create')
    ) AND created.c_key = q.c_key AND created.action = 'create' AND created.status = 1
    WHERE q.status = 4 AND q.action = 'update-status-lesson'
      AND JSON_VALID(q.payload)
      AND LOWER(COALESCE(c.code, '')) NOT LIKE 'feed-%'
      AND NOT EXISTS (
        SELECT 1 FROM hocmai_sync_queue AS active
        WHERE active.c_key = q.c_key AND active.action = 'update-status-lesson'
          AND active.status IN (0, 3)
      )
    ORDER BY q.created_at ASC, q.id ASC LIMIT 100
  `;
  let checked = 0;
  let released = 0;
  let failed = 0;
  for (const row of candidates) {
    if (now() - startedAt >= GATE_RUN_BUDGET_MS) break;
    checked++;
    try {
      const changed = await client.$transaction(
        tx => releaseCanceledStatusInTransaction(tx, row.queue_id, row.calendar_id),
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 15_000 }
      );
      if (changed) released++;
    } catch (error) {
      failed++;
      logger.error('[HmoCanceledStatus] Không thể mở yêu cầu đang chờ:', row.queue_id, error);
    }
  }
  return {
    selected: candidates.length, checked, released, failed,
    deferred: candidates.length - checked,
  };
};
