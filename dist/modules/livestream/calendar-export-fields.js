"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistantExportNames = exports.uniqueExportIds = exports.applyCalendarExportVisibility = exports.calendarExportPermissionProbes = void 0;
const dependencies = {
    assistant_name: ['assistant_teacher'], assistant_email: ['assistant_teacher'],
    teacher_name: ['teacher'], teacher_email: ['teacher'],
    live_date: ['start_time'], weekday: ['start_time'], time_range: ['start_time', 'end_time'],
    archive_document: ['lesson_link'], sharepoint_link: ['lesson_link'],
    course_ids: ['code', 'learn_number'], lesson_ids: ['code', 'learn_number'], package_ids: ['code', 'learn_number'],
};
const calendarExportPermissionProbes = (rows) => rows.map((row) => Object.fromEntries(Object.keys(row).flatMap((field) => (dependencies[field] || [field]).map((source) => [source, true]))));
exports.calendarExportPermissionProbes = calendarExportPermissionProbes;
const applyCalendarExportVisibility = (rows, visible) => rows.map((row, index) => Object.fromEntries(Object.entries(row).filter(([field]) => (dependencies[field] || [field]).every((source) => Object.prototype.hasOwnProperty.call(visible[index] || {}, source)))));
exports.applyCalendarExportVisibility = applyCalendarExportVisibility;
const uniqueExportIds = (values) => [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].join(',');
exports.uniqueExportIds = uniqueExportIds;
const assistantExportNames = (usernames, names) => [...new Set(usernames.map((username) => String(names.get(username) || '').trim()).filter(Boolean))].join(', ');
exports.assistantExportNames = assistantExportNames;
