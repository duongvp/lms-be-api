ALTER TABLE `lessons`
    MODIFY COLUMN `subject_code` VARCHAR(100) NOT NULL;

INSERT INTO `module_fields` (
    `moduleId`,
    `fieldCode`,
    `fieldLabel`,
    `fieldType`,
    `sortOrder`
)
SELECT
    module_row.`id`,
    'subject_code',
    'Mã môn học',
    'text',
    4
FROM `modules` AS module_row
WHERE module_row.`code` = 'lessons'
  AND NOT EXISTS (
      SELECT 1
      FROM `module_fields` AS existing_field
      WHERE existing_field.`moduleId` = module_row.`id`
        AND existing_field.`fieldCode` = 'subject_code'
  );

UPDATE `module_fields` AS field_row
INNER JOIN `modules` AS module_row
    ON module_row.`id` = field_row.`moduleId`
SET field_row.`sortOrder` = CASE field_row.`fieldCode`
    WHEN 'id' THEN 1
    WHEN 'grade' THEN 2
    WHEN 'subject_name' THEN 3
    WHEN 'subject_code' THEN 4
    WHEN 'learn_number' THEN 5
    WHEN 'lesson_name' THEN 6
    WHEN 'lesson_document' THEN 7
    WHEN 'evg_banner' THEN 8
    WHEN 'evg_stream' THEN 9
    WHEN 'lesson_link' THEN 10
    WHEN 'lesson_baitap' THEN 11
    WHEN 'lesson_tomtat' THEN 12
    WHEN 'lesson_phuongphap' THEN 13
    WHEN 'lesson_luuy' THEN 14
    WHEN 'lesson_ketqua' THEN 15
    WHEN 'status' THEN 16
    WHEN 'created_at' THEN 17
    WHEN 'updated_at' THEN 18
    ELSE field_row.`sortOrder`
END
WHERE module_row.`code` = 'lessons';
