DROP TRIGGER IF EXISTS `trg_calendar_after_update`;
DROP TRIGGER IF EXISTS `trg_calendar_after_insert`;
DROP TRIGGER IF EXISTS `trg_calendar_status_notify`;

DELIMITER $$

CREATE TRIGGER `trg_calendar_after_insert`
AFTER INSERT ON `calendar`
FOR EACH ROW
BEGIN
    DECLARE clean_docs LONGTEXT;
    DECLARE docs_json JSON;

    SET clean_docs = TRIM(IFNULL(NULLIF(NEW.lesson_document, ''), '[]'));

    IF clean_docs != '[]' AND RIGHT(clean_docs, 1) != ']' THEN
        SET clean_docs = CONCAT(clean_docs, ']');
    END IF;

    IF JSON_VALID(clean_docs) THEN
        SET docs_json = JSON_EXTRACT(clean_docs, '$');
    ELSE
        SET docs_json = JSON_ARRAY();
    END IF;

    IF COALESCE(@lms_manual_hocmai_queue, 0) = 0
       AND NEW.`key` IS NOT NULL
       AND NEW.`key` != ''
    THEN
        INSERT INTO hocmai_sync_queue (c_key, action, payload, status)
        VALUES (
            NEW.`key`,
            'create',
            JSON_OBJECT(
                'c_key', NEW.`key`,
                'code', IFNULL(NEW.code, ''),
                'action', 'create',
                'subject', IFNULL(NEW.subject, ''),
                'start_time', IFNULL(DATE_FORMAT(NEW.start_time, '%Y-%m-%d %H:%i:%s'), ''),
                'end_time', IFNULL(DATE_FORMAT(NEW.end_time, '%Y-%m-%d %H:%i:%s'), ''),
                'teacher_name', IFNULL(NEW.teacher, ''),
                'title', IFNULL(NEW.lesson_name, ''),
                'learn_number', IFNULL(NEW.learn_number, 0),
                'lesson_status', IFNULL(NEW.lesson_status, 0),
                'documents', docs_json,
                'lesson_noti', IFNULL(NEW.lesson_noti, '')
            ),
            0
        );
    END IF;
END$$

CREATE TRIGGER `trg_calendar_after_update`
AFTER UPDATE ON `calendar`
FOR EACH ROW
BEGIN
    DECLARE clean_docs LONGTEXT;
    DECLARE docs_json JSON;

    SET clean_docs = TRIM(IFNULL(NULLIF(NEW.lesson_document, ''), '[]'));

    IF clean_docs != '[]' AND RIGHT(clean_docs, 1) != ']' THEN
        SET clean_docs = CONCAT(clean_docs, ']');
    END IF;

    IF JSON_VALID(clean_docs) THEN
        SET docs_json = JSON_EXTRACT(clean_docs, '$');
    ELSE
        SET docs_json = JSON_ARRAY();
    END IF;

    IF COALESCE(@lms_manual_hocmai_queue, 0) = 0
       AND NEW.`key` IS NOT NULL
       AND NEW.`key` != ''
       AND (
           NOT (OLD.`key` <=> NEW.`key`)
           OR NOT (OLD.code <=> NEW.code)
           OR NOT (OLD.learn_number <=> NEW.learn_number)
           OR NOT (OLD.subject <=> NEW.subject)
           OR NOT (OLD.start_time <=> NEW.start_time)
           OR NOT (OLD.end_time <=> NEW.end_time)
           OR NOT (OLD.teacher <=> NEW.teacher)
           OR NOT (OLD.lesson_name <=> NEW.lesson_name)
           OR NOT (OLD.lesson_document <=> NEW.lesson_document)
       )
    THEN
        INSERT INTO hocmai_sync_queue (c_key, action, payload, status)
        VALUES (
            NEW.`key`,
            'update',
            JSON_OBJECT(
                'c_key', NEW.`key`,
                'code', IFNULL(NEW.code, ''),
                'action', 'update',
                'subject', IFNULL(NEW.subject, ''),
                'start_time', IFNULL(DATE_FORMAT(NEW.start_time, '%Y-%m-%d %H:%i:%s'), ''),
                'end_time', IFNULL(DATE_FORMAT(NEW.end_time, '%Y-%m-%d %H:%i:%s'), ''),
                'teacher_name', IFNULL(NEW.teacher, ''),
                'title', IFNULL(NEW.lesson_name, ''),
                'learn_number', IFNULL(NEW.learn_number, 0),
                'lesson_status', IFNULL(NEW.lesson_status, 0),
                'documents', docs_json,
                'lesson_noti', IFNULL(NEW.lesson_noti, '')
            ),
            0
        );
    END IF;
END$$

CREATE TRIGGER `trg_calendar_status_notify`
AFTER UPDATE ON `calendar`
FOR EACH ROW
BEGIN
    IF COALESCE(@lms_manual_hocmai_queue, 0) = 0
       AND NEW.`key` IS NOT NULL
       AND NEW.`key` != ''
       AND (
           NOT (OLD.lesson_status <=> NEW.lesson_status)
           OR NOT (OLD.lesson_noti <=> NEW.lesson_noti)
       )
    THEN
        INSERT INTO hocmai_sync_queue (c_key, action, payload, status)
        VALUES (
            NEW.`key`,
            'update-status-lesson',
            JSON_OBJECT(
                'c_key', NEW.`key`,
                'status', CAST(NEW.lesson_status AS CHAR),
                'notify', NEW.lesson_noti,
                'target', 'https://hocmai.vn'
            ),
            0
        );
    END IF;
END$$

DELIMITER ;
