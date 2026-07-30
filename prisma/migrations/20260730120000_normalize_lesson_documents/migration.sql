-- Chuẩn hóa dữ liệu legacy chỉ lưu một chuỗi/URL thành cùng cấu trúc documents
-- mà calendar production và HMO đang sử dụng.
UPDATE `lessons`
SET `lesson_document` = JSON_ARRAY(
    JSON_OBJECT(
        'link', TRIM(`lesson_document`),
        'title', 'Tài liệu bài học',
        'type', 'pdf'
    )
)
WHERE `lesson_document` IS NOT NULL
  AND TRIM(`lesson_document`) <> ''
  AND (
      NOT JSON_VALID(`lesson_document`)
      OR JSON_TYPE(CAST(`lesson_document` AS JSON)) <> 'ARRAY'
  );
