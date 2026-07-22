-- CreateTable
CREATE TABLE `calendar` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `subject` VARCHAR(100) NULL,
    `start_time` TIMESTAMP(0) NOT NULL,
    `end_time` TIMESTAMP(0) NOT NULL,
    `teacher` VARCHAR(150) NULL,
    `lesson_name` VARCHAR(400) NULL,
    `lesson_document` VARCHAR(500) NULL,
    `evg_banner` VARCHAR(500) NULL,
    `evg_stream` VARCHAR(500) NULL,
    `lesson_link` VARCHAR(500) NULL,
    `lesson_count` INTEGER NULL,
    `lesson_baitap` VARCHAR(500) NULL,
    `lesson_tomtat` VARCHAR(500) NULL,
    `lesson_phuongphap` VARCHAR(500) NULL,
    `lesson_luuy` VARCHAR(500) NULL,
    `lesson_ketqua` VARCHAR(500) NULL,
    `channel_name` VARCHAR(500) NULL,
    `lesson_status` TINYINT NULL DEFAULT 0,
    `lesson_noti` VARCHAR(500) NULL,
    `key` VARCHAR(100) NULL,
    `system_type` ENUM('topclass', 'event', 'phaken', 'topuni') NULL DEFAULT 'topclass',
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_calendar_code_learn`(`code`, `learn_number`),
    INDEX `idx_calendar_code_time`(`code`, `learn_number`, `start_time`, `end_time`),
    INDEX `idx_calendar_system`(`system_type`),
    INDEX `idx_calendar_time`(`start_time`, `end_time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evg_callbacks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `live_session_id` VARCHAR(100) NULL,
    `action` VARCHAR(100) NULL,
    `event_type` VARCHAR(100) NULL,
    `webhook_kind` VARCHAR(20) NOT NULL DEFAULT 'livestream',
    `channel_id` VARCHAR(100) NULL,
    `channel_name` VARCHAR(255) NULL,
    `start_on` DATETIME(0) NULL,
    `end_on` DATETIME(0) NULL,
    `created_time` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `raw_data` LONGTEXT NULL,

    INDEX `idx_evg_kind_created`(`webhook_kind`, `created_time`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hocmai_sync_queue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `c_key` VARCHAR(50) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `status` TINYINT NULL DEFAULT 0,
    `synced_at` TIMESTAMP(0) NULL,
    `last_error` TEXT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `learning_count_daily_cache` (
    `package_id` VARCHAR(50) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `learn_date` DATE NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `total_minutes_raw` DECIMAL(24, 0) NULL DEFAULT 0,
    `actual_minutes` INTEGER NULL DEFAULT 0,
    `total_minutes` DECIMAL(10, 2) NULL DEFAULT 0.00,

    INDEX `idx_query`(`package_id`, `learn_date`, `total_minutes`, `username`),
    INDEX `idx_user`(`username`),
    PRIMARY KEY (`package_id`, `username`, `learn_date`, `code`, `learn_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `logs_chat_new` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `mess_id` VARCHAR(50) NOT NULL,
    `user_hmid` BIGINT NOT NULL,
    `user_display_name` VARCHAR(50) NOT NULL,
    `mess_content` VARCHAR(500) NULL,
    `user_role` VARCHAR(20) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `classroom_id` VARCHAR(50) NOT NULL,
    `mess_status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `mess_type` TINYINT NOT NULL DEFAULT 1,
    `mess_time` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `reply_id` BIGINT NULL,
    `is_highlight` TINYINT NULL DEFAULT 0,
    `source_system` ENUM('topclass', 'tu') NULL DEFAULT 'topclass',

    INDEX `idx_chat_lookup`(`code`, `learn_number`, `mess_time`),
    INDEX `idx_chat_user`(`user_hmid`, `mess_time`),
    UNIQUE INDEX `uq_mess_id`(`mess_id`, `mess_time`),
    PRIMARY KEY (`id`, `mess_time`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `package_lesson_mapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `package_id` VARCHAR(50) NOT NULL,
    `lesson_id` VARCHAR(50) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `key` VARCHAR(100) NULL,

    INDEX `idx_plm_package_code_learn`(`package_id`, `code`, `learn_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_content` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `quiz_id` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `quiz_type` TINYINT NOT NULL,
    `quiz_name` VARCHAR(500) NOT NULL,
    `ans` JSON NULL,
    `score_type` TINYINT NOT NULL DEFAULT 1,
    `ans_duration` INTEGER NOT NULL DEFAULT 60,
    `quiz_status` ENUM('active', 'disable', 'done') NULL DEFAULT 'active',
    `quiz_index` INTEGER NULL DEFAULT 0,
    `creator` VARCHAR(100) NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_quiz_id`(`quiz_id`),
    INDEX `idx_quiz_index`(`code`, `learn_number`, `quiz_index`),
    INDEX `idx_quiz_lookup`(`code`, `learn_number`, `quiz_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ans_id` VARCHAR(100) NOT NULL,
    `quiz_id` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `class_id` VARCHAR(100) NOT NULL,
    `ans_info` JSON NOT NULL,
    `score` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `duration` INTEGER NOT NULL,
    `is_latest` TINYINT NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_ans_id`(`ans_id`),
    INDEX `idx_quiz_logs_class`(`class_id`, `created_at`),
    INDEX `idx_quiz_logs_latest`(`code`, `learn_number`, `quiz_id`, `is_latest`, `created_at`),
    INDEX `idx_quiz_logs_lookup`(`code`, `learn_number`, `quiz_id`, `created_at`),
    INDEX `idx_quiz_logs_user`(`username`, `quiz_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_session` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `quiz_id` VARCHAR(100) NOT NULL,
    `quiz_end_time` TIMESTAMP(0) NOT NULL,
    `quiz_status` TINYINT NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_quiz_session_active`(`code`, `learn_number`, `quiz_status`),
    INDEX `idx_quiz_session_end`(`quiz_end_time`),
    UNIQUE INDEX `uq_quiz_session`(`code`, `learn_number`, `quiz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quiz_session_logs` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `quiz_id` VARCHAR(100) NOT NULL,
    `action` TINYINT NOT NULL,
    `duration` INTEGER NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `class_id` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_qsl_action`(`quiz_id`, `action`, `created_at`),
    INDEX `idx_qsl_created`(`created_at`),
    INDEX `idx_qsl_lookup`(`code`, `learn_number`, `quiz_id`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_config` (
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `updated_by` VARCHAR(100) NULL,
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`code`, `learn_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stream` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL,
    `room_id` INTEGER NULL,
    `stream_key` VARCHAR(200) NULL,
    `banner_url` VARCHAR(500) NULL,
    `type` TINYINT NULL,
    `class_id` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_streams_code`(`code`, `learn_number`),
    INDEX `idx_streams_room`(`room_id`),
    UNIQUE INDEX `uq_streams`(`code`, `learn_number`, `room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_profiles` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(120) NOT NULL,
    `teacher_type` TINYINT NOT NULL DEFAULT 0,
    `display_name` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_teacher_username`(`username`),
    INDEX `idx_teacher_type`(`teacher_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_notify_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `notify_type` VARCHAR(50) NOT NULL,
    `notify_key` VARCHAR(191) NULL,
    `source` VARCHAR(100) NULL,
    `status` VARCHAR(30) NOT NULL,
    `code` VARCHAR(100) NULL,
    `channel_name` VARCHAR(255) NULL,
    `learn_number` VARCHAR(50) NULL,
    `session_date` DATE NULL,
    `payload_action` VARCHAR(100) NULL,
    `message_title` VARCHAR(255) NULL,
    `message_html` LONGTEXT NULL,
    `checked_at` DATETIME(0) NULL,
    `sent_at` DATETIME(0) NULL,
    `error_message` TEXT NULL,
    `meta_json` LONGTEXT NULL,
    `created_time` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_time` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_notify_history_code`(`code`, `learn_number`),
    INDEX `idx_notify_history_date`(`session_date`, `notify_type`),
    INDEX `idx_notify_history_key`(`notify_key`),
    INDEX `idx_notify_history_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_notify_locks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `notify_key` VARCHAR(191) NOT NULL,
    `source` VARCHAR(100) NULL,
    `created_time` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uq_notify_key`(`notify_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_update_queue` (
    `username` VARCHAR(255) NULL,
    `code` VARCHAR(255) NULL,
    `learn_number` INTEGER NULL,
    `room_id` INTEGER NULL,
    `class_id` VARCHAR(255) NULL,
    `batch_date` DATE NULL,

    INDEX `idx_queue`(`username`, `code`, `learn_number`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `student_hmid` VARCHAR(50) NULL,
    `email` VARCHAR(100) NULL,
    `name` VARCHAR(150) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL DEFAULT 0,
    `islearn` TINYINT NOT NULL DEFAULT 0,
    `phone` VARCHAR(20) NULL,
    `room_id` INTEGER NULL,
    `class_id` VARCHAR(100) NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_users_code_learn`(`code`, `learn_number`),
    INDEX `idx_users_hmid`(`student_hmid`),
    INDEX `idx_users_name`(`name`),
    INDEX `idx_users_room`(`room_id`),
    UNIQUE INDEX `uq_users_enroll`(`username`, `code`, `learn_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users_block` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(100) NOT NULL,
    `user` VARCHAR(200) NULL,
    `code` VARCHAR(100) NOT NULL,
    `learn_number` INTEGER NOT NULL DEFAULT 0,
    `note` VARCHAR(300) NULL,
    `expired_at` DATETIME(0) NULL,
    `type` INTEGER NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_block_expired`(`code`, `learn_number`, `expired_at`),
    INDEX `idx_block_updated`(`updated_at`),
    UNIQUE INDEX `uq_user_block`(`user_id`, `code`, `learn_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `name` VARCHAR(150) NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL DEFAULT 0,
    `learn_date` DATE NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `ischeck` TINYINT NOT NULL DEFAULT 0,
    `ip` VARCHAR(30) NULL,
    `status` TINYINT NULL DEFAULT 0,
    `session_id` VARCHAR(50) NULL,
    `url` VARCHAR(200) NULL,
    `source_system` ENUM('default', 'tc', 'tu') NULL DEFAULT 'default',

    INDEX `idx_logs_learn_date`(`learn_date`),
    INDEX `idx_logs_time`(`created_at`),
    INDEX `idx_logs_user_code`(`username`, `code`, `learn_number`),
    PRIMARY KEY (`id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users_logs_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user` VARCHAR(50) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `learn_number` INTEGER NOT NULL DEFAULT 0,
    `learn_date` VARCHAR(40) NULL,
    `created_at` DATETIME(0) NOT NULL,
    `ischeck` TINYINT NOT NULL DEFAULT 0,
    `ip` VARCHAR(30) NULL,
    `status` TINYINT NULL DEFAULT 0,
    `url` VARCHAR(50) NULL,

    INDEX `idx_user_code_learn`(`user`, `code`, `learn_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
