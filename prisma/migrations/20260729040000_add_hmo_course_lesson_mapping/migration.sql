ALTER TABLE `lessons`
    ADD COLUMN `course_id` VARCHAR(50) NULL AFTER `id`,
    ADD COLUMN `external_lesson_id` VARCHAR(50) NULL AFTER `course_id`,
    ADD UNIQUE INDEX `uq_lessons_course_external_lesson` (`course_id`, `external_lesson_id`),
    ADD INDEX `idx_lessons_course` (`course_id`);

CREATE TABLE `hmo_package_courses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `package_id` VARCHAR(50) NOT NULL,
    `course_id` VARCHAR(50) NOT NULL,
    `course_name` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_hmo_package_courses_course` (`course_id`),
    INDEX `idx_hmo_package_courses_package` (`package_id`),
    INDEX `idx_hmo_package_courses_active_course` (`is_active`, `course_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `package_lesson_mapping`
    ADD COLUMN `course_id` VARCHAR(50) NULL AFTER `package_id`,
    ADD INDEX `idx_plm_course_lesson` (`course_id`, `lesson_id`);

INSERT IGNORE INTO `module_fields`
    (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT
    `id`, 'course_id', 'Mã khóa học HMO', 'select', 2
FROM `modules`
WHERE `code` = 'lessons';

INSERT IGNORE INTO `module_fields`
    (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT
    `id`, 'external_lesson_id', 'Lesson ID HMO', 'text', 3
FROM `modules`
WHERE `code` = 'lessons';

UPDATE `module_fields` mf
INNER JOIN `modules` m ON m.`id` = mf.`moduleId`
SET mf.`sortOrder` = CASE mf.`fieldCode`
    WHEN 'id' THEN 1
    WHEN 'course_id' THEN 2
    WHEN 'external_lesson_id' THEN 3
    WHEN 'grade' THEN 4
    WHEN 'subject_name' THEN 5
    WHEN 'learn_number' THEN 6
    WHEN 'lesson_name' THEN 7
    WHEN 'lesson_document' THEN 8
    WHEN 'lesson_baitap' THEN 9
    WHEN 'lesson_tomtat' THEN 10
    WHEN 'lesson_phuongphap' THEN 11
    WHEN 'lesson_luuy' THEN 12
    WHEN 'lesson_ketqua' THEN 13
    WHEN 'status' THEN 14
    WHEN 'created_at' THEN 15
    WHEN 'updated_at' THEN 16
    ELSE mf.`sortOrder`
END
WHERE m.`code` = 'lessons';
