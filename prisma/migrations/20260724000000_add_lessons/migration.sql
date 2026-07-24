-- CreateTable
CREATE TABLE `lessons` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `grade` INTEGER NOT NULL,
    `subject_code` VARCHAR(20) NOT NULL,
    `subject_name` VARCHAR(100) NOT NULL,
    `chapter_id` BIGINT NULL,
    `chapter_name` VARCHAR(200) NULL,
    `learn_number` INTEGER NOT NULL,
    `lesson_name` VARCHAR(400) NOT NULL,
    `lesson_document` VARCHAR(500) NULL,
    `lesson_baitap` VARCHAR(500) NULL,
    `lesson_tomtat` VARCHAR(500) NULL,
    `lesson_phuongphap` VARCHAR(500) NULL,
    `lesson_luuy` VARCHAR(500) NULL,
    `lesson_ketqua` VARCHAR(500) NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_lessons_code_learn`(`code`, `learn_number`),
    INDEX `idx_lessons_grade_subject`(`grade`, `subject_code`),
    INDEX `idx_lessons_chapter_id`(`chapter_id`),
    INDEX `idx_lessons_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
