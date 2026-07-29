INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES
    ('roles.view', 'View roles', 'Cho phép xem vai trò và cấu trúc quyền', NOW(3), NOW(3)),
    ('roles.create', 'Create roles', 'Cho phép tạo vai trò', NOW(3), NOW(3)),
    ('roles.update', 'Update roles', 'Cho phép cập nhật vai trò và field policy', NOW(3), NOW(3)),
    ('roles.delete', 'Delete roles', 'Cho phép xóa vai trò', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `updatedAt` = NOW(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role.id, permission.id, NOW(3)
FROM `roles` AS role
CROSS JOIN `permissions` AS permission
WHERE role.code = 'admin'
  AND permission.code IN (
      'roles.view',
      'roles.create',
      'roles.update',
      'roles.delete'
  );
