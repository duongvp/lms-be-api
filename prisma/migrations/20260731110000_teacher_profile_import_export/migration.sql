INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES
    ('teacher_profile.import', 'Nhập file nhân sự giảng dạy', 'Cho phép nhập giáo viên và trợ giảng từ Excel/CSV', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile.export', 'Xuất file nhân sự giảng dạy', 'Cho phép xuất giáo viên và trợ giảng ra Excel/CSV', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role.id, permission.id, CURRENT_TIMESTAMP(3)
FROM `roles` AS role
JOIN `permissions` AS permission
  ON permission.code IN ('teacher_profile.import', 'teacher_profile.export')
WHERE role.code IN ('admin', 'manager');

UPDATE `module_fields` AS field
JOIN `modules` AS module ON module.id = field.moduleId
SET
    field.fieldLabel = CASE field.fieldCode
        WHEN 'username' THEN 'Mã nhân sự'
        WHEN 'display_name' THEN 'Họ và tên'
        WHEN 'teacher_type' THEN 'Loại nhân sự'
        WHEN 'status' THEN 'Trạng thái'
        WHEN 'created_at' THEN 'Ngày tạo'
        WHEN 'updated_at' THEN 'Ngày cập nhật'
        ELSE field.fieldLabel
    END
WHERE module.code = 'teacher_profile';
