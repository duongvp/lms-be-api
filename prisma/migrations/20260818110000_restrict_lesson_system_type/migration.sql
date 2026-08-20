-- `lessons` only supports Topclass and Topuni. Calendar-specific system types
-- such as `event` and `phaken` must not be accepted in curriculum data.
ALTER TABLE `lessons`
  MODIFY COLUMN `system_type` ENUM('topclass', 'topuni') NOT NULL DEFAULT 'topclass';
