import * as livestreamService from './livestream.service';
import FieldPermissionService from '../roles/field-permission.service';
import { applyCalendarExportVisibility, calendarExportPermissionProbes } from './calendar-export-fields';
import { buildOperationalCalendarWorkbook, googleCalendarTabTitles } from './livestream.io';
import { DEFAULT_CALENDAR_SHEET_URL, DEFAULT_TOPUNI_SHEET_URL, spreadsheetIdFromUrl, validateSheetExport, writeCalendarWorkbookToSheet } from '../../integrations/google-sheet-write';

export const calendarSheetExportTask = (options: {
  sheetUrl?: string; topuniSheetUrl?: string;
  scope?: Parameters<typeof livestreamService.getCalendarRowsForExport>[1];
  roleIds?: number[];
} = {}) => {
  const sheetUrl = String(options.sheetUrl || process.env.CALENDAR_EXPORT_SHEET_URL || DEFAULT_CALENDAR_SHEET_URL).trim();
  const topuniSheetUrl = String(options.topuniSheetUrl || process.env.CALENDAR_EXPORT_TOPUNI_SHEET_URL || DEFAULT_TOPUNI_SHEET_URL).trim();
  validateSheetExport(sheetUrl);
  validateSheetExport(topuniSheetUrl);
  const targets = [spreadsheetIdFromUrl(sheetUrl), spreadsheetIdFromUrl(topuniSheetUrl)];
  if (targets[0] === targets[1]) throw new Error('Topclass và Topuni cần hai sheet đích khác nhau.');
  return { targets, task: async (onProgress: (percent: number, message: string) => void) => {
      const rows = await livestreamService.getCalendarRowsForExport(undefined, options.scope);
      if (!rows.length) throw new Error('Không có lịch học được phép xuất.');
      const groups = [
        { systemType: 'topclass', sheetUrl, rows: rows.filter((row) => row.system_type === 'topclass') },
        { systemType: 'topuni', sheetUrl: topuniSheetUrl, rows: rows.filter((row) => row.system_type === 'topuni') },
      ];
      if (groups.reduce((count, group) => count + group.rows.length, 0) !== rows.length) throw new Error('Có chương trình chưa xác định hệ Topclass/Topuni. Vui lòng kiểm tra trước khi xuất.');
      const destinations = [];
      for (const [index, group] of groups.entries()) {
        try {
          const visibleRows = options.roleIds ? applyCalendarExportVisibility(group.rows, await FieldPermissionService.filterVisibleRecords(options.roleIds, 'calendar', calendarExportPermissionProbes(group.rows))) : group.rows;
          const result = await writeCalendarWorkbookToSheet(buildOperationalCalendarWorkbook(visibleRows), group.sheetUrl, (progress, message) => onProgress((index * 100 + progress) / groups.length, `${group.systemType === 'topuni' ? 'Topuni' : 'Topclass'}: ${message}`), googleCalendarTabTitles(visibleRows));
          destinations.push({ ...result, systemType: group.systemType, rowCount: group.rows.length });
        } catch (error) {
          const completed = destinations.length ? `Đã cập nhật ${destinations.map((item) => item.systemType === 'topuni' ? 'Topuni' : 'Topclass').join(', ')}. ` : '';
          throw new Error(`${completed}${group.systemType === 'topuni' ? 'Topuni' : 'Topclass'}: ${error instanceof Error ? error.message : 'Không thể xuất dữ liệu.'}`);
        }
      }
      return { sheetUrl: destinations[0].sheetUrl, sheetCount: destinations.reduce((count, result) => count + result.sheetCount, 0), rowCount: rows.length, destinations };

  } };
};
