-- Link lịch legacy với lesson Topuni vừa backfill.
-- `updated_at` is explicitly preserved because the column has ON UPDATE CURRENT_TIMESTAMP.
UPDATE `calendar` AS calendar_row
INNER JOIN `lessons` AS lesson_row
  ON lesson_row.`subject_code` = calendar_row.`code`
 AND lesson_row.`learn_number` = calendar_row.`learn_number`
 AND lesson_row.`system_type` = calendar_row.`system_type`
 AND lesson_row.`status` <> 0
SET
  calendar_row.`session_id` = lesson_row.`id`,
  calendar_row.`updated_at` = calendar_row.`updated_at`
WHERE calendar_row.`session_id` IS NULL
  AND lesson_row.`system_type` = 'topuni'
  AND lesson_row.`grade` IS NULL
  AND lesson_row.`created_at` = '2026-08-18 10:58:01.197';
