-- Topuni hiện dùng grade mặc định 12.
UPDATE `lessons`
SET `grade` = 12
WHERE `system_type` = 'topuni'
  AND `grade` IS NULL;

-- Backfill các chương trình Topclass có grade xác định được từ mã chương trình.
INSERT INTO `lessons` (
  `grade`, `system_type`, `subject_code`, `subject_name`, `learn_number`,
  `lesson_name`, `status`, `created_at`, `updated_at`
)
SELECT
  CASE calendar_row.`code`
    WHEN 'lophoche-toan-6-2027' THEN 6
    WHEN 'lophoche-toan-7-2027' THEN 7
    WHEN 'lophoche-toan-8-2027' THEN 8
    WHEN 'lophoche-toan-9-2027' THEN 9
  END,
  'topclass',
  calendar_row.`code`,
  COALESCE(NULLIF(TRIM(calendar_row.`subject`), ''), calendar_row.`code`),
  calendar_row.`learn_number`,
  COALESCE(NULLIF(TRIM(calendar_row.`lesson_name`), ''), CONCAT('Bài ', calendar_row.`learn_number`)),
  1,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `calendar` AS calendar_row
LEFT JOIN `lessons` AS existing_lesson
  ON existing_lesson.`subject_code` = calendar_row.`code`
 AND existing_lesson.`learn_number` = calendar_row.`learn_number`
WHERE calendar_row.`code` IN (
  'lophoche-toan-6-2027',
  'lophoche-toan-7-2027',
  'lophoche-toan-8-2027',
  'lophoche-toan-9-2027'
)
  AND calendar_row.`system_type` = 'topclass'
  AND existing_lesson.`id` IS NULL;

-- `thucchientoantsav2027` chỉ có Topuni. Slot 16 có hai định nghĩa lịch
-- khác nhau nên được giữ lại để xử lý thủ công; các slot còn lại an toàn.
INSERT INTO `lessons` (
  `grade`, `system_type`, `subject_code`, `subject_name`, `learn_number`,
  `lesson_name`, `status`, `created_at`, `updated_at`
)
SELECT
  12,
  'topuni',
  calendar_row.`code`,
  COALESCE(NULLIF(TRIM(calendar_row.`subject`), ''), calendar_row.`code`),
  calendar_row.`learn_number`,
  COALESCE(NULLIF(TRIM(calendar_row.`lesson_name`), ''), CONCAT('Bài ', calendar_row.`learn_number`)),
  1,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `calendar` AS calendar_row
LEFT JOIN `lessons` AS existing_lesson
  ON existing_lesson.`subject_code` = calendar_row.`code`
 AND existing_lesson.`learn_number` = calendar_row.`learn_number`
WHERE calendar_row.`code` = 'thucchientoantsav2027'
  AND calendar_row.`system_type` = 'topuni'
  AND calendar_row.`learn_number` <> 16
  AND existing_lesson.`id` IS NULL;
