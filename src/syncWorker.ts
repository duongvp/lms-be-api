// import axios from 'axios';
// import prisma from './prisma';

// interface QueueDatabase {
//   query<T>(sql: string, ...values: unknown[]): Promise<T>;
//   execute(sql: string, ...values: unknown[]): Promise<number>;
// }

// interface QueueJob {
//   id: number;
//   c_key: string;
//   action: string;
//   payload: string | Record<string, unknown>;
//   operation_id: string | null;
//   sequence_no: number | null;
// }

// interface ApiResponse {
//   status: number;
//   data: { status?: unknown; message?: unknown } | null;
// }

// interface OrderedDependencies {
//   db: QueueDatabase;
//   post(endpoint: 'store' | 'change-status', payload: unknown): Promise<ApiResponse>;
//   sleep?: (ms: number) => Promise<void>;
//   log?: (event: Record<string, unknown>) => void;
// }

// // Deliberately finite and in-process: never automatically replay status=2/3
// // after a restart, since the remote write/notification may already have happened.
// const STATUS_RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;

// const PREDECESSOR_BLOCKS = `
//   SELECT 1 FROM hocmai_sync_queue AS previous
//   WHERE previous.operation_id = q.operation_id
//     AND previous.id <> q.id
//     AND (previous.sequence_no IS NULL OR previous.sequence_no <= q.sequence_no)
//     AND COALESCE(previous.status, -1) <> 1
// `;

// const SELECT_READY_ORDERED = `
//   SELECT q.id, q.c_key, q.action, q.payload, q.operation_id, q.sequence_no
//   FROM hocmai_sync_queue AS q
//   WHERE q.status = 0 AND q.operation_id IS NOT NULL
//     AND q.sequence_no IS NOT NULL AND q.sequence_no > 0
//     AND NOT EXISTS (${PREDECESSOR_BLOCKS})
//   ORDER BY q.created_at ASC, q.id ASC
//   LIMIT ?
// `;

// /** Compare-and-set claim works across processes without a schema change.
//  * All consumers must use this claim; an old worker can bypass it.
//  */
// async function claimJobs<T extends { id: number }>(db: QueueDatabase, candidates: T[]): Promise<T[]> {
//   const claimed: T[] = [];
//   for (const job of candidates) {
//     const changed = await db.execute(
//       'UPDATE hocmai_sync_queue SET status = 3 WHERE id = ? AND status = 0', job.id
//     );
//     if (changed === 1) claimed.push(job);
//   }
//   return claimed;
// }

// function createNonOverlappingRunner(run: () => Promise<unknown>): () => Promise<void> {
//   let running = false;
//   return async () => {
//     if (running) return;
//     running = true;
//     try { await run(); } finally { running = false; }
//   };
// }

// function parsePayload(job: QueueJob): Record<string, unknown> {
//   const parsed = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
//   if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
//     throw new Error('Payload must be an object');
//   }
//   if (!job.c_key || parsed.c_key !== job.c_key) {
//     throw new Error('Payload c_key does not match queue c_key');
//   }
//   if (job.action === 'create' || job.action === 'update') {
//     // Ordered outbox carries a snapshot. Never replace it with mutable live
//     // calendar/mapping data after a reschedule changed the original key.
//     if (!parsed.subject || !parsed.start_time || !parsed.end_time
//       || !Array.isArray(parsed.packages) || parsed.packages.length === 0) {
//       throw new Error('Ordered calendar payload is incomplete');
//     }
//     for (const item of parsed.packages) {
//       if (!item || typeof item !== 'object') throw new Error('Invalid package mapping');
//       const mapping = item as Record<string, unknown>;
//       if (!/^\d+$/.test(String(mapping.package_id)) || !/^\d+$/.test(String(mapping.lesson_id))
//         || !Number.isSafeInteger(Number(mapping.package_id)) || Number(mapping.package_id) <= 0
//         || !Number.isSafeInteger(Number(mapping.lesson_id)) || Number(mapping.lesson_id) <= 0) {
//         throw new Error('Invalid package/lesson ID');
//       }
//     }
//   } else if (job.action === 'update-status-lesson') {
//     if (parsed.status !== '1' && parsed.status !== 1 && parsed.status !== '0' && parsed.status !== 0) {
//       throw new Error('Invalid lesson status');
//     }
//   } else {
//     throw new Error(`Unsupported ordered action: ${job.action}`);
//   }
//   return parsed;
// }

