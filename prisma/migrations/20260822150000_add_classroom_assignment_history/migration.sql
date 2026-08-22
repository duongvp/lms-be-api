-- Append-only history. This migration is intentionally additive and does not
-- update or delete any existing users/classroom data.
CREATE TABLE `classroom_assignment_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operation_id` CHAR(36) NOT NULL,
  `calendar_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `username` VARCHAR(100) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `learn_number` INT NOT NULL,
  `system_type` VARCHAR(20) NOT NULL,
  `previous_room_id` INT NULL,
  `new_room_id` INT NOT NULL,
  `previous_class_id` VARCHAR(100) NULL,
  `new_class_id` VARCHAR(100) NOT NULL,
  `interaction_score` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` VARCHAR(100) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_class_assignment_operation` (`operation_id`),
  INDEX `idx_class_assignment_calendar` (`calendar_id`, `created_at`),
  INDEX `idx_class_assignment_user` (`user_id`, `code`, `learn_number`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
