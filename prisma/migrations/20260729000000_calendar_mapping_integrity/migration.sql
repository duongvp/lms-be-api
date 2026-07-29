-- A calendar key is the external SessionId. MySQL allows multiple NULL values
-- in a unique index, preserving legacy rows that have not received a key yet.
CREATE UNIQUE INDEX `uq_calendar_key` ON `calendar`(`key`);

-- A session can map to many packages, but each package has exactly one lesson
-- in that session.
CREATE UNIQUE INDEX `uq_plm_key_package`
    ON `package_lesson_mapping`(`key`, `package_id`);

-- Used when snapshotting/replacing all package mappings for a calendar key.
CREATE INDEX `idx_plm_key` ON `package_lesson_mapping`(`key`);
