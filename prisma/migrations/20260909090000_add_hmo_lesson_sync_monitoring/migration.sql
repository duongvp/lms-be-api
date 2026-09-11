CREATE TABLE `hmo_lesson_sync_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trigger_type` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'running',
  `active_key` VARCHAR(30) NULL,
  `started_by` VARCHAR(100) NULL,
  `programs_total` INT NOT NULL DEFAULT 0,
  `programs_processed` INT NOT NULL DEFAULT 0,
  `programs_failed` INT NOT NULL DEFAULT 0,
  `lessons_total` INT NOT NULL DEFAULT 0,
  `lessons_synced` INT NOT NULL DEFAULT 0,
  `lessons_failed` INT NOT NULL DEFAULT 0,
  `calendars_synced` INT NOT NULL DEFAULT 0,
  `last_error` TEXT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finished_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hmo_lesson_sync_active_key` (`active_key`),
  KEY `idx_hmo_lesson_sync_started_at` (`started_at`)
);

CREATE TABLE `hmo_lesson_sync_issues` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `program_code` VARCHAR(100) NOT NULL,
  `lesson_id` BIGINT NULL,
  `calendar_id` INT NULL,
  `learn_number` INT NULL,
  `lesson_name` VARCHAR(400) NULL,
  `teacher` VARCHAR(255) NULL,
  `course_id` VARCHAR(50) NULL,
  `package_id` VARCHAR(50) NULL,
  `error_code` VARCHAR(50) NOT NULL,
  `message` VARCHAR(1000) NOT NULL,
  `resolved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_hmo_lesson_sync_issue_run` (`run_id`),
  KEY `idx_hmo_lesson_sync_issue_program` (`program_code`, `learn_number`),
  CONSTRAINT `fk_hmo_lesson_sync_issue_run` FOREIGN KEY (`run_id`)
    REFERENCES `hmo_lesson_sync_runs` (`id`) ON DELETE CASCADE
);
