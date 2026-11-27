-- CreateTable
CREATE TABLE `calendar_approval_accounts` (
    `user_id` INTEGER UNSIGNED NOT NULL,
    `can_approve` BOOLEAN NOT NULL DEFAULT false,
    `required_operations` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_by` INTEGER UNSIGNED NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_approval_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` CHAR(36) NOT NULL,
    `created_by` INTEGER UNSIGNED NOT NULL,
    `creator_name` VARCHAR(150) NOT NULL,
    `operation` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `lock_version` INTEGER NOT NULL DEFAULT 1,
    `command` JSON NOT NULL,
    `program_codes` JSON NOT NULL,
    `before_data` JSON NOT NULL,
    `proposed_data` JSON NOT NULL,
    `base_hash` CHAR(64) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `decision_reason` VARCHAR(1000) NULL,
    `decided_by` INTEGER UNSIGNED NULL,
    `result_data` JSON NULL,
    `idempotency_key` VARCHAR(100) NULL,
    `input_hash` CHAR(64) NULL,
    `submitted_at` DATETIME(3) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `calendar_approval_requests_public_id_key`(`public_id`),
    INDEX `calendar_approval_requests_created_by_status_id_idx`(`created_by`, `status`, `id`),
    INDEX `calendar_approval_requests_status_submitted_at_idx`(`status`, `submitted_at`),
    UNIQUE INDEX `calendar_approval_requests_created_by_idempotency_key_key`(`created_by`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_approval_revisions` (
    `request_id` BIGINT UNSIGNED NOT NULL,
    `revision` INTEGER NOT NULL,
    `command` JSON NOT NULL,
    `before_data` JSON NOT NULL,
    `proposed_data` JSON NOT NULL,
    `base_hash` CHAR(64) NOT NULL,
    `program_codes` JSON NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `submitted_by` INTEGER UNSIGNED NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`request_id`, `revision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_approval_audit` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT UNSIGNED NULL,
    `revision` INTEGER NULL,
    `actor_id` INTEGER UNSIGNED NOT NULL,
    `actor_name` VARCHAR(150) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `before_data` JSON NOT NULL,
    `after_data` JSON NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calendar_approval_audit_request_id_id_idx`(`request_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_approval_notifications` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id` CHAR(36) NOT NULL,
    `request_id` BIGINT UNSIGNED NOT NULL,
    `recipient_id` INTEGER UNSIGNED NOT NULL,
    `event_type` VARCHAR(40) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calendar_approval_notifications_recipient_id_read_at_id_idx`(`recipient_id`, `read_at`, `id`),
    UNIQUE INDEX `calendar_approval_notifications_event_id_recipient_id_key`(`event_id`, `recipient_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_approval_mutex` (
    `id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


INSERT INTO calendar_approval_mutex (id) VALUES (1);
