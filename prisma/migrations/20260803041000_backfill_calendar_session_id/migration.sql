UPDATE `calendar` AS calendar_row
INNER JOIN (
    SELECT `subject_code`, `learn_number`, MIN(`id`) AS `lesson_id`
    FROM `lessons`
    WHERE `status` <> 0
    GROUP BY `subject_code`, `learn_number`
    HAVING COUNT(*) = 1
) AS lesson_match
    ON lesson_match.`subject_code` = calendar_row.`code`
   AND lesson_match.`learn_number` = calendar_row.`learn_number`
SET calendar_row.`session_id` = lesson_match.`lesson_id`
WHERE calendar_row.`session_id` IS NULL;
