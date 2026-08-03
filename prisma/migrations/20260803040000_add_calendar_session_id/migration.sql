ALTER TABLE `calendar`
    ADD COLUMN `session_id` BIGINT NULL AFTER `id`,
    ADD INDEX `idx_calendar_session_id` (`session_id`);

-- session_id tham chiếu logic tới lessons.id. Cố ý không tạo FOREIGN KEY để
-- calendar vẫn độc lập và các dữ liệu lịch cũ tiếp tục hợp lệ.
