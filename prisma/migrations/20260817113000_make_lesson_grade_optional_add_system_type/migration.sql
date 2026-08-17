-- Topuni does not use a grade. Existing lesson rows remain Topclass.
ALTER TABLE `lessons`
  MODIFY COLUMN `grade` INT NULL,
  ADD COLUMN `system_type` ENUM('topclass', 'topuni') NOT NULL DEFAULT 'topclass' AFTER `grade`;

ALTER TABLE `lessons`
  DROP INDEX `uq_lessons_grade_subject_learn`,
  ADD UNIQUE INDEX `uq_lessons_subject_learn` (`subject_code`, `learn_number`);
