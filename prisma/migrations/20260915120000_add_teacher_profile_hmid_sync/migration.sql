ALTER TABLE `teacher_profiles`
  ADD COLUMN `student_hmid` VARCHAR(50) NULL AFTER `status`,
  ADD COLUMN `hmid_sync_status` VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER `student_hmid`,
  ADD COLUMN `hmid_synced_at` DATETIME(3) NULL AFTER `hmid_sync_status`,
  ADD COLUMN `hmid_sync_error` VARCHAR(500) NULL AFTER `hmid_synced_at`,
  ADD INDEX `idx_teacher_student_hmid` (`student_hmid`),
  ADD INDEX `idx_teacher_hmid_sync_status` (`hmid_sync_status`);
