-- Các phiên bản trước snapshot rồi copy mapping xuống chuỗi nhưng vẫn giữ
-- mapping tại key nguồn đã nghỉ. Chỉ dọn nguồn của nghiệp vụ "following";
-- lịch nghỉ không dời vẫn giữ nguyên mapping.
DELETE mapping
FROM `package_lesson_mapping` AS mapping
INNER JOIN `calendar` AS canceled_calendar
    ON canceled_calendar.`key` = mapping.`key`
   AND canceled_calendar.`lesson_status` = 1
INNER JOIN `calendar_change_logs` AS change_log
    ON change_log.`old_key` = canceled_calendar.`key`
   AND change_log.`action` = 'following';
