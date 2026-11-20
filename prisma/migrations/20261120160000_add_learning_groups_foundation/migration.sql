-- Additive foundation for parallel unlimited (1-n) and small-group programs.
-- No existing calendar keys, mappings, users, or legacy unique indexes change.
-- No automatic user/calendar backfill: code + learn_number is ambiguous.
-- Run only after checking the target database; do not use migrate reset/db push.

CREATE TABLE `program_settings` (
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(150) NULL,
  `teaching_model` ENUM('large_class', 'small_group') NOT NULL DEFAULT 'large_class',
  `default_capacity` INT NULL,
  `visibility_policy` VARCHAR(50) NULL,
  `visibility_days` INT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  CONSTRAINT `chk_program_settings_capacity` CHECK (`default_capacity` IS NULL OR `default_capacity` > 0),
  CONSTRAINT `chk_program_settings_visibility_days` CHECK (`visibility_days` IS NULL OR `visibility_days` > 0)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `learning_groups` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(30) NOT NULL,
  `group_code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `capacity` INT NULL,
  `status` ENUM('active', 'inactive', 'closed') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_learning_groups_code_group` (`code`, `group_code`),
  UNIQUE KEY `uq_learning_groups_id_code` (`id`, `code`),
  KEY `idx_learning_groups_code_status` (`code`, `status`),
  CONSTRAINT `chk_learning_groups_capacity` CHECK (`capacity` IS NULL OR `capacity` > 0),
  CONSTRAINT `chk_learning_groups_group_code` CHECK (REGEXP_LIKE(`group_code`, '^[A-Z0-9_-]{1,30}$', 'c')),
  CONSTRAINT `fk_learning_groups_program` FOREIGN KEY (`code`)
    REFERENCES `program_settings` (`code`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `calendar`
  ADD COLUMN `group_id` INT UNSIGNED NULL,
  ADD UNIQUE KEY `uq_calendar_id_code_learn` (`id`, `code`, `learn_number`),
  ADD KEY `idx_calendar_group_code` (`group_id`, `code`),
  ADD KEY `idx_calendar_group_time` (`group_id`, `start_time`),
  ADD KEY `idx_calendar_group_lesson_count` (`group_id`, `session_id`, `lesson_count`),
  ADD CONSTRAINT `fk_calendar_learning_group` FOREIGN KEY (`group_id`, `code`)
    REFERENCES `learning_groups` (`id`, `code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `users`
  ADD COLUMN `calendar_id` INT UNSIGNED NULL,
  ADD UNIQUE KEY `uq_users_calendar_username` (`username`, `calendar_id`),
  ADD KEY `idx_users_calendar_code_learn` (`calendar_id`, `code`, `learn_number`),
  ADD KEY `idx_users_calendar_room` (`calendar_id`, `room_id`),
  ADD CONSTRAINT `fk_users_calendar` FOREIGN KEY (`calendar_id`, `code`, `learn_number`)
    REFERENCES `calendar` (`id`, `code`, `learn_number`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Settings are opt-in for future programs so legacy creation remains compatible.
-- Existing programs start as unlimited 1-n; do not infer model from code names.
INSERT INTO `program_settings` (`code`, `teaching_model`, `default_capacity`)
SELECT DISTINCT `code`, 'large_class', NULL
FROM `calendar`
WHERE TRIM(`code`) <> '';
