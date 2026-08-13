START TRANSACTION;

-- Màn Quản lý đề cương chỉ cho người dùng thao tác trực tiếp số thứ tự và tên bài.
-- Ngữ cảnh khối/môn/chương trình được chọn bằng bộ lọc; metadata và nội dung cũ không còn UI.
UPDATE `modules`
SET `name` = 'Quản lý đề cương', `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `code` = 'lessons';

-- Dọn các rule cũ để lần lưu vai trò kế tiếp không bị validation từ chối field đã bỏ.
UPDATE `roles`
SET `fieldPolicy` = JSON_REMOVE(
  `fieldPolicy`,
  '$.modules.lessons.fields.id',
  '$.modules.lessons.fields.grade',
  '$.modules.lessons.fields.subject_name',
  '$.modules.lessons.fields.subject_code',
  '$.modules.lessons.fields.lesson_document',
  '$.modules.lessons.fields.evg_banner',
  '$.modules.lessons.fields.evg_stream',
  '$.modules.lessons.fields.lesson_link',
  '$.modules.lessons.fields.lesson_baitap',
  '$.modules.lessons.fields.lesson_tomtat',
  '$.modules.lessons.fields.lesson_phuongphap',
  '$.modules.lessons.fields.lesson_luuy',
  '$.modules.lessons.fields.lesson_ketqua',
  '$.modules.lessons.fields.status',
  '$.modules.lessons.fields.created_at',
  '$.modules.lessons.fields.updated_at'
)
WHERE `fieldPolicy` IS NOT NULL;

DELETE field_row
FROM `module_fields` AS field_row
INNER JOIN `modules` AS module_row ON module_row.`id` = field_row.`moduleId`
WHERE module_row.`code` = 'lessons'
  AND field_row.`fieldCode` NOT IN ('learn_number', 'lesson_name');

INSERT INTO `module_fields` (`moduleId`, `fieldCode`, `fieldLabel`, `fieldType`, `sortOrder`)
SELECT module_row.`id`, field_row.`fieldCode`, field_row.`fieldLabel`, field_row.`fieldType`, field_row.`sortOrder`
FROM `modules` AS module_row
JOIN (
  SELECT 'learn_number' AS fieldCode, 'Số thứ tự bài' AS fieldLabel, 'number' AS fieldType, 1 AS sortOrder
  UNION ALL SELECT 'lesson_name', 'Tên bài học', 'text', 2
) AS field_row
WHERE module_row.`code` = 'lessons'
ON DUPLICATE KEY UPDATE
  `fieldLabel` = VALUES(`fieldLabel`),
  `fieldType` = VALUES(`fieldType`),
  `sortOrder` = VALUES(`sortOrder`);

COMMIT;
