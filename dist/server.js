"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
const teams_notifications_1 = require("./modules/teams-notifications");
const hmo_lesson_sync_worker_1 = require("./modules/hmo-lesson-sync/hmo-lesson-sync.worker");
const calendar_sheet_export_worker_1 = require("./modules/livestream/calendar-sheet-export.worker");
const calendar_teaching_user_sync_worker_1 = require("./modules/livestream/calendar-teaching-user-sync.worker");
const PORT = process.env.PORT || 5000;
const server = app_1.default.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
const stopTeamsWorker = (0, teams_notifications_1.startTeamsNotificationWorker)();
const stopHmoLessonSyncWorker = (0, hmo_lesson_sync_worker_1.startHmoLessonSyncWorker)();
const stopCalendarSheetExportWorker = (0, calendar_sheet_export_worker_1.startCalendarSheetExportWorker)();
const stopCalendarTeachingUserSyncWorker = (0, calendar_teaching_user_sync_worker_1.startCalendarTeachingUserSyncWorker)();
const shutdown = () => {
    stopCalendarTeachingUserSyncWorker();
    stopCalendarSheetExportWorker();
    stopTeamsWorker();
    stopHmoLessonSyncWorker();
    server.close(() => process.exit(0));
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
