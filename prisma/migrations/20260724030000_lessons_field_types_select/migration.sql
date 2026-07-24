UPDATE `module_fields` mf
JOIN `modules` m ON m.id = mf.moduleId AND m.code = 'lessons'
SET mf.fieldType = CASE mf.fieldCode
    WHEN 'grade' THEN 'select'
    WHEN 'subject_name' THEN 'select'
    ELSE mf.fieldType
END
WHERE mf.fieldCode IN ('grade', 'subject_name');
