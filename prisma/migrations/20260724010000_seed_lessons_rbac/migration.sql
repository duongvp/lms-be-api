INSERT IGNORE INTO `modules` (`code`, `name`, `createdAt`, `updatedAt`)
VALUES ('lessons', 'Nội dung bài học', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `module_fields` (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT m.id, f.fieldCode, f.fieldLabel, f.fieldType, f.sortOrder
FROM `modules` m
JOIN (
    SELECT 'id' fieldCode, 'ID' fieldLabel, 'number' fieldType, 1 sortOrder UNION ALL
    SELECT 'grade', 'Khối', 'number', 2 UNION ALL
    SELECT 'subject_code', 'Mã môn học', 'text', 3 UNION ALL
    SELECT 'subject_name', 'Tên môn học', 'text', 4 UNION ALL
    SELECT 'chapter_id', 'Chapter ID', 'number', 5 UNION ALL
    SELECT 'chapter_name', 'Tên chương', 'text', 6 UNION ALL
    SELECT 'code', 'Mã khóa học', 'text', 7 UNION ALL
    SELECT 'learn_number', 'Số thứ tự bài', 'number', 8 UNION ALL
    SELECT 'lesson_name', 'Tên bài học', 'text', 9 UNION ALL
    SELECT 'lesson_document', 'Tài liệu bài học', 'textarea', 10 UNION ALL
    SELECT 'lesson_baitap', 'Bài tập', 'textarea', 11 UNION ALL
    SELECT 'lesson_tomtat', 'Tóm tắt', 'textarea', 12 UNION ALL
    SELECT 'lesson_phuongphap', 'Phương pháp', 'textarea', 13 UNION ALL
    SELECT 'lesson_luuy', 'Lưu ý', 'textarea', 14 UNION ALL
    SELECT 'lesson_ketqua', 'Kết quả', 'textarea', 15 UNION ALL
    SELECT 'status', 'Trạng thái', 'number', 16 UNION ALL
    SELECT 'created_at', 'Ngày tạo', 'datetime', 17 UNION ALL
    SELECT 'updated_at', 'Ngày cập nhật', 'datetime', 18
) f ON m.code = 'lessons';

INSERT IGNORE INTO `permissions` (`code`, `name`, `description`, `createdAt`, `updatedAt`)
VALUES
    ('lessons.view', 'View lessons', 'Cho phép view dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('lessons.create', 'Create lessons', 'Cho phép create dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('lessons.update', 'Update lessons', 'Cho phép update dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('lessons.delete', 'Delete lessons', 'Cho phép delete dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('lessons.import', 'Import lessons', 'Cho phép import dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
    ('lessons.export', 'Export lessons', 'Cho phép export dữ liệu module lessons', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code LIKE 'lessons.%'
WHERE r.code = 'admin';

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('lessons.view', 'lessons.create', 'lessons.update')
WHERE r.code = 'manager';

INSERT IGNORE INTO `role_permissions` (`roleId`, `permissionId`, `createdAt`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'lessons.view'
WHERE r.code IN ('teacher', 'student');
