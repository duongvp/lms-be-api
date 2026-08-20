-- Backfill đề cương cho các chương trình legacy chỉ thuộc Topuni.
-- Loại trừ chương trình đã có lessons, chương trình có nhiều system_type,
-- và chương trình có slot lịch mâu thuẫn về nội dung.
INSERT INTO `lessons` (
  `grade`,
  `system_type`,
  `subject_code`,
  `subject_name`,
  `learn_number`,
  `lesson_name`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  NULL,
  'topuni',
  calendar_row.`code`,
  COALESCE(NULLIF(TRIM(calendar_row.`subject`), ''), calendar_row.`code`),
  calendar_row.`learn_number`,
  COALESCE(NULLIF(TRIM(calendar_row.`lesson_name`), ''), CONCAT('Bài ', calendar_row.`learn_number`)),
  1,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `calendar` AS calendar_row
INNER JOIN (
  SELECT candidate.`code`
  FROM (
    SELECT source_calendar.`code`
    FROM `calendar` AS source_calendar
    LEFT JOIN `lessons` AS source_lesson
      ON source_lesson.`subject_code` = source_calendar.`code`
    WHERE source_calendar.`code` IS NOT NULL
      AND TRIM(source_calendar.`code`) <> ''
    GROUP BY source_calendar.`code`
    HAVING COUNT(source_lesson.`id`) = 0
       AND COUNT(DISTINCT source_calendar.`system_type`) = 1
       AND MIN(source_calendar.`system_type`) = 'topuni'
  ) AS candidate
  LEFT JOIN (
    SELECT conflicting_slot.`code`
    FROM (
      SELECT source_calendar.`code`, source_calendar.`learn_number`
      FROM `calendar` AS source_calendar
      LEFT JOIN `lessons` AS source_lesson
        ON source_lesson.`subject_code` = source_calendar.`code`
      WHERE source_calendar.`code` IS NOT NULL
        AND TRIM(source_calendar.`code`) <> ''
      GROUP BY source_calendar.`code`, source_calendar.`learn_number`
      HAVING COUNT(source_lesson.`id`) = 0
         AND COUNT(DISTINCT CONCAT_WS(
           CHAR(31),
           COALESCE(source_calendar.`lesson_name`, '<NULL>'),
           COALESCE(source_calendar.`subject`, '<NULL>'),
           COALESCE(source_calendar.`system_type`, '<NULL>')
         )) > 1
    ) AS conflicting_slot
    GROUP BY conflicting_slot.`code`
  ) AS conflicting_program
    ON conflicting_program.`code` = candidate.`code`
  WHERE conflicting_program.`code` IS NULL
) AS eligible_program
  ON eligible_program.`code` = calendar_row.`code`
LEFT JOIN `lessons` AS existing_lesson
  ON existing_lesson.`subject_code` = calendar_row.`code`
 AND existing_lesson.`learn_number` = calendar_row.`learn_number`
WHERE existing_lesson.`id` IS NULL;
