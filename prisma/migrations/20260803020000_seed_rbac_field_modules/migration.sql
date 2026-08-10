INSERT INTO `modules` (`code`, `name`, `createdAt`, `updatedAt`)
VALUES
    ('users', 'Quản trị viên', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('calendar', 'Quản lý lịch học', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('teacher_profile', 'Giáo viên & Trợ giảng', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
    `name` = VALUES(`name`),
    `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `module_fields`
    (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT module_row.id, field_row.fieldCode, field_row.fieldLabel, field_row.fieldType, field_row.sortOrder
FROM `modules` AS module_row
JOIN (
    SELECT 'users' moduleCode, 'id' fieldCode, 'ID' fieldLabel, 'number' fieldType, 1 sortOrder
    UNION ALL SELECT 'users', 'username', 'Tên đăng nhập', 'text', 2
    UNION ALL SELECT 'users', 'name', 'Họ tên', 'text', 3
    UNION ALL SELECT 'users', 'email', 'Email', 'text', 4
    UNION ALL SELECT 'users', 'phone', 'Số điện thoại', 'text', 5
    UNION ALL SELECT 'users', 'code', 'Khóa học', 'text', 6
    UNION ALL SELECT 'users', 'learn_number', 'Buổi học', 'number', 7
    UNION ALL SELECT 'users', 'class_id', 'ID lớp học', 'text', 8
    UNION ALL SELECT 'users', 'room_id', 'ID phòng', 'number', 9
    UNION ALL SELECT 'users', 'islearn', 'Trạng thái học', 'number', 10
    UNION ALL SELECT 'users', 'created_at', 'Ngày tạo', 'datetime', 11
    UNION ALL SELECT 'users', 'updated_at', 'Ngày cập nhật', 'datetime', 12

    UNION ALL SELECT 'calendar', 'id', 'ID', 'number', 1
    UNION ALL SELECT 'calendar', 'code', 'Khóa học', 'text', 2
    UNION ALL SELECT 'calendar', 'learn_number', 'Buổi học', 'number', 3
    UNION ALL SELECT 'calendar', 'subject', 'Môn học', 'text', 4
    UNION ALL SELECT 'calendar', 'start_time', 'Bắt đầu', 'datetime', 5
    UNION ALL SELECT 'calendar', 'end_time', 'Kết thúc', 'datetime', 6
    UNION ALL SELECT 'calendar', 'teacher', 'Giáo viên', 'text', 7
    UNION ALL SELECT 'calendar', 'assistant_teacher', 'Trợ giảng', 'select', 8
    UNION ALL SELECT 'calendar', 'lesson_name', 'Tên bài học', 'text', 9
    UNION ALL SELECT 'calendar', 'lesson_link', 'Link bài học', 'text', 10
    UNION ALL SELECT 'calendar', 'lesson_document', 'Tài liệu', 'text', 11
    UNION ALL SELECT 'calendar', 'evg_stream', 'Stream', 'text', 12
    UNION ALL SELECT 'calendar', 'lesson_status', 'Trạng thái', 'number', 13

    UNION ALL SELECT 'teacher_profile', 'id', 'ID', 'number', 1
    UNION ALL SELECT 'teacher_profile', 'username', 'Tên đăng nhập', 'text', 2
    UNION ALL SELECT 'teacher_profile', 'display_name', 'Tên hiển thị', 'text', 3
    UNION ALL SELECT 'teacher_profile', 'teacher_type', 'Loại nhân sự', 'select', 4
    UNION ALL SELECT 'teacher_profile', 'status', 'Trạng thái', 'select', 5
    UNION ALL SELECT 'teacher_profile', 'created_at', 'Ngày tạo', 'datetime', 6
    UNION ALL SELECT 'teacher_profile', 'updated_at', 'Ngày cập nhật', 'datetime', 7
) AS field_row ON field_row.moduleCode = module_row.code
WHERE module_row.code IN ('users', 'calendar', 'teacher_profile');

-- Không ghi đè cấu hình đã có; chỉ bổ sung module còn thiếu vào fieldPolicy.
UPDATE `roles`
SET `fieldPolicy` = JSON_INSERT(
    COALESCE(`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
    '$."modules"."users"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', TRUE))),
    '$."modules"."calendar"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', TRUE))),
    '$."modules"."teacher_profile"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', TRUE)))
)
WHERE `code` IN ('admin', 'manager');

UPDATE `roles`
SET `fieldPolicy` = JSON_INSERT(
    COALESCE(`fieldPolicy`, JSON_OBJECT('modules', JSON_OBJECT())),
    '$."modules"."users"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', FALSE, 'editable', FALSE))),
    '$."modules"."calendar"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', TRUE))),
    '$."modules"."teacher_profile"', JSON_OBJECT('fields', JSON_OBJECT('*', JSON_OBJECT('visible', TRUE, 'editable', FALSE)))
)
WHERE `code` IN ('teacher', 'student');
