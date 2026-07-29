START TRANSACTION;

DELETE FROM `package_lesson_mapping`;
DELETE FROM `calendar`;

INSERT INTO `calendar` (
    `code`,
    `learn_number`,
    `subject`,
    `start_time`,
    `end_time`,
    `teacher`,
    `lesson_name`,
    `lesson_document`,
    `lesson_count`,
    `lesson_status`,
    `channel_name`,
    `key`,
    `system_type`
)
VALUES
    (
        'nguvan-6-2027',
        1,
        'Ngữ văn',
        '2026-08-03 19:00:00',
        '2026-08-03 21:00:00',
        'Nguyễn Văn A',
        'Bài 1 - Tôi và các bạn',
        '[]',
        0,
        0,
        'room-nguvan-6',
        'tc_2627_nguvan-6-2027_1_b1',
        'topclass'
    ),
    (
        'nguvan-6-2027',
        2,
        'Ngữ văn',
        '2026-08-10 19:00:00',
        '2026-08-10 21:00:00',
        'Nguyễn Văn A',
        'Bài 2 - Gõ cửa trái tim',
        '[]',
        0,
        0,
        'room-nguvan-6',
        'tc_2627_nguvan-6-2027_2_b1',
        'topclass'
    ),
    (
        'nguvan-6-2027',
        3,
        'Ngữ văn',
        '2026-08-17 19:00:00',
        '2026-08-17 21:00:00',
        'Nguyễn Văn A',
        'Bài 3 - Yêu thương và chia sẻ',
        '[]',
        0,
        0,
        'room-nguvan-6',
        'tc_2627_nguvan-6-2027_3_b1',
        'topclass'
    ),
    (
        'nguvan-6-2027',
        4,
        'Ngữ văn',
        '2026-08-24 19:00:00',
        '2026-08-24 21:00:00',
        'Nguyễn Văn A',
        'Bài 4 - Quê hương yêu dấu',
        '[]',
        0,
        0,
        'room-nguvan-6',
        'tc_2627_nguvan-6-2027_4_b1',
        'topclass'
    );

-- package_id, course_id và lesson_id là VARCHAR; dữ liệu mẫu dùng chuỗi số.
-- Quan hệ package/course lấy từ Google Sheet:
--   package 9150 -> course 1771 (Ngữ Văn 6 - Lớp tương tác)
--   package 9174 -> course 3355 (Ngữ Văn 6 - Lớp tương tác - Chương trình hè)
INSERT INTO `package_lesson_mapping` (
    `package_id`,
    `course_id`,
    `lesson_id`,
    `code`,
    `learn_number`,
    `key`
)
VALUES
    ('9150', '1771', '171233', 'nguvan-6-2027', 1, 'tc_2627_nguvan-6-2027_1_b1'),
    ('9174', '3355', '171310', 'nguvan-6-2027', 1, 'tc_2627_nguvan-6-2027_1_b1'),
    ('9150', '1771', '171234', 'nguvan-6-2027', 2, 'tc_2627_nguvan-6-2027_2_b1'),
    ('9174', '3355', '173131', 'nguvan-6-2027', 2, 'tc_2627_nguvan-6-2027_2_b1'),
    ('9150', '1771', '171237', 'nguvan-6-2027', 3, 'tc_2627_nguvan-6-2027_3_b1'),
    ('9174', '3355', '173134', 'nguvan-6-2027', 3, 'tc_2627_nguvan-6-2027_3_b1'),
    ('9150', '1771', '174392', 'nguvan-6-2027', 4, 'tc_2627_nguvan-6-2027_4_b1');

COMMIT;
