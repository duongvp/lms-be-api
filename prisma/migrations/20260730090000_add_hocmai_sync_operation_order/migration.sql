ALTER TABLE `hocmai_sync_queue`
    MODIFY `c_key` VARCHAR(100) NOT NULL,
    ADD COLUMN `operation_id` VARCHAR(36) NULL AFTER `status`,
    ADD COLUMN `sequence_no` INTEGER NULL AFTER `operation_id`,
    ADD INDEX `idx_hocmai_sync_operation_sequence` (`operation_id`, `sequence_no`),
    ADD INDEX `idx_hocmai_sync_status_created` (`status`, `created_at`);
