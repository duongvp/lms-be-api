DROP TABLE IF EXISTS `hmo_package_courses`;

UPDATE `module_fields` mf
INNER JOIN `modules` m ON m.`id` = mf.`moduleId`
SET
    mf.`fieldLabel` = CASE mf.`fieldCode`
        WHEN 'course_id' THEN 'Course ID'
        WHEN 'external_lesson_id' THEN 'Lesson ID'
        ELSE mf.`fieldLabel`
    END,
    mf.`fieldType` = CASE mf.`fieldCode`
        WHEN 'course_id' THEN 'text'
        ELSE mf.`fieldType`
    END
WHERE m.`code` = 'lessons'
  AND mf.`fieldCode` IN ('course_id', 'external_lesson_id');
