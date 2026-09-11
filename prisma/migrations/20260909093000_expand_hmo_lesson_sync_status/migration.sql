ALTER TABLE `hmo_lesson_sync_runs`
  MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'running';
