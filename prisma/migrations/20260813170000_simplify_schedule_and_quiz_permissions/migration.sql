START TRANSACTION;

-- Bảo đảm registry field của Cấu hình phòng học có mặt trước khi API enforce field policy.
INSERT INTO `modules` (`code`, `name`, `createdAt`, `updatedAt`)
VALUES ('room_config', 'Cấu hình phòng học', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `module_fields` (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT module_row.`id`, field_row.`fieldCode`, field_row.`fieldLabel`, field_row.`fieldType`, field_row.`sortOrder`
FROM `modules` AS module_row
JOIN (
  SELECT 'code' AS fieldCode, 'Mã chương trình' AS fieldLabel, 'text' AS fieldType, 1 AS sortOrder
  UNION ALL SELECT 'learn_number', 'Bài học', 'number', 2
  UNION ALL SELECT 'config', 'Cấu hình phòng học', 'json', 3
  UNION ALL SELECT 'teacher', 'Giáo viên phụ trách', 'text', 4
  UNION ALL SELECT 'assistant_teacher', 'Trợ giảng phụ trách', 'text', 5
  UNION ALL SELECT 'updated_by', 'Người cập nhật', 'text', 6
  UNION ALL SELECT 'updated_at', 'Thời gian cập nhật', 'datetime', 7
) AS field_row
WHERE module_row.`code` = 'room_config';

-- Các role đã có quyền Room config được khởi tạo policy tương ứng; không đụng các module khác.
UPDATE `roles` AS role_row
INNER JOIN `role_permissions` AS role_mapping ON role_mapping.`roleId` = role_row.`id`
INNER JOIN `permissions` AS permission ON permission.`id` = role_mapping.`permissionId`
SET role_row.`fieldPolicy` = JSON_SET(
  COALESCE(role_row.`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
  '$.modules.room_config', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', FALSE)))
)
WHERE permission.`code` IN ('room_config.view', 'room_config.create', 'room_config.update', 'room_config.import');

UPDATE `roles` AS role_row
INNER JOIN `role_permissions` AS role_mapping ON role_mapping.`roleId` = role_row.`id`
INNER JOIN `permissions` AS permission ON permission.`id` = role_mapping.`permissionId`
SET role_row.`fieldPolicy` = JSON_SET(
  COALESCE(role_row.`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
  '$.modules.room_config', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', TRUE)))
)
WHERE permission.`code` IN ('room_config.create', 'room_config.update', 'room_config.import');

-- Chuyển quyền phân công lịch học sang một action chung trước khi loại bỏ action cũ.
INSERT INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES ('calendar.teacher.manage', 'Quản lý phân công', 'Gán, thay đổi hoặc gỡ giáo viên và trợ giảng trong lịch học', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT DISTINCT old_mapping.`roleId`, new_permission.`id`, CURRENT_TIMESTAMP(3)
FROM `role_permissions` AS old_mapping
INNER JOIN `permissions` AS old_permission ON old_permission.`id` = old_mapping.`permissionId`
INNER JOIN `permissions` AS new_permission ON new_permission.`code` = 'calendar.teacher.manage'
WHERE old_permission.`code` IN ('calendar.teacher.assign', 'calendar.teacher.update');

-- Không có endpoint/UI cho approve, view hoặc remove riêng; remove được xử lý bởi update phân công.
DELETE role_mapping
FROM `role_permissions` AS role_mapping
INNER JOIN `permissions` AS permission ON permission.`id` = role_mapping.`permissionId`
WHERE permission.`code` IN (
  'calendar.teacher.view',
  'calendar.teacher.assign',
  'calendar.teacher.update',
  'calendar.teacher.remove',
  'calendar.approve',
  'quiz.grade',
  'room_config.delete'
);

DELETE FROM `permissions`
WHERE `code` IN (
  'calendar.teacher.view',
  'calendar.teacher.assign',
  'calendar.teacher.update',
  'calendar.teacher.remove',
  'calendar.approve',
  'quiz.grade',
  'room_config.delete'
);

COMMIT;
