CREATE TABLE `calendar_teaching_user_sync_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `status` VARCHAR(30) NOT NULL DEFAULT 'running',
  `active_key` VARCHAR(30) NULL,
  `window_start` DATETIME(3) NOT NULL,
  `window_end` DATETIME(3) NOT NULL,
  `scanned` INT NOT NULL DEFAULT 0,
  `created` INT NOT NULL DEFAULT 0,
  `updated` INT NOT NULL DEFAULT 0,
  `failed` INT NOT NULL DEFAULT 0,
  `errors_json` LONGTEXT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_calendar_teaching_user_sync_active_key` (`active_key`),
  KEY `idx_calendar_teaching_user_sync_started_at` (`started_at`)
);
