ALTER TABLE `calendar`
    ADD COLUMN `assistant_teacher` VARCHAR(500) NULL AFTER `teacher`;

ALTER TABLE `teacher_profiles`
    ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 AFTER `display_name`,
    ADD INDEX `idx_teacher_status_type` (`status`, `teacher_type`);

INSERT INTO `modules` (`code`, `name`, `createdAt`, `updatedAt`)
VALUES ('teacher_profile', 'Giáo viên & Trợ giảng', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `module_fields`
    (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT module.id, fields.fieldCode, fields.fieldLabel, fields.fieldType, fields.sortOrder
FROM `modules` AS module
JOIN (
    SELECT 'id' AS fieldCode, 'ID' AS fieldLabel, 'number' AS fieldType, 1 AS sortOrder
    UNION ALL SELECT 'username', 'Tên đăng nhập', 'text', 2
    UNION ALL SELECT 'display_name', 'Tên hiển thị', 'text', 3
    UNION ALL SELECT 'teacher_type', 'Loại nhân sự', 'select', 4
    UNION ALL SELECT 'status', 'Trạng thái', 'select', 5
    UNION ALL SELECT 'created_at', 'Ngày tạo', 'datetime', 6
    UNION ALL SELECT 'updated_at', 'Ngày cập nhật', 'datetime', 7
) AS fields
WHERE module.code = 'teacher_profile';

INSERT IGNORE INTO `module_fields`
    (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT module.id, 'assistant_teacher', 'Trợ giảng', 'select', 8
FROM `modules` AS module
WHERE module.code = 'calendar';

INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES
    ('teacher_profile.view', 'Xem giáo viên và trợ giảng', 'Cho phép xem danh sách nhân sự giảng dạy', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile.create', 'Thêm giáo viên và trợ giảng', 'Cho phép thêm nhân sự giảng dạy', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile.update', 'Sửa giáo viên và trợ giảng', 'Cho phép sửa nhân sự giảng dạy', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile.delete', 'Xóa giáo viên và trợ giảng', 'Cho phép xóa nhân sự chưa được sử dụng', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile.status', 'Thay đổi trạng thái nhân sự', 'Cho phép kích hoạt hoặc vô hiệu hóa nhân sự giảng dạy', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('calendar.teacher.view', 'Xem phân công giáo viên', 'Cho phép xem giáo viên và trợ giảng được phân công', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('calendar.teacher.assign', 'Gán giáo viên và trợ giảng', 'Cho phép phân công khi tạo lịch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('calendar.teacher.update', 'Cập nhật phân công', 'Cho phép thay đổi phân công trong lịch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('calendar.teacher.remove', 'Gỡ giáo viên và trợ giảng', 'Cho phép gỡ phân công khỏi lịch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `description` = VALUES(`description`),
    `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role.id, permission.id, CURRENT_TIMESTAMP(3)
FROM `roles` AS role
JOIN `permissions` AS permission
  ON permission.code LIKE 'teacher_profile.%'
  OR permission.code LIKE 'calendar.teacher.%'
WHERE role.code = 'admin';

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role.id, permission.id, CURRENT_TIMESTAMP(3)
FROM `roles` AS role
JOIN `permissions` AS permission
  ON permission.code IN (
      'teacher_profile.view',
      'teacher_profile.create',
      'teacher_profile.update',
      'teacher_profile.status',
      'calendar.teacher.view',
      'calendar.teacher.assign',
      'calendar.teacher.update',
      'calendar.teacher.remove'
  )
WHERE role.code = 'manager';

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT role.id, permission.id, CURRENT_TIMESTAMP(3)
FROM `roles` AS role
JOIN `permissions` AS permission
  ON permission.code IN ('teacher_profile.view', 'calendar.teacher.view')
WHERE role.code IN ('teacher', 'student');

UPDATE `roles`
SET `fieldPolicy` = JSON_SET(
    COALESCE(`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
    '$."modules"."teacher_profile"."fields"."*"',
    JSON_OBJECT('visible', TRUE, 'editable', TRUE),
    '$."modules"."calendar"."fields"."assistant_teacher"',
    JSON_OBJECT('visible', TRUE, 'editable', TRUE)
)
WHERE `code` IN ('admin', 'manager');

UPDATE `roles`
SET `fieldPolicy` = JSON_SET(
    COALESCE(`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
    '$."modules"."teacher_profile"."fields"."*"',
    JSON_OBJECT('visible', TRUE, 'editable', FALSE),
    '$."modules"."calendar"."fields"."assistant_teacher"',
    JSON_OBJECT('visible', TRUE, 'editable', FALSE)
)
WHERE `code` IN ('teacher', 'student');
