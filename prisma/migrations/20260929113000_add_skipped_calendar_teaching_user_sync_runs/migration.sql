ALTER TABLE `calendar_teaching_user_sync_runs`
  ADD COLUMN `skipped` INT NOT NULL DEFAULT 0 AFTER `updated`;
