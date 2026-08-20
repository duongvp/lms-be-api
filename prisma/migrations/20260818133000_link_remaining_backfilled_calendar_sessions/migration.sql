-- Link only calendars that are still missing a session to their matching active lesson.
-- `updated_at` is assigned to itself because MySQL otherwise changes it automatically
-- during an UPDATE; no calendar value other than `session_id` is changed.
UPDATE `calendar` AS calendar_row
INNER JOIN `lessons` AS lesson_row
  ON lesson_row.`subject_code` = calendar_row.`code`
 AND lesson_row.`learn_number` = calendar_row.`learn_number`
 AND lesson_row.`system_type` = calendar_row.`system_type`
 AND lesson_row.`status` <> 0
SET calendar_row.`session_id` = lesson_row.`id`,
    calendar_row.`updated_at` = calendar_row.`updated_at`
WHERE calendar_row.`session_id` IS NULL
  AND calendar_row.`code` IN (
    'lophoche-toan-6-2027',
    'lophoche-toan-7-2027',
    'lophoche-toan-8-2027',
    'lophoche-toan-9-2027',
    'thucchientoantsav2027'
  );
