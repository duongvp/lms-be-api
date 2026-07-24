ALTER TABLE `lessons` DROP INDEX `uq_lessons_code_learn`;
ALTER TABLE `lessons` DROP INDEX `idx_lessons_chapter_id`;
ALTER TABLE `lessons` DROP INDEX `idx_lessons_code`;

ALTER TABLE `lessons`
    DROP COLUMN `code`,
    DROP COLUMN `chapter_id`,
    DROP COLUMN `chapter_name`;

ALTER TABLE `lessons`
    ADD UNIQUE INDEX `uq_lessons_grade_subject_learn` (`grade`, `subject_code`, `learn_number`);

DELETE mf
FROM `module_fields` mf
JOIN `modules` m ON m.id = mf.moduleId
WHERE m.code = 'lessons'
  AND mf.fieldCode IN ('code', 'chapter_id', 'chapter_name', 'subject_code');

UPDATE `module_fields` mf
JOIN `modules` m ON m.id = mf.moduleId AND m.code = 'lessons'
SET mf.sortOrder = CASE mf.fieldCode
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
    ELSE mf.sortOrder
END;
