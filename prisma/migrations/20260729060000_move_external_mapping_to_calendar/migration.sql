ALTER TABLE `lessons`
    DROP INDEX `uq_lessons_course_external_lesson`,
    DROP INDEX `idx_lessons_course`,
    DROP COLUMN `external_lesson_id`,
    DROP COLUMN `course_id`;

ALTER TABLE `package_lesson_mapping`
    DROP INDEX `uq_plm_key_package`,
    ADD UNIQUE INDEX `uq_plm_key_package_lesson` (`key`, `package_id`, `lesson_id`);

DELETE mf
FROM `module_fields` mf
INNER JOIN `modules` m ON m.`id` = mf.`moduleId`
WHERE m.`code` = 'lessons'
  AND mf.`fieldCode` IN ('course_id', 'external_lesson_id');

UPDATE `module_fields` mf
INNER JOIN `modules` m ON m.`id` = mf.`moduleId`
SET mf.`sortOrder` = CASE mf.`fieldCode`
    WHEN 'id' THEN 1
    WHEN 'grade' THEN 2
    WHEN 'subject_name' THEN 3
    WHEN 'learn_number' THEN 4
    WHEN 'lesson_name' THEN 5
    WHEN 'lesson_document' THEN 6
    WHEN 'lesson_baitap' THEN 7
    WHEN 'lesson_tomtat' THEN 8
    WHEN 'lesson_phuongphap' THEN 9
    WHEN 'lesson_luuy' THEN 10
    WHEN 'lesson_ketqua' THEN 11
    WHEN 'status' THEN 12
    WHEN 'created_at' THEN 13
    WHEN 'updated_at' THEN 14
    ELSE mf.`sortOrder`
END
WHERE m.`code` = 'lessons';
