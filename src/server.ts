import "dotenv/config";
import app from "./app";
import { startTeamsNotificationWorker } from "./modules/teams-notifications";
import { startHmoLessonSyncWorker } from './modules/hmo-lesson-sync/hmo-lesson-sync.worker';

import { startCalendarSheetExportWorker } from './modules/livestream/calendar-sheet-export.worker';
import { startCalendarAttendanceSyncWorker } from './modules/livestream/calendar-attendance-sync.worker';
import { startCalendarTeachingUserSyncWorker } from './modules/livestream/calendar-teaching-user-sync.worker';

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

const stopTeamsWorker = startTeamsNotificationWorker();
const stopHmoLessonSyncWorker = startHmoLessonSyncWorker();
const stopCalendarSheetExportWorker = startCalendarSheetExportWorker();
const stopCalendarAttendanceSyncWorker = startCalendarAttendanceSyncWorker();
const stopCalendarTeachingUserSyncWorker = startCalendarTeachingUserSyncWorker();
const shutdown = () => {
  stopCalendarTeachingUserSyncWorker();
  stopCalendarAttendanceSyncWorker();
  stopCalendarSheetExportWorker();
  stopTeamsWorker();
  stopHmoLessonSyncWorker();
  server.close(() => process.exit(0));
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
