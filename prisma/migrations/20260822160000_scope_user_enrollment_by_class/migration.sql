-- Một lớp được định danh bởi class_id (code + ngày học + learn_number + room).
-- Nhân sự phải có enrollment riêng cho từng lớp/buổi, không gộp mọi buổi của
-- cùng một bài vào một row users.
-- Thực hiện trong một ALTER để không có khoảng thời gian bảng mất unique key.
-- LOCK=NONE yêu cầu InnoDB xây index online, hạn chế chặn đọc/ghi bảng users.
ALTER TABLE `users`
  DROP INDEX `uq_users_enroll`,
  ADD UNIQUE INDEX `uq_users_enroll`
    (`username`, `code`, `learn_number`, `class_id`),
  ALGORITHM=INPLACE,
  LOCK=NONE;
