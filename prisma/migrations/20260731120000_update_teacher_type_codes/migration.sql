UPDATE `teacher_profiles`
SET `teacher_type` = CASE
    WHEN `teacher_type` = 0 THEN 1
    WHEN `teacher_type` = 1 THEN 2
    ELSE `teacher_type`
END;

ALTER TABLE `teacher_profiles`
    MODIFY `teacher_type` TINYINT NOT NULL DEFAULT 1;