// function isSuccess(job: QueueJob, response: ApiResponse): boolean {
//   return response.status === 200 && !!response.data && (
//     response.data.status === 'success' || response.data.status === 200
//     || (job.action === 'update-status-lesson' && response.data.status === true)
//   );
// }

// function messageOf(response: ApiResponse): string {
//   return typeof response.data?.message === 'string' ? response.data.message : 'Hocmai error';
// }

// async function hasSuccessfulCreate(db: QueueDatabase, job: QueueJob): Promise<boolean> {
//   const rows = await db.query<Array<{ id: number }>>(`
//     SELECT id FROM hocmai_sync_queue
//     WHERE operation_id = ? AND c_key = ? AND action = 'create'
//       AND status = 1 AND sequence_no < ?
//     LIMIT 1
//   `, job.operation_id, job.c_key, job.sequence_no);
//   return rows.length > 0;
// }

// async function fail(db: QueueDatabase, job: QueueJob, message: string) {
//   const changed = await db.execute(
//     'UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ? AND status = 3',
//     message, job.id
//   );
//   if (changed !== 1) throw new Error(`Could not record failure for claimed job ${job.id}; review ownership/result`);
// }

// async function processOrderedJob(deps: OrderedDependencies, job: QueueJob): Promise<void> {
//   const emit = (event: string, details: Record<string, unknown> = {}) => deps.log?.({
//     event, job_id: job.id, operation_id: job.operation_id,
//     sequence_no: job.sequence_no, action: job.action, c_key: job.c_key, ...details,
//   });
//   let payload: Record<string, unknown>;
//   try {
//     payload = parsePayload(job);
//   } catch (error) {
//     await fail(deps.db, job, `Invalid payload: ${(error as Error).message}`);
//     emit('invalid_payload');
//     return;
//   }

//   const endpoint = job.action === 'update-status-lesson' ? 'change-status' : 'store';
//   const body = endpoint === 'store' ? [{
//     ...payload, action: job.action, c_key: job.c_key,
//     packages: (payload.packages as Array<Record<string, unknown>>).map(mapping => ({
//       package_id: Number(mapping.package_id), lesson_id: Number(mapping.lesson_id),
//     })),
//   }] : payload;
//   const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
//   // A successful predecessor is immutable in normal worker processing. Cache
//   // this check for this job only, not across jobs, cycles or process restarts.
//   let successfulCreate: boolean | undefined;

//   for (let attempt = 0; ; attempt++) {
//     emit('request_started', { attempt: attempt + 1, at: new Date().toISOString() });
//     let response: ApiResponse;
//     try {
//       response = await deps.post(endpoint, body);
//     } catch (error) {
//       // Timeout, disconnect and HTTP errors can hide a completed remote write.
//       // Do not retry automatically, especially for notifications.
//       await fail(deps.db, job, `Remote result requires review (attempt ${attempt + 1}): ${(error as Error).message}`);
//       emit('remote_result_unknown', { attempt: attempt + 1 });
//       return;
//     }
//     emit('response_received', {
//       attempt: attempt + 1, http_status: response.status,
//       api_status: response.data?.status, message: response.data?.message,
//       at: new Date().toISOString(),
//     });

//     if (isSuccess(job, response)) {
//       // Keep persistence separate from the HTTP try/catch. If this write fails,
//       // leave status=3 for review; never misclassify it as a retryable API error.
//       const changed = await deps.db.execute(
//         'UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id = ? AND status = 3',
//         job.id
//       );
//       if (changed !== 1) throw new Error(`Remote succeeded but local completion was not recorded for job ${job.id}; reconcile before replay`);
//       emit('succeeded', { attempt: attempt + 1 });
//       return;
//     }

