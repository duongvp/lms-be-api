-- Grade is decided by the UI; keep the database nullable for Topuni.
ALTER TABLE `lessons`
  MODIFY COLUMN `grade` INT NULL;
