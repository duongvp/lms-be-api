-- Chỉ bổ sung nơi lưu lý do nghỉ học; không sửa hay chuyển đổi dữ liệu lịch cũ.
ALTER TABLE `calendar`
  ADD COLUMN `cancel_reason` VARCHAR(500) NULL AFTER `lesson_status`;