//     const message = messageOf(response);
//     const delay = STATUS_RETRY_DELAYS_MS[attempt];
//     // Only an explicit business rejection saying no calendar exists is retried.
//     // An HTTP 5xx with the same text still has an ambiguous outcome.
//     if (response.status === 200 && job.action === 'update-status-lesson'
//       && String(payload.status) === '1' && message.trim() === 'Calendar không tồn tại'
//       && delay !== undefined) {
//       successfulCreate ??= await hasSuccessfulCreate(deps.db, job);
//       if (successfulCreate) {
//         const changed = await deps.db.execute(
//           'UPDATE hocmai_sync_queue SET last_error = ? WHERE id = ? AND status = 3',
//           `Retry ${attempt + 1}/3 in ${delay}ms: ${message}`, job.id
//         );
//         if (changed !== 1) throw new Error(`Could not record retry for claimed job ${job.id}; stop before resending`);
//         emit('retry_scheduled', { retry: attempt + 1, delay_ms: delay });
//         await sleep(delay);
//         continue;
//       }
//     }
//     await fail(deps.db, job, `${message} (attempts: ${attempt + 1})`);
//     emit('failed', { attempts: attempt + 1, message });
//     return;
//   }
// }

// /** Bounded drain: reload eligibility after every pass so steps 1/2/3 may finish
//  * in one cycle, without allowing a dependent step to jump ahead of a failure.
//  */
// async function processOrderedQueue(deps: OrderedDependencies, batchSize = 50): Promise<void> {
//   let processed = 0;
//   while (processed < batchSize) {
//     const candidates = await deps.db.query<QueueJob[]>(SELECT_READY_ORDERED, batchSize - processed);
//     if (!candidates.length) return;
//     let claimedCount = 0;
//     for (const candidate of candidates) {
//       // Claim just before execution. Other candidates remain pending and can
//       // still be picked up by another worker while this job calls/retries HMO.
//       const [job] = await claimJobs(deps.db, [candidate]);
//       if (!job) continue;
//       claimedCount++;
//       try {
//         await processOrderedJob(deps, job);
//       } catch (error) {
//         // Do not reserve more jobs when DB/ownership is uncertain. Leave the
//         // current job for reconciliation and let the next scheduled cycle poll.
//         deps.log?.({ event: 'processing_interrupted', job_id: job.id,
//           operation_id: job.operation_id, error: (error as Error).message });
//         return;
//       }
//       processed++;
//     }
//     if (!claimedCount) return;
//   }
// }

// const queueDatabase: QueueDatabase = {
//   query: <T>(sql: string, ...values: unknown[]) => prisma.$queryRawUnsafe<T>(sql, ...values),
//   execute: (sql: string, ...values: unknown[]) => prisma.$executeRawUnsafe(sql, ...values),
// };

// const HOCMAI_API = 'https://hocmai.vn/api/calendar';
// const HOCMAI_TOKEN = process.env.HOCMAI_SYNC_TOKEN || '48f5e4fc19645a77cdd7a56ab4656c60';
// const BATCH_SIZE = 50;
// const INTERVAL_MS = 60000;

// async function sendLegacyBatch(endpoint: string, payload: any[], ids: number[]) {
//   let errorMessage: string | null = null;
//   try {
//     const res = await axios.post(`${HOCMAI_API}/${endpoint}`, payload, {
//       headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//       timeout: 30000,
//     });
//     const success = res.status === 200 && res.data && (
//       res.data.status === 'success' || res.data.status === 200
//       || (endpoint !== 'store' && res.data.status === true)
//     );
//     if (!success) errorMessage = res.data?.message || 'Hocmai error';
//   } catch (error: any) {
//     // The remote result may be unknown. Record it for review, never auto-replay.
//     errorMessage = `Remote result requires review: ${error.message}`;
//   }
//   if (errorMessage === null) {
//     await prisma.$executeRawUnsafe(
//       `UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE status = 3 AND id IN (${ids.map(() => '?').join(',')})`, ...ids
//     );
//   } else {
//     await prisma.$executeRawUnsafe(
//       `UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE status = 3 AND id IN (${ids.map(() => '?').join(',')})`, errorMessage, ...ids
//     );
//   }
// }

// async function processInsertQueue() {
//   try {
//     const candidates: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND operation_id IS NULL AND action = 'insert' ORDER BY created_at ASC, id ASC LIMIT ${BATCH_SIZE}`
//     );
//     const rows = await claimJobs(queueDatabase, candidates);
//     if (!rows.length) return;

