ALTER TABLE `calendar` ADD COLUMN `deleted_at` DATETIME(3) NULL,
  ADD INDEX `idx_calendar_deleted_time` (`deleted_at`, `start_time`);

ALTER TABLE `hocmai_sync_queue` ADD INDEX `idx_hocmai_sync_key_id` (`c_key`, `id`);
