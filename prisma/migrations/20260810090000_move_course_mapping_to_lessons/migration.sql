-- course_id/package_id thuộc từng bài trong đề cương, không thuộc calendar.
-- Migration này chỉ tạo cấu trúc; không tự backfill hay thay đổi dữ liệu hiện có.
CREATE TABLE IF NOT EXISTS `lesson_course_mapping` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lesson_id` BIGINT NOT NULL,
  `package_id` VARCHAR(50) NOT NULL,
  `course_id` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lcm_lesson_package_course` (`lesson_id`, `package_id`, `course_id`),
  KEY `idx_lcm_lesson` (`lesson_id`),
  KEY `idx_lcm_package_course` (`package_id`, `course_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
