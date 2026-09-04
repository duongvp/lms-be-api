-- Bảng audit độc lập cho lịch sử chia lớp.
-- Migration này chỉ tạo bảng và index mới; không ALTER, không thêm foreign key
-- và không thay đổi bất kỳ index nào trên users, calendar hoặc bảng hiện có.
CREATE TABLE `classroom_assignment_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `operation_id` CHAR(36) NOT NULL,
    `calendar_id` INTEGER UNSIGNED NOT NULL,
    `user_id` INTEGER UNSIGNED NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `system_type` VARCHAR(20) NOT NULL,
    `previous_room_id` INTEGER NULL,
    `new_room_id` INTEGER NOT NULL,
    `previous_class_id` VARCHAR(100) NULL,
    `new_class_id` VARCHAR(100) NOT NULL,
    `interaction_score` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_by` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`),
    INDEX `idx_class_assignment_operation` (`operation_id`),
    INDEX `idx_class_assignment_calendar` (`calendar_id`, `created_at`),
    INDEX `idx_class_assignment_user` (`user_id`, `code`, `learn_number`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
