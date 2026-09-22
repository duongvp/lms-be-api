"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCalendarSheetExportWorker = exports.createScheduledExportCheck = exports.scheduledExportDate = void 0;
const calendar_sheet_export_service_1 = require("./calendar-sheet-export.service");
const google_sheet_export_job_1 = require("../../integrations/google-sheet-export-job");
const logger_1 = require("../../utils/logger");
let timer = null;
const scheduledExportDate = (now) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return values.hour === '05' && values.minute === '00' ? `${values.year}-${values.month}-${values.day}` : null;
};
exports.scheduledExportDate = scheduledExportDate;
const createScheduledExportCheck = (start, now = () => new Date(), onError = () => undefined) => {
    let lastDate = '';
    return () => {
        const date = (0, exports.scheduledExportDate)(now());
        if (!date || date === lastDate)
            return;
        try {
            start();
            lastDate = date;
        }
        catch (error) {
            onError(error);
        }
    };
};
exports.createScheduledExportCheck = createScheduledExportCheck;
const startCalendarSheetExportWorker = () => {
    if (timer || process.env.CALENDAR_EXPORT_CRON_ENABLED?.toLowerCase() === 'false')
        return () => undefined;
    const check = (0, exports.createScheduledExportCheck)(() => {
        const { targets, task } = (0, calendar_sheet_export_service_1.calendarSheetExportTask)();
        const job = (0, google_sheet_export_job_1.startScheduledSheetExportJob)(targets, task, result => {
            if (result.status === 'completed')
                logger_1.logger.info('Scheduled Google Sheets export completed', result.result);
            else
                logger_1.logger.error('Scheduled Google Sheets export failed:', result.error);
        });
        logger_1.logger.info('Scheduled Google Sheets export started:', job.jobId);
    }, undefined, error => logger_1.logger.error('Cannot start scheduled Google Sheets export:', error instanceof Error ? error.message : error));
    check();
    timer = setInterval(check, 30_000);
    timer.unref();
    logger_1.logger.info('Google Sheets export cron enabled: 05:00 daily (Asia/Ho_Chi_Minh)');
    return () => { if (timer)
        clearInterval(timer); timer = null; };
};
exports.startCalendarSheetExportWorker = startCalendarSheetExportWorker;
