-- Lưu lại dữ liệu cũ để có thể khôi phục sau khi gỡ các cột khỏi `lessons`.
-- Bảng `calendar` và dữ liệu trong bảng đó không bị thay đổi.
CREATE TABLE IF NOT EXISTS `lessons_legacy_content_backup_20260817` (
  `lesson_id` BIGINT NOT NULL,
  `lesson_document` LONGTEXT NULL,
  `lesson_baitap` VARCHAR(500) NULL,
  `lesson_tomtat` VARCHAR(500) NULL,
  `lesson_phuongphap` VARCHAR(500) NULL,
  `lesson_luuy` VARCHAR(500) NULL,
  `lesson_ketqua` VARCHAR(500) NULL,
  `evg_banner` VARCHAR(500) NULL,
  `evg_stream` VARCHAR(500) NULL,
  `lesson_link` VARCHAR(500) NULL,
  `archived_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`lesson_id`)
);

INSERT INTO `lessons_legacy_content_backup_20260817` (
  `lesson_id`,
  `lesson_document`,
  `lesson_baitap`,
  `lesson_tomtat`,
  `lesson_phuongphap`,
  `lesson_luuy`,
  `lesson_ketqua`,
  `evg_banner`,
  `evg_stream`,
  `lesson_link`
)
SELECT
  `id`,
  `lesson_document`,
  `lesson_baitap`,
  `lesson_tomtat`,
  `lesson_phuongphap`,
  `lesson_luuy`,
  `lesson_ketqua`,
  `evg_banner`,
  `evg_stream`,
  `lesson_link`
FROM `lessons`
ON DUPLICATE KEY UPDATE
  `lesson_document` = VALUES(`lesson_document`),
  `lesson_baitap` = VALUES(`lesson_baitap`),
  `lesson_tomtat` = VALUES(`lesson_tomtat`),
  `lesson_phuongphap` = VALUES(`lesson_phuongphap`),
  `lesson_luuy` = VALUES(`lesson_luuy`),
  `lesson_ketqua` = VALUES(`lesson_ketqua`),
  `evg_banner` = VALUES(`evg_banner`),
  `evg_stream` = VALUES(`evg_stream`),
  `lesson_link` = VALUES(`lesson_link`),
  `archived_at` = CURRENT_TIMESTAMP;

-- Các trường nội dung này thuộc dữ liệu từng buổi học trong `calendar`.
-- `lessons` chỉ còn quản lý đề cương (thứ tự và tên bài học).
ALTER TABLE `lessons`
  DROP COLUMN `lesson_document`,
  DROP COLUMN `lesson_baitap`,
  DROP COLUMN `lesson_tomtat`,
  DROP COLUMN `lesson_phuongphap`,
  DROP COLUMN `lesson_luuy`,
  DROP COLUMN `lesson_ketqua`,
  DROP COLUMN `evg_banner`,
  DROP COLUMN `evg_stream`,
  DROP COLUMN `lesson_link`;
