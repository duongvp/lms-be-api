import { logger } from '../../utils/logger';
import { startHmoLessonSync } from './hmo-lesson-sync.service';

let timer: NodeJS.Timeout | null = null;
let lastDate = '';

export const startHmoLessonSyncWorker = () => {
  if (timer || String(process.env.HMO_LESSON_SYNC_ENABLED || '').toLowerCase() !== 'true') return () => undefined;
  const hour = Math.min(23, Math.max(0, Number(process.env.HMO_LESSON_SYNC_HOUR || 6)));
  const minute = Math.min(59, Math.max(0, Number(process.env.HMO_LESSON_SYNC_MINUTE || 0)));
  const check = async () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.HMO_LESSON_SYNC_TIMEZONE || 'Asia/Ho_Chi_Minh',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).reduce<Record<string, string>>((result, item) => ({ ...result, [item.type]: item.value }), {});
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) !== hour || Number(parts.minute) !== minute || lastDate === date) return;
    try {
      const result = await startHmoLessonSync('cron');
      if (result.started || result.message === 'Một lượt đồng bộ đang chạy') lastDate = date;
    } catch (error: any) { logger.error('Cannot start HMO lesson cron:', error?.message || error); }
  };
  void check();
  timer = setInterval(() => void check(), 30_000);
  timer.unref();
  logger.info(`HMO lesson sync cron enabled at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  return () => { if (timer) clearInterval(timer); timer = null; };
};
