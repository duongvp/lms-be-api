ALTER TABLE `hmo_lesson_sync_runs`
  ADD COLUMN `heartbeat_at` DATETIME(3) NULL AFTER `last_error`,
  ADD COLUMN `current_program` VARCHAR(100) NULL AFTER `heartbeat_at`;

UPDATE `hmo_lesson_sync_runs`
SET `heartbeat_at` = `started_at`
WHERE `heartbeat_at` IS NULL;