//     const bulkPayload: any[] = [];
//     const validIds: number[] = [];
//     for (const row of rows) {
//       try {
//         const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
//         const mappingRows: any[] = await prisma.$queryRawUnsafe(
//           `SELECT package_id, lesson_id FROM package_lesson_mapping WHERE \`key\` = ? AND lesson_id IS NOT NULL AND lesson_id != ''`,
//           row.c_key
//         );
//         if (mappingRows.length > 0) {
//           parsed.packages = mappingRows.map((r: any) => ({ package_id: r.package_id, lesson_id: r.lesson_id }));
//         }
//         bulkPayload.push(parsed);
//         validIds.push(row.id);
//       } catch (e: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, 'JSON error: ' + e.message, row.id);
//       }
//     }
//     if (!bulkPayload.length) return;

//     await sendLegacyBatch('store', bulkPayload, validIds);
//   } catch (err: any) {
//     console.error('[SyncWorker] Insert queue error:', err.message);
//   }
// }

// async function processUpdateQueue() {
//   try {
//     const candidates: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND operation_id IS NULL AND action IN ('update','create') ORDER BY created_at ASC, id ASC LIMIT ${BATCH_SIZE}`
//     );
//     const rows = await claimJobs(queueDatabase, candidates);
//     if (!rows.length) return;

//     for (const row of rows) {
//       try {
//         let p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
//         if (!p.subject || !p.start_time) {
//           const calRows: any[] = await prisma.$queryRawUnsafe(
//             `SELECT subject, DATE_FORMAT(start_time,'%Y-%m-%d %H:%i:%s') as start_time, DATE_FORMAT(end_time,'%Y-%m-%d %H:%i:%s') as end_time, teacher, lesson_name, lesson_document, lesson_baitap, lesson_link FROM calendar WHERE code = ? AND learn_number = ? LIMIT 1`,
//             p.code, p.learn_number
//           );
//           if (calRows.length > 0) {
//             const cal = calRows[0];
//             p = {
//               ...p, subject: cal.subject, start_time: cal.start_time, end_time: cal.end_time,
//               teacher_name: cal.teacher, title: cal.lesson_name,
//               documents: [
//                 ...(cal.lesson_document ? [{ type: 'pdf', title: 'Phiếu học tập', link: cal.lesson_document }] : []),
//                 ...(cal.lesson_baitap ? [{ type: 'pdf', title: 'Bài tập tự luyện', link: cal.lesson_baitap }] : []),
//                 ...(cal.lesson_link ? [{ type: 'pdf', title: 'Tài liệu bổ trợ', link: cal.lesson_link }] : []),
//               ],
//             };
//           }
//         }

//         const mappingRows: any[] = await prisma.$queryRawUnsafe(
//           `SELECT package_id, lesson_id FROM package_lesson_mapping WHERE \`key\` = ?`, row.c_key
//         );
//         p.packages = mappingRows.map((r: any) => ({ package_id: parseInt(r.package_id, 10), lesson_id: parseInt(r.lesson_id, 10) }));

//         const finalPayload = [{ ...p, action: row.action, c_key: row.c_key }];
//         const res = await axios.post(`${HOCMAI_API}/store`, finalPayload, {
//           headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//           timeout: 30000,
//         });
//         const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200);
//         if (isSuccess) {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id = ?`, row.id);
//         } else {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, res.data?.message || 'Hocmai error', row.id);
//         }
//       } catch (err: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, err.message, row.id);
//       }
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Update queue error:', err.message);
//   }
// }

// async function processUpdate_mappingQueue() {
//   try {
//     const candidates: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND operation_id IS NULL AND action = 'update_mapping' ORDER BY created_at ASC, id ASC LIMIT ${BATCH_SIZE}`
//     );
//     const rows = await claimJobs(queueDatabase, candidates);
//     if (!rows.length) return;

//     const bulkPayload: any[] = [];
//     const validIds: number[] = [];
//     for (const row of rows) {
//       try {
//         bulkPayload.push(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
//         validIds.push(row.id);
//       } catch (e: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, 'JSON error: ' + e.message, row.id);
//       }
//     }
//     if (!bulkPayload.length) return;

//     await sendLegacyBatch('update-lesson', bulkPayload, validIds);
//   } catch (err: any) {
//     console.error('[SyncWorker] Update mapping queue error:', err.message);
//   }
// }

