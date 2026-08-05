CREATE TABLE `teams_notification_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_key` VARCHAR(191) NOT NULL,
  `destination` VARCHAR(100) NOT NULL,
  `event_type` VARCHAR(30) NOT NULL,
  `calendar_id` INT UNSIGNED NULL,
  `payload` JSON NOT NULL,
  `status` TINYINT NOT NULL DEFAULT 0,
  `attempts` INT NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `locked_at` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_teams_notification_event_destination` (`event_key`, `destination`),
  INDEX `idx_teams_notification_dispatch` (`status`, `next_attempt_at`),
  INDEX `idx_teams_notification_calendar` (`calendar_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
