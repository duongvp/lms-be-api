-- CreateTable
CREATE TABLE `chat_jev_policy_versions` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `policy_key` VARCHAR(64) NOT NULL,
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `edit_revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `config_json` JSON NOT NULL,
    `bundle_hash` CHAR(64) NULL,
    `policy_hash` CHAR(64) NULL,
    `rubric_hash` VARCHAR(100) NULL,
    `created_by` VARCHAR(100) NOT NULL,
    `published_by` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,

    UNIQUE INDEX `uq_jev_compact_policy_version`(`policy_key`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `chat_jev_bindings` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `scope_type` VARCHAR(16) NOT NULL,
    `scope_key` VARCHAR(100) NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'off',
    `policy_version_id` INTEGER UNSIGNED NULL,
    `runtime_json` JSON NULL,
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updated_by` VARCHAR(100) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_jev_compact_binding_policy`(`policy_version_id`),
    UNIQUE INDEX `uq_jev_compact_binding_scope`(`scope_type`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `chat_jev_student_states` (
    `calendar_id` INTEGER UNSIGNED NOT NULL,
    `user_id` VARCHAR(100) NOT NULL,
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `state_json` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`calendar_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

-- CreateTable
CREATE TABLE `chat_jev_audit_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(16) NOT NULL,
    `event_key` CHAR(64) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `calendar_id` INTEGER UNSIGNED NULL,
    `policy_version_id` INTEGER UNSIGNED NULL,
    `policy_hash` CHAR(64) NULL,
    `rubric_hash` VARCHAR(100) NULL,
    `bundle_hash` CHAR(64) NULL,
    `payload_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,

    INDEX `idx_jev_compact_audit_expiry`(`kind`, `expires_at`, `id`),
    INDEX `idx_jev_compact_audit_calendar`(`calendar_id`, `created_at`, `id`),
    UNIQUE INDEX `uq_jev_compact_audit_event`(`kind`, `event_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;


-- Không cascade xóa release/audit khi thay binding hoặc dọn evaluation.
ALTER TABLE chat_jev_bindings ADD CONSTRAINT fk_jev_compact_binding_policy FOREIGN KEY (policy_version_id) REFERENCES chat_jev_policy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE chat_jev_audit_events ADD INDEX idx_jev_compact_audit_policy(policy_version_id), ADD CONSTRAINT fk_jev_compact_audit_policy FOREIGN KEY (policy_version_id) REFERENCES chat_jev_policy_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
