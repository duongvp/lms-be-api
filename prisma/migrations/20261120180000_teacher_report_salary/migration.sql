-- CreateTable
CREATE TABLE `teaching_records` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `teacher_profile_id` INTEGER UNSIGNED NULL,
    `role` VARCHAR(20) NOT NULL,
    `service_date` DATE NOT NULL,
    `billing_code` VARCHAR(30) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'confirmed',
    `outcome` VARCHAR(30) NOT NULL,
    `session_kind` VARCHAR(20) NOT NULL,
    `is_substitute` BOOLEAN NOT NULL DEFAULT false,
    `actual_seconds` INTEGER NOT NULL,
    `scheduled_seconds` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` VARCHAR(100) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `teaching_records_teacher_profile_id_service_date_status_idx`(`teacher_profile_id`, `service_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teaching_record_sources` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `teaching_record_id` BIGINT UNSIGNED NOT NULL,
    `calendar_id` INTEGER UNSIGNED NOT NULL,
    `participant_key` VARCHAR(150) NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,

    INDEX `teaching_record_sources_teaching_record_id_idx`(`teaching_record_id`),
    UNIQUE INDEX `teaching_record_sources_calendar_id_participant_key_key`(`calendar_id`, `participant_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_rates` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `dimensions` JSON NOT NULL,
    `pay_basis` VARCHAR(20) NOT NULL,
    `duration_basis` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `valid_from` DATE NOT NULL,
    `valid_to` DATE NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `previous_id` BIGINT UNSIGNED NULL,
    `created_by` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_rates_valid_from_valid_to_idx`(`valid_from`, `valid_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_periods` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `scope` JSON NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `calculation_hash` CHAR(64) NULL,
    `snapshot` JSON NOT NULL,
    `created_by` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_periods_from_date_to_date_status_idx`(`from_date`, `to_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `period_id` BIGINT UNSIGNED NOT NULL,
    `teaching_record_id` BIGINT UNSIGNED NOT NULL,
    `teacher_profile_id` INTEGER UNSIGNED NOT NULL,
    `rate_id` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `snapshot` JSON NOT NULL,

    UNIQUE INDEX `salary_items_teaching_record_id_key`(`teaching_record_id`),
    INDEX `salary_items_period_id_teacher_profile_id_idx`(`period_id`, `teacher_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_adjustments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `period_id` BIGINT UNSIGNED NOT NULL,
    `teacher_profile_id` INTEGER UNSIGNED NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `source_item_id` BIGINT UNSIGNED NULL,
    `created_by` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_adjustments_period_id_teacher_profile_id_idx`(`period_id`, `teacher_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `period_id` BIGINT UNSIGNED NOT NULL,
    `teacher_profile_id` INTEGER UNSIGNED NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `reference` VARCHAR(150) NOT NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_by` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `salary_payments_idempotency_key_key`(`idempotency_key`),
    INDEX `salary_payments_period_id_teacher_profile_id_idx`(`period_id`, `teacher_profile_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `entity_type` VARCHAR(30) NOT NULL,
    `entity_id` VARCHAR(30) NOT NULL,
    `period_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(40) NOT NULL,
    `actor_id` INTEGER UNSIGNED NOT NULL,
    `actor_username` VARCHAR(100) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `before_data` JSON NOT NULL,
    `after_data` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `salary_audit_logs_period_id_created_at_idx`(`period_id`, `created_at`),
    INDEX `salary_audit_logs_entity_type_entity_id_created_at_idx`(`entity_type`, `entity_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `teaching_records` ADD CONSTRAINT `teaching_records_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `teaching_record_sources` ADD CONSTRAINT `teaching_record_sources_teaching_record_id_fkey` FOREIGN KEY (`teaching_record_id`) REFERENCES `teaching_records`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `teaching_record_sources` ADD CONSTRAINT `teaching_record_sources_calendar_id_fkey` FOREIGN KEY (`calendar_id`) REFERENCES `calendar`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_items` ADD CONSTRAINT `salary_items_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `salary_periods`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_items` ADD CONSTRAINT `salary_items_teaching_record_id_fkey` FOREIGN KEY (`teaching_record_id`) REFERENCES `teaching_records`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_items` ADD CONSTRAINT `salary_items_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_items` ADD CONSTRAINT `salary_items_rate_id_fkey` FOREIGN KEY (`rate_id`) REFERENCES `salary_rates`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_adjustments` ADD CONSTRAINT `salary_adjustments_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `salary_periods`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_adjustments` ADD CONSTRAINT `salary_adjustments_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_payments` ADD CONSTRAINT `salary_payments_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `salary_periods`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_payments` ADD CONSTRAINT `salary_payments_teacher_profile_id_fkey` FOREIGN KEY (`teacher_profile_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE salary_payments ADD UNIQUE INDEX uq_salary_payment_reference (period_id,teacher_profile_id,reference);

-- Database-level financial guards complement API validation.
ALTER TABLE salary_adjustments ADD CONSTRAINT salary_adjustments_source_item_fkey FOREIGN KEY (source_item_id) REFERENCES salary_items(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE salary_rates ADD CONSTRAINT ck_salary_rate CHECK (amount >= 0 AND pay_basis IN ('session','hour') AND duration_basis IN ('actual','scheduled') AND (valid_to IS NULL OR valid_to > valid_from));
ALTER TABLE salary_periods ADD CONSTRAINT ck_salary_period CHECK (to_date > from_date AND status IN ('draft','pending_review','approved','paid'));
ALTER TABLE salary_items ADD CONSTRAINT ck_salary_item CHECK (amount >= 0);
ALTER TABLE salary_payments ADD CONSTRAINT ck_salary_payment CHECK (amount > 0);
ALTER TABLE teaching_records ADD CONSTRAINT ck_teaching_record CHECK (role IN ('teacher','assistant') AND actual_seconds >= 0 AND actual_seconds <= 43200 AND scheduled_seconds > 0 AND outcome IN ('completed','teacher_absent','not_held','cancelled') AND (outcome <> 'completed' OR (teacher_profile_id IS NOT NULL AND actual_seconds > 0)));

-- Register permissions only; existing non-admin roles receive no new grants.
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('teaching_report.view','Xem báo cáo giảng dạy','Xem báo cáo giảng dạy',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('teaching_report.export','Xuất báo cáo giảng dạy','Xuất báo cáo giảng dạy',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('teaching_record.confirm','Xác nhận công','Xác nhận công',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('teaching_record.revise','Sửa xác nhận công','Sửa xác nhận công',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.view','Xem bảng lương','Xem bảng lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.rate.manage','Quản lý đơn giá','Quản lý đơn giá',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.period.create','Tạo kỳ lương','Tạo kỳ lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.period.calculate','Tính kỳ lương','Tính kỳ lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.adjust','Điều chỉnh lương','Điều chỉnh lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.review','Kiểm tra kỳ lương','Kiểm tra kỳ lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.approve','Chốt kỳ lương','Chốt kỳ lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.pay','Ghi nhận thanh toán','Ghi nhận thanh toán',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.reopen','Mở lại kỳ lương','Mở lại kỳ lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.export','Xuất bảng lương','Xuất bảng lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO permissions (code,name,description,createdAt,updatedAt) VALUES ('salary.audit.view','Xem lịch sử lương','Xem lịch sử lương',NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE code=VALUES(code);
