ALTER TABLE `calendar`
    MODIFY COLUMN `lesson_document` LONGTEXT NULL;

ALTER TABLE `lessons`
    MODIFY COLUMN `lesson_document` LONGTEXT NULL,
    ADD COLUMN `evg_banner` VARCHAR(500) NULL AFTER `lesson_document`,
    ADD COLUMN `evg_stream` VARCHAR(500) NULL AFTER `evg_banner`,
    ADD COLUMN `lesson_link` VARCHAR(500) NULL AFTER `evg_stream`;

INSERT INTO `module_fields` (
    `moduleId`,
    `fieldCode`,
    `fieldLabel`,
    `fieldType`,
    `sortOrder`
)
SELECT
    module_row.`id`,
    new_field.`fieldCode`,
    new_field.`fieldLabel`,
    new_field.`fieldType`,
    new_field.`sortOrder`
FROM `modules` AS module_row
INNER JOIN (
    SELECT 'evg_banner' AS fieldCode, 'Banner' AS fieldLabel, 'text' AS fieldType, 7 AS sortOrder
    UNION ALL
    SELECT 'evg_stream', 'EVG Stream', 'text', 8
    UNION ALL
    SELECT 'lesson_link', 'Link bài học', 'text', 9
) AS new_field
WHERE module_row.`code` = 'lessons'
  AND NOT EXISTS (
      SELECT 1
      FROM `module_fields` AS existing_field
      WHERE existing_field.`moduleId` = module_row.`id`
        AND existing_field.`fieldCode` = new_field.`fieldCode`
  );

UPDATE `module_fields` AS field_row
INNER JOIN `modules` AS module_row
    ON module_row.`id` = field_row.`moduleId`
SET field_row.`sortOrder` = CASE field_row.`fieldCode`
    WHEN 'id' THEN 1
    WHEN 'grade' THEN 2
    WHEN 'subject_name' THEN 3
    WHEN 'learn_number' THEN 4
    WHEN 'lesson_name' THEN 5
    WHEN 'lesson_document' THEN 6
    WHEN 'evg_banner' THEN 7
    WHEN 'evg_stream' THEN 8
    WHEN 'lesson_link' THEN 9
    WHEN 'lesson_baitap' THEN 10
    WHEN 'lesson_tomtat' THEN 11
    WHEN 'lesson_phuongphap' THEN 12
    WHEN 'lesson_luuy' THEN 13
    WHEN 'lesson_ketqua' THEN 14
    WHEN 'status' THEN 15
    WHEN 'created_at' THEN 16
    WHEN 'updated_at' THEN 17
    ELSE field_row.`sortOrder`
END
WHERE module_row.`code` = 'lessons';
