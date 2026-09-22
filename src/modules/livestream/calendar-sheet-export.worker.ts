import { calendarSheetExportTask } from './calendar-sheet-export.service';
import { startScheduledSheetExportJob } from '../../integrations/google-sheet-export-job';
import { logger } from '../../utils/logger';

let timer: NodeJS.Timeout | null = null;

export const scheduledExportDate = (now: Date): string | null => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.hour === '05' && values.minute === '00' ? `${values.year}-${values.month}-${values.day}` : null;
};

export const createScheduledExportCheck = (start: () => void, now = () => new Date(), onError: (error: unknown) => void = () => undefined) => {
  let lastDate = '';
  return () => {
    const date = scheduledExportDate(now());
    if (!date || date === lastDate) return;
    try {
      start();
      lastDate = date;
    } catch (error) { onError(error); }
  };
};

export const startCalendarSheetExportWorker = () => {
  if (timer || process.env.CALENDAR_EXPORT_CRON_ENABLED?.toLowerCase() === 'false') return () => undefined;
  const check = createScheduledExportCheck(() => {
    const { targets, task } = calendarSheetExportTask();
    const job = startScheduledSheetExportJob(targets, task, result => {
      if (result.status === 'completed') logger.info('Scheduled Google Sheets export completed', result.result);
      else logger.error('Scheduled Google Sheets export failed:', result.error);
    });
    logger.info('Scheduled Google Sheets export started:', job.jobId);
  }, undefined, error => logger.error('Cannot start scheduled Google Sheets export:', error instanceof Error ? error.message : error));
  check();
  timer = setInterval(check, 30_000);
  timer.unref();
  logger.info('Google Sheets export cron enabled: 05:00 daily (Asia/Ho_Chi_Minh)');
  return () => { if (timer) clearInterval(timer); timer = null; };
};
