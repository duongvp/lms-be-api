INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES ('program_teacher_banner.import', 'Import banner chương trình - giáo viên', 'Cho phép import nhanh cấu hình banner từ CSV/XLSX', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `updatedAt` = VALUES(`updatedAt`);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role_row.id, permission_row.id, CURRENT_TIMESTAMP(3)
FROM `roles` role_row
JOIN `permissions` permission_row ON permission_row.code = 'program_teacher_banner.import'
WHERE role_row.code = 'admin';
