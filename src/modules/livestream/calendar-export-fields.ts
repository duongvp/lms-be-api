const dependencies: Record<string, string[]> = {
  assistant_name: ['assistant_teacher'], assistant_email: ['assistant_teacher'],
  teacher_name: ['teacher'], teacher_email: ['teacher'],
  live_date: ['start_time'], weekday: ['start_time'], time_range: ['start_time', 'end_time'],
  archive_document: ['lesson_link'], sharepoint_link: ['lesson_link'],
  course_ids: ['code', 'learn_number'], lesson_ids: ['code', 'learn_number'], package_ids: ['code', 'learn_number'],
};

export const calendarExportPermissionProbes = (rows: Record<string, any>[]) => rows.map((row) =>
  Object.fromEntries(Object.keys(row).flatMap((field) => (dependencies[field] || [field]).map((source) => [source, true]))));

export const applyCalendarExportVisibility = (rows: Record<string, any>[], visible: Record<string, any>[]) => rows.map((row, index) =>
  Object.fromEntries(Object.entries(row).filter(([field]) => (dependencies[field] || [field]).every((source) => Object.prototype.hasOwnProperty.call(visible[index] || {}, source)))));

export const uniqueExportIds = (values: unknown[]) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].join(',');

export const assistantExportNames = (usernames: string[], names: Map<string, string>) => [...new Set(usernames.map((username) => String(names.get(username) || '').trim()).filter(Boolean))].join(', ');
