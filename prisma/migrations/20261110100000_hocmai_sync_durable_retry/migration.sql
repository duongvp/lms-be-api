-- Additive only: does not replay historical status=2/3 jobs or modify triggers.
-- Apply from LMS before deploying the consumer that uses these columns.
ALTER TABLE `hocmai_sync_queue`
  ADD COLUMN `processing_at` DATETIME(3) NULL,
  ADD COLUMN `lease_expires_at` DATETIME(3) NULL,
  ADD COLUMN `claim_token` VARCHAR(36) NULL,
  ADD COLUMN `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN `next_retry_at` DATETIME(3) NULL,
  ADD INDEX `idx_hocmai_sync_retry` (`status`, `action`, `next_retry_at`, `id`),
  ADD INDEX `idx_hocmai_sync_lease` (`status`, `lease_expires_at`);
