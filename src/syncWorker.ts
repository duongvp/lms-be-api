// import axios from 'axios';
// import prisma from './prisma';

// const HOCMAI_API = 'https://hocmai.vn/api/calendar';
// const HOCMAI_TOKEN = process.env.HOCMAI_SYNC_TOKEN || '48f5e4fc19645a77cdd7a56ab4656c60';
// const BATCH_SIZE = 50;
// const INTERVAL_MS = 60000;

// async function processInsertQueue() {
//   try {
//     const rows: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND action = 'insert' ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`
//     );
//     if (!rows.length) return;

//     const ids = rows.map((r: any) => r.id);
//     await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 3 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);

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

//     const res = await axios.post(`${HOCMAI_API}/store`, bulkPayload, {
//       headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//       timeout: 30000,
//     });
//     const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200);
//     if (isSuccess) {
//       await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id IN (${validIds.map(() => '?').join(',')})`, ...validIds);
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Insert queue error:', err.message);
//   }
// }

// async function processUpdateQueue() {
//   try {
//     const rows: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND action IN ('update','create') ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`
//     );
//     if (!rows.length) return;

//     const ids = rows.map((r: any) => r.id);
//     await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 3 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);

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
//     const rows: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND action = 'update_mapping' ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`
//     );
//     if (!rows.length) return;

//     const ids = rows.map((r: any) => r.id);
//     await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 3 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);

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

//     const res = await axios.post(`${HOCMAI_API}/update-lesson`, bulkPayload, {
//       headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//       timeout: 30000,
//     });
//     const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200 || res.data.status === true);
//     if (isSuccess) {
//       await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id IN (${validIds.map(() => '?').join(',')})`, ...validIds);
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Update mapping queue error:', err.message);
//   }
// }

// async function processUpdate_userQueue() {
//   try {
//     const rows: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND action = 'update_user' ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`
//     );
//     if (!rows.length) return;

//     const ids = rows.map((r: any) => r.id);
//     await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 3 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);

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

//     const res = await axios.post(`${HOCMAI_API}/update-user`, finalPayload, {
//       headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//       timeout: 30000,
//     });
//     const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200 || res.data.status === true);
//     if (isSuccess) {
//       await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id IN (${finalValidIds.map(() => '?').join(',')})`, ...finalValidIds);
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Update user queue error:', err.message);
//   }
// }

// async function processStatusLessonQueue() {
//   try {
//     const rows: any[] = await prisma.$queryRawUnsafe(
//       `SELECT id, c_key, action, payload FROM hocmai_sync_queue WHERE status = 0 AND action = 'update-status-lesson' ORDER BY created_at ASC LIMIT ${BATCH_SIZE}`
//     );
//     if (!rows.length) return;

//     const ids = rows.map((r: any) => r.id);
//     await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 3 WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);

//     for (const row of rows) {
//       try {
//         const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
//         const res = await axios.post(`${HOCMAI_API}/change-status`, payload, {
//           headers: { TOKEN: HOCMAI_TOKEN, 'Content-Type': 'application/json' },
//           timeout: 30000,
//         });
//         const isSuccess = res.status === 200 && res.data && (res.data.status === 'success' || res.data.status === 200 || res.data.status === true);
//         if (isSuccess) {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 1, synced_at = NOW(), last_error = NULL WHERE id = ?`, row.id);
//         } else {
//           await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, res.data?.message || 'Hocmai error', row.id);
//           }
//         } catch (err: any) {
//         await prisma.$executeRawUnsafe(`UPDATE hocmai_sync_queue SET status = 2, last_error = ? WHERE id = ?`, err.message, row.id);
//       }
//     }
//   } catch (err: any) {
//     console.error('[SyncWorker] Status lesson queue error:', err.message);
//   }
// }

// const runAll = () => {
//   processInsertQueue();
//   processUpdateQueue();
//   processUpdate_mappingQueue();
//   processUpdate_userQueue();
//   processStatusLessonQueue();
// };

// export function startSyncWorker() {
//   console.log('[SyncWorker] 🚀 Started (interval: ' + INTERVAL_MS + 'ms)');
//   runAll();
//   setInterval(runAll, INTERVAL_MS);
// }