// async function processUpdate_userQueue() {
//   try {
//     const candidates: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND operation_id IS NULL AND action = 'update_user' ORDER BY created_at ASC, id ASC LIMIT ${BATCH_SIZE}`
//     );
//     const rows = await claimJobs(queueDatabase, candidates);
//     if (!rows.length) return;

//     const finalPayload: any[] = [];
//     const finalValidIds: number[] = [];
//     for (const row of rows) {
//       try {
//         const parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
//         let c_key = parsed.c_key;
//         if (!c_key && parsed.code && parsed.learn_number !== undefined) {
//           const calRows: any[] = await prisma.$queryRawUnsafe(
//             `SELECT \`key\` FROM calendar WHERE code = ? AND learn_number = ? LIMIT 1`, parsed.code, parsed.learn_number
//           );
//           if (calRows.length > 0) c_key = calRows[0].key;
//         }
//         if (!c_key) {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, 'No c_key found', row.id);
//           continue;
//         }
//         finalPayload.push({ c_key, user_id: parseInt(parsed.user_id, 10) });
//         finalValidIds.push(row.id);
//       } catch (e: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, 'Parse error: ' + e.message, row.id);
//       }
//     }
//     if (!finalPayload.length) return;

//     await sendLegacyBatch('update-user', finalPayload, finalValidIds);
//   } catch (err: any) {
//     console.error('[SyncWorker] Update user queue error:', err.message);
//   }
// }

// async function processStatusLessonQueue() {
//   try {
//     const candidates: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND operation_id IS NULL AND action = 'update-status-lesson' ORDER BY created_at ASC, id ASC LIMIT ${BATCH_SIZE}`
//     );
//     const rows = await claimJobs(queueDatabase, candidates);
//     if (!rows.length) return;

//     for (const row of rows) {
//       try {
//         const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
//         const res = await axios.post('https://hocmai.vn/api/calendar/change-status', payload, {
//           headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//           timeout: 30000,
//         });
//         const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200 || res.data.status === true);
//         if (isSuccess) {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id = ?`, row.id);
//         } else {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, res.data?.message || 'Hocmai error', row.id);
//         }
//       } catch (err: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, err.message, row.id);
//       }
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Status lesson queue error:', err.message);
//   }
// }

// // Independent schedules: an ordered retry must not delay the next legacy poll.
// // Keep legacy SQL, payload hydration, endpoints and batching unchanged.
// const runLegacy = createNonOverlappingRunner(async () => {
//   const results = await Promise.allSettled([
//     processInsertQueue(),
//     processUpdateQueue(),
//     processUpdate_mappingQueue(),
//     processUpdate_userQueue(),
//     processStatusLessonQueue(),
//   ]);
//   for (const result of results) {
//     if (result.status === 'rejected') console.error('[SyncWorker] Handler failed:', result.reason);
//   }
// });

// // Ordered work remains serial inside this process. Parallelizing operations
// // requires a separate decision on locking operations that touch the same key.
// const runOrdered = createNonOverlappingRunner(() => processOrderedQueue({
//   db: queueDatabase,
//   post: async (endpoint, payload) => {
//     const response = await axios.post(`${HOCMAI_API}/${endpoint}`, payload, {
//       headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//       timeout: 30000,
//     });
//     return { status: response.status, data: response.data };
//   },
//   log: (event) => console.log('[SyncWorker:ordered]', JSON.stringify(event)),
// }, BATCH_SIZE));

// let workerStarted = false;
// export function startSyncWorker() {
//   if (workerStarted || process.env.SYNC_WORKER_DISABLED === 'true') return;
//   if (!HOCMAI_TOKEN) throw new Error('HOCMAI_SYNC_TOKEN is required to start SyncWorker');
//   workerStarted = true;
//   console.log('[SyncWorker] Started (interval: ' + INTERVAL_MS + 'ms)');
//   const schedule = (name: string, run: () => Promise<void>) => {
//     const tick = async () => {
//       try {
//         await run();
//       } catch (error: any) {
//         console.error(`[SyncWorker:${name}] Cycle failed:`, error.message);
//       } finally {
//         setTimeout(() => { void tick(); }, INTERVAL_MS);
//       }
//     };
//     void tick();
//   };
//   schedule('legacy', runLegacy);
//   schedule('ordered', runOrdered);
// }