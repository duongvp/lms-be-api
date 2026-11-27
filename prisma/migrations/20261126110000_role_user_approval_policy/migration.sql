-- Reuse existing Role and account-approval configuration; no new RBAC/workflow tables.
ALTER TABLE `roles` ADD COLUMN `approval_policy` JSON NULL;
ALTER TABLE `calendar_approval_accounts` ADD COLUMN `operation_overrides` JSON NULL;
ALTER TABLE `calendar_approval_requests` ADD COLUMN `approval_policy_snapshot` JSON NULL;
ALTER TABLE `calendar_approval_revisions` ADD COLUMN `approval_policy_snapshot` JSON NULL;

-- Preserve the pre-policy behavior of every existing Role. New/unconfigured Roles
-- use REQUIRE in the resolver, while existing Roles explicitly retain SKIP.
UPDATE `roles` SET `approval_policy` = JSON_OBJECT(
 'create','SKIP','update','SKIP','delete','SKIP','cancel','SKIP',
 'reschedule','SKIP','swap','SKIP','restore','SKIP','mapping','SKIP','import','SKIP');

-- Old checkbox selections defined the entire per-account policy. Preserve BOTH
-- checked REQUIRE and unchecked SKIP, independent of later Role changes.
UPDATE `calendar_approval_accounts` SET `operation_overrides` = JSON_OBJECT(
 'create', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('create')), 'REQUIRE','SKIP'),
 'update', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('update')), 'REQUIRE','SKIP'),
 'delete', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('delete')), 'REQUIRE','SKIP'),
 'cancel', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('cancel')), 'REQUIRE','SKIP'),
 'reschedule', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('reschedule')), 'REQUIRE','SKIP'),
 'swap', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('swap')), 'REQUIRE','SKIP'),
 'restore', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('restore')), 'REQUIRE','SKIP'),
 'mapping', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('mapping')), 'REQUIRE','SKIP'),
 'import', IF(JSON_CONTAINS(required_operations,JSON_QUOTE('import')), 'REQUIRE','SKIP'));

ALTER TABLE `calendar_approval_accounts` ADD CONSTRAINT `calendar_approval_accounts_user_id_fkey`
 FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
