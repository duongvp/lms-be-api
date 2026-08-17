"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCalendarsFromSheet = exports.importCalendarFromSheet = exports.validateCalendarImportOutlines = exports.buildUniquePackageCoursePairs = void 0;
const client_1 = require("@prisma/client");
const hocmai_course_outline_service_1 = require("../../integrations/hocmai-course-outline.service");
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const livestream_service_1 = require("./livestream.service");
const teams_notifications_1 = require("../teams-notifications");
const prisma = new client_1.PrismaClient();
const pairKey = (packageId, courseId) => `${packageId}::${courseId}`;
const getRowPackageCoursePairs = (row) => (row.packageCoursePairs
    ?? row.packageIds.flatMap((packageId) => (row.courseIds.map((courseId) => ({ packageId, courseId })))));
const mappingScheduleKey = (mapping, row) => [
    mapping.package_id,
    mapping.course_id,
    mapping.lesson_id,
    new Date(row.calendar.start_time).getTime(),
    new Date(row.calendar.end_time).getTime(),
].join('::');
const unique = (values) => Array.from(new Set(values));
const addError = (errors, error) => {
    const identity = [
        error.row,
        error.errorCode,
        error.packageId,
        error.courseId,
        error.lessonId,
        error.duplicateWithRow,
    ].join('::');
    if (!errors.some((item) => [
        item.row,
        item.errorCode,
        item.packageId,
        item.courseId,
        item.lessonId,
        item.duplicateWithRow,
    ].join('::') === identity)) {
        errors.push(error);
    }
};
const buildSummary = (rows, errors, pairCount, hmoRequests) => {
    const invalidRowNumbers = new Set(errors
        .filter((error) => error.row > 1)
        .map((error) => error.row));
    const hasGlobalError = errors.some((error) => error.row <= 1);
    const invalidRows = hasGlobalError ? rows.length : invalidRowNumbers.size;
    return {
        totalRows: rows.length,
        validRows: Math.max(0, rows.length - invalidRows),
        invalidRows,
        uniquePackageIds: unique(rows.flatMap((row) => row.packageIds)).length,
        uniqueCourseIds: unique(rows.flatMap((row) => row.courseIds)).length,
        uniqueLessonIds: unique(rows.flatMap((row) => row.lessonIds)).length,
        uniquePackageCoursePairs: pairCount,
        hmoRequests,
    };
};
const validateInternalLessonRows = async (rows, ignoredCalendarKeyByRow = new Map()) => {
    const errors = [];
    const codes = unique(rows.map((row) => row.calendar.code));
    const lessons = codes.length
        ? await prisma.$queryRaw(client_1.Prisma.sql `
      SELECT id, subject_code, learn_number, system_type
      FROM lessons
      WHERE status <> 0
        AND subject_code IN (${client_1.Prisma.join(codes)})
    `)
        : [];
    const programCodes = new Set(lessons.map((lesson) => lesson.subject_code));
    const lessonByIdentity = new Map(lessons.map((lesson) => [
        `${lesson.subject_code}::${lesson.learn_number}`,
        lesson,
    ]));
    // Tạm thời import lịch giữ nguyên teacher từ file/Sheet và không đối chiếu
    // teacher_profiles. Bật lại bước resolve tại đây khi nghiệp vụ giáo viên ổn định.
    codes.forEach((code) => {
        if (programCodes.has(code))
            return;
        const row = rows.find((item) => item.calendar.code === code);
        addError(errors, {
            row: row.row, field: 'code', errorCode: 'INVALID_ROW',
            message: `Chương trình ${code} chưa tồn tại. Vui lòng thêm chương trình trước khi import lịch.`,
        });
    });
    const firstRowsBySchedule = new Map();
    rows.forEach((row) => {
        row.calendar.skip_teacher_profile_validation = true;
        const lesson = lessonByIdentity.get(`${row.calendar.code}::${row.calendar.learn_number}`);
        if (programCodes.has(row.calendar.code) && !lesson) {
            addError(errors, {
                row: row.row, field: 'learn_number', errorCode: 'LESSON_NOT_FOUND',
                message: `Chương trình ${row.calendar.code} chưa có Bài ${row.calendar.learn_number}`,
            });
        }
        else if (lesson) {
            row.calendar.session_id = lesson.id;
            if (lesson.system_type !== row.calendar.system_type) {
                addError(errors, {
                    row: row.row, field: 'system_type', errorCode: 'INVALID_ROW',
                    message: `system_type không khớp với chương trình ${row.calendar.code} (${lesson.system_type})`,
                });
            }
        }
        const scheduleKey = [row.calendar.code, row.calendar.learn_number,
            new Date(row.calendar.start_time).getTime(), new Date(row.calendar.end_time).getTime()].join('::');
        const firstRow = firstRowsBySchedule.get(scheduleKey);
        if (firstRow !== undefined) {
            addError(errors, {
                row: row.row, field: 'calendar', errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
                duplicateWithRow: firstRow, message: `Lịch bị trùng với dòng ${firstRow}`,
            });
        }
        else
            firstRowsBySchedule.set(scheduleKey, row.row);
    });
    if (!errors.length) {
        const minStart = new Date(Math.min(...rows.map((row) => new Date(row.calendar.start_time).getTime())));
        const maxEnd = new Date(Math.max(...rows.map((row) => new Date(row.calendar.end_time).getTime())));
        const existing = await prisma.calendar.findMany({
            where: { code: { in: codes }, start_time: { lte: maxEnd }, end_time: { gte: minStart } },
            select: { id: true, key: true, code: true, learn_number: true, start_time: true, end_time: true },
        });
        const existingKeys = new Map();
        existing.forEach((item) => {
            const identity = [item.code, item.learn_number,
                item.start_time.getTime(), item.end_time.getTime()].join('::');
            const keys = existingKeys.get(identity) ?? new Set();
            keys.add(item.key || `calendar-id:${item.id}`);
            existingKeys.set(identity, keys);
        });
        rows.forEach((row) => {
            const key = [row.calendar.code, row.calendar.learn_number,
                new Date(row.calendar.start_time).getTime(), new Date(row.calendar.end_time).getTime()].join('::');
            const ignoredKey = ignoredCalendarKeyByRow.get(row.row);
            const conflictingKeys = existingKeys.get(key);
            if (conflictingKeys && (conflictingKeys.size > (ignoredKey && conflictingKeys.has(ignoredKey) ? 1 : 0)))
                addError(errors, {
                    row: row.row, field: 'calendar', errorCode: 'DUPLICATE_SCHEDULE_IN_DATABASE',
                    message: `Lịch Bài ${row.calendar.learn_number} của ${row.calendar.code} đã tồn tại`,
                });
        });
    }
    return errors;
};
const resolveMissingPackages = async (rows) => {
    const errors = [];
    const courseIds = unique(rows
        .filter((row) => row.packageIds.length === 0)
        .flatMap((row) => row.courseIds));
    const packagesByCourse = new Map();
    await Promise.all(courseIds.map(async (courseId) => {
        try {
            const mappings = await (0, package_course_sheet_service_1.resolvePackagesByCourseId)(courseId);
            packagesByCourse.set(courseId, unique(mappings.map((mapping) => mapping.package_id)));
        }
        catch {
            packagesByCourse.set(courseId, []);
        }
    }));
    const resolvedRows = rows.map((row) => {
        if (row.packageIds.length)
            return row;
        const packageCoursePairs = row.courseIds.flatMap((courseId) => ((packagesByCourse.get(courseId) ?? []).map((packageId) => ({
            packageId,
            courseId,
        }))));
        const packageIds = unique(packageCoursePairs.map((pair) => pair.packageId));
        if (!packageIds.length) {
            addError(errors, {
                row: row.row,
                field: 'ID package',
                errorCode: 'PACKAGE_NOT_FOUND',
                message: 'Không xác định được Package ID từ các Course ID trong dòng',
            });
        }
        return { ...row, packageIds, packageCoursePairs };
    });
    return { rows: resolvedRows, errors };
};
const buildUniquePackageCoursePairs = (rows) => {
    const pairs = new Map();
    rows.forEach((row) => {
        getRowPackageCoursePairs(row).forEach(({ packageId, courseId }) => {
            pairs.set(pairKey(packageId, courseId), { packageId, courseId });
        });
    });
    return Array.from(pairs.values());
};
exports.buildUniquePackageCoursePairs = buildUniquePackageCoursePairs;
const validateCalendarImportOutlines = (rows, requestedPairs, outlineResults) => {
    const errors = [];
    const requestedKeys = new Set(requestedPairs.map((pair) => pairKey(pair.packageId, pair.courseId)));
    const resultByPair = new Map();
    outlineResults.forEach((result) => {
        const key = pairKey(result.packageId, result.courseId);
        if (requestedKeys.has(key))
            resultByPair.set(key, result);
    });
    const missingPairs = requestedPairs.filter((pair) => !resultByPair.has(pairKey(pair.packageId, pair.courseId)));
    missingPairs.forEach((pair) => {
        rows
            .filter((row) => getRowPackageCoursePairs(row).some((rowPair) => (rowPair.packageId === pair.packageId
            && rowPair.courseId === pair.courseId)))
            .forEach((row) => addError(errors, {
            row: row.row,
            field: 'HMO',
            errorCode: 'HMO_INVALID_RESPONSE',
            packageId: pair.packageId,
            courseId: pair.courseId,
            message: `HMO không trả kết quả cho Package ${pair.packageId} / Course ${pair.courseId}`,
        }));
    });
    const allHmoLessonIds = new Set(outlineResults.flatMap((result) => result.lessons.map((lesson) => lesson.lessonId)));
    const resolvedRows = [];
    rows.forEach((row) => {
        const rowResults = getRowPackageCoursePairs(row)
            .map(({ packageId, courseId }) => (resultByPair.get(pairKey(packageId, courseId))))
            .filter((result) => Boolean(result));
        const validResults = rowResults.filter((result) => result.exists);
        row.packageIds.forEach((packageId) => {
            if (!validResults.some((result) => result.packageId === packageId)) {
                addError(errors, {
                    row: row.row,
                    field: 'ID package',
                    errorCode: 'PACKAGE_NOT_FOUND',
                    packageId,
                    message: `Package ID ${packageId} không tồn tại trên HMO`,
                });
            }
        });
        row.courseIds.forEach((courseId) => {
            if (!validResults.some((result) => result.courseId === courseId)) {
                addError(errors, {
                    row: row.row,
                    field: 'ID course',
                    errorCode: 'COURSE_NOT_FOUND',
                    courseId,
                    message: `Course ID ${courseId} không tồn tại trên HMO`,
                });
            }
        });
        const mappings = [];
        row.lessonIds.forEach((lessonId) => {
            const matchedResults = validResults.filter((result) => result.lessons.some((lesson) => lesson.lessonId === lessonId));
            if (!matchedResults.length) {
                const belongsToAnotherContext = allHmoLessonIds.has(lessonId);
                addError(errors, {
                    row: row.row,
                    field: 'ID Bài giảng',
                    errorCode: belongsToAnotherContext
                        ? 'LESSON_NOT_IN_PACKAGE_COURSE'
                        : 'LESSON_NOT_FOUND',
                    lessonId,
                    message: belongsToAnotherContext
                        ? `Lesson ${lessonId} không thuộc Package/Course trong dòng`
                        : `Lesson ID ${lessonId} không tồn tại trên HMO`,
                });
                return;
            }
            matchedResults.forEach((result) => {
                mappings.push({
                    package_id: result.packageId,
                    course_id: result.courseId,
                    lesson_id: lessonId,
                });
            });
        });
        resolvedRows.push({
            ...row,
            mappings: Array.from(new Map(mappings.map((mapping) => [
                `${mapping.package_id}::${mapping.course_id}::${mapping.lesson_id}`,
                mapping,
            ])).values()),
        });
    });
    const firstRowsBySchedule = new Map();
    resolvedRows.forEach((row) => {
        row.mappings.forEach((mapping) => {
            const key = mappingScheduleKey(mapping, row);
            const firstRow = firstRowsBySchedule.get(key);
            if (firstRow !== undefined) {
                addError(errors, {
                    row: row.row,
                    field: 'calendar',
                    errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
                    duplicateWithRow: firstRow,
                    packageId: mapping.package_id,
                    courseId: mapping.course_id,
                    lessonId: mapping.lesson_id,
                    message: `Dòng ${row.row} bị trùng lịch với dòng ${firstRow}`,
                });
            }
            else {
                firstRowsBySchedule.set(key, row.row);
            }
        });
    });
    return { resolvedRows, errors };
};
exports.validateCalendarImportOutlines = validateCalendarImportOutlines;
const validateDatabaseDuplicates = async (rows) => {
    const errors = [];
    if (!rows.length)
        return errors;
    const startTimes = rows.map((row) => new Date(row.calendar.start_time));
    const endTimes = rows.map((row) => new Date(row.calendar.end_time));
    const minStart = new Date(Math.min(...startTimes.map((date) => date.getTime())));
    const maxStart = new Date(Math.max(...startTimes.map((date) => date.getTime())));
    const minEnd = new Date(Math.min(...endTimes.map((date) => date.getTime())));
    const maxEnd = new Date(Math.max(...endTimes.map((date) => date.getTime())));
    const identities = unique(rows.flatMap((row) => row.mappings.map((mapping) => `${mapping.package_id}::${mapping.course_id}::${mapping.lesson_id}`)));
    if (!identities.length)
        return errors;
    const conditions = identities.map((identity) => {
        const [packageId, courseId, lessonId] = identity.split('::');
        return client_1.Prisma.sql `(
      plm.package_id = ${packageId}
      AND plm.course_id = ${courseId}
      AND plm.lesson_id = ${lessonId}
    )`;
    });
    const existing = await prisma.$queryRaw(client_1.Prisma.sql `
    SELECT
      plm.package_id,
      plm.course_id,
      plm.lesson_id,
      c.start_time,
      c.end_time
    FROM package_lesson_mapping plm
    INNER JOIN calendar c ON c.\`key\` = plm.\`key\`
    WHERE c.start_time BETWEEN ${minStart} AND ${maxStart}
      AND c.end_time BETWEEN ${minEnd} AND ${maxEnd}
      AND (${client_1.Prisma.join(conditions, ' OR ')})
  `);
    const existingKeys = new Set(existing.map((item) => [
        item.package_id,
        item.course_id,
        item.lesson_id,
        item.start_time.getTime(),
        item.end_time.getTime(),
    ].join('::')));
    rows.forEach((row) => {
        row.mappings.forEach((mapping) => {
            if (!existingKeys.has(mappingScheduleKey(mapping, row)))
                return;
            addError(errors, {
                row: row.row,
                field: 'calendar',
                errorCode: 'DUPLICATE_SCHEDULE_IN_DATABASE',
                packageId: mapping.package_id,
                courseId: mapping.course_id,
                lessonId: mapping.lesson_id,
                message: `Lịch của Lesson ${mapping.lesson_id} đã tồn tại trong hệ thống`,
            });
        });
    });
    return errors;
};
const importCalendarFromSheet = async (inputRows, changeActor) => {
    const directRows = inputRows.filter((row) => row.sourceFormat === 'direct');
    if (directRows.length && directRows.length !== inputRows.length) {
        const errors = [{
                row: 1,
                field: 'file',
                errorCode: 'INVALID_ROW',
                message: 'Không thể trộn format lịch trực tiếp và format vận hành trong cùng một file',
            }];
        return {
            status: 'validation_error',
            summary: buildSummary(inputRows, errors, 0, 0),
            errors,
        };
    }
    if (directRows.length === inputRows.length) {
        const errors = await validateInternalLessonRows(inputRows);
        if (errors.length)
            return {
                status: 'validation_error',
                summary: buildSummary(inputRows, errors, 0, 0),
                errors,
            };
        const resolvedRows = inputRows.map((row) => ({ ...row, mappings: [] }));
        const created = await (0, livestream_service_1.createValidatedInternalCalendarImport)(resolvedRows, changeActor);
        return {
            status: 'success',
            summary: { ...buildSummary(inputRows, [], 0, 0), successRows: inputRows.length, failedRows: 0 },
            ...created,
        };
    }
    const packageResolution = await resolveMissingPackages(inputRows);
    const rows = packageResolution.rows;
    const pairs = (0, exports.buildUniquePackageCoursePairs)(rows);
    let errors = [...packageResolution.errors];
    if (errors.length) {
        return {
            status: 'validation_error',
            summary: buildSummary(rows, errors, pairs.length, 0),
            errors,
        };
    }
    let outlineResults;
    console.log("Fetching HMO course outlines for pairs:", pairs);
    try {
        outlineResults = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)(pairs);
        console.log("Fetched HMO course outlines:", outlineResults);
    }
    catch (error) {
        const hmoError = error instanceof hocmai_course_outline_service_1.HmoCourseOutlineError
            ? error
            : new hocmai_course_outline_service_1.HmoCourseOutlineError('HMO_BATCH_ERROR', error?.message || 'Không thể gọi HMO Course Outline API');
        errors = [{
                row: 1,
                field: 'HMO',
                errorCode: hmoError.errorCode,
                message: hmoError.message,
            }];
        return {
            status: 'validation_error',
            summary: buildSummary(rows, errors, pairs.length, pairs.length),
            errors,
        };
    }
    const validation = (0, exports.validateCalendarImportOutlines)(rows, pairs, outlineResults);
    errors.push(...validation.errors);
    if (!errors.length) {
        errors.push(...await validateDatabaseDuplicates(validation.resolvedRows));
    }
    if (errors.length) {
        return {
            status: 'validation_error',
            summary: buildSummary(rows, errors, pairs.length, pairs.length),
            errors,
        };
    }
    const created = await (0, livestream_service_1.createValidatedCalendarImport)(validation.resolvedRows, changeActor);
    return {
        status: 'success',
        summary: {
            ...buildSummary(rows, [], pairs.length, pairs.length),
            successRows: rows.length,
            failedRows: 0,
        },
        ...created,
    };
};
exports.importCalendarFromSheet = importCalendarFromSheet;
const updateCalendarsFromSheet = async (inputRows, changeActor) => {
    const errors = [];
    const directRows = inputRows.filter((row) => row.sourceFormat === 'direct');
    if (directRows.length !== inputRows.length) {
        errors.push({
            row: 1,
            field: 'file',
            errorCode: 'INVALID_ROW',
            message: 'Cập nhật lịch chỉ hỗ trợ file mẫu có code, start_time, end_time và key',
        });
    }
    const firstRowByKey = new Map();
    inputRows.forEach((row) => {
        const key = String(row.sourceKey || '').trim();
        if (!key) {
            addError(errors, {
                row: row.row,
                field: 'key',
                errorCode: 'INVALID_ROW',
                message: 'Cập nhật lịch bắt buộc phải có key',
            });
            return;
        }
        const firstRow = firstRowByKey.get(key);
        if (firstRow !== undefined) {
            addError(errors, {
                row: row.row,
                field: 'key',
                errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
                duplicateWithRow: firstRow,
                message: `Key ${key} bị lặp với dòng ${firstRow}`,
            });
        }
        else {
            firstRowByKey.set(key, row.row);
        }
    });
    const keys = Array.from(firstRowByKey.keys());
    const existing = keys.length ? await prisma.calendar.findMany({
        where: { key: { in: keys } },
    }) : [];
    const existingByKey = new Map(existing.filter((calendar) => calendar.key).map((calendar) => [calendar.key, calendar]));
    const ignoredCalendarKeyByRow = new Map();
    inputRows.forEach((row) => {
        const key = String(row.sourceKey || '').trim();
        if (!key)
            return;
        const current = existingByKey.get(key);
        if (!current) {
            addError(errors, {
                row: row.row,
                field: 'key',
                errorCode: 'INVALID_ROW',
                message: `Không tìm thấy lịch có key ${key}`,
            });
            return;
        }
        ignoredCalendarKeyByRow.set(row.row, key);
        if (current.code !== row.calendar.code) {
            addError(errors, {
                row: row.row,
                field: 'code',
                errorCode: 'INVALID_ROW',
                message: `Không được đổi code của lịch ${key} (${current.code})`,
            });
        }
        if (Number(current.learn_number) !== row.calendar.learn_number) {
            addError(errors, {
                row: row.row,
                field: 'learn_number',
                errorCode: 'INVALID_ROW',
                message: `Không được đổi learn_number của lịch ${key} (Bài ${current.learn_number})`,
            });
        }
        if (String(current.system_type || 'topclass') !== row.calendar.system_type) {
            addError(errors, {
                row: row.row,
                field: 'system_type',
                errorCode: 'INVALID_ROW',
                message: `Không được đổi system_type của lịch ${key}`,
            });
        }
        if (row.calendar.lesson_count !== undefined
            && Number(current.lesson_count) !== row.calendar.lesson_count) {
            addError(errors, {
                row: row.row,
                field: 'lesson_count',
                errorCode: 'INVALID_ROW',
                message: `Không được đổi lesson_count của lịch ${key}`,
            });
        }
    });
    if (!errors.length) {
        errors.push(...await validateInternalLessonRows(inputRows, ignoredCalendarKeyByRow));
    }
    if (errors.length)
        return {
            status: 'validation_error',
            summary: buildSummary(inputRows, errors, 0, 0),
            errors,
        };
    const normalizedJson = (value) => {
        const text = String(value ?? '').trim();
        if (!text)
            return '';
        try {
            return JSON.stringify(JSON.parse(text));
        }
        catch {
            return text;
        }
    };
    const normalizedText = (value) => String(value ?? '').trim();
    const changedRows = inputRows.filter((row) => {
        const current = existingByKey.get(row.sourceKey);
        return String(current.session_id ?? '') !== String(row.calendar.session_id ?? '')
            || normalizedText(current.subject) !== normalizedText(row.calendar.subject)
            || current.start_time.getTime() !== new Date(row.calendar.start_time).getTime()
            || current.end_time.getTime() !== new Date(row.calendar.end_time).getTime()
            || normalizedText(current.teacher) !== normalizedText(row.calendar.teacher)
            || normalizedText(current.lesson_name) !== normalizedText(row.calendar.lesson_name)
            || normalizedJson(current.lesson_document) !== normalizedJson(row.calendar.lesson_document)
            || normalizedText(current.evg_banner) !== normalizedText(row.calendar.evg_banner)
            || normalizedText(current.evg_stream) !== normalizedText(row.calendar.evg_stream);
    });
    const now = new Date();
    changedRows.forEach((row) => {
        const current = existingByKey.get(row.sourceKey);
        if (Number(current.lesson_status) === 1 || current.start_time <= now) {
            addError(errors, {
                row: row.row,
                field: 'key',
                errorCode: 'INVALID_ROW',
                message: `Lịch ${row.sourceKey} đã diễn ra hoặc đã nghỉ, không thể cập nhật`,
            });
        }
    });
    if (errors.length)
        return {
            status: 'validation_error',
            summary: buildSummary(inputRows, errors, 0, 0),
            errors,
        };
    const preparedUpdates = changedRows.map((row) => {
        const current = existingByKey.get(row.sourceKey);
        return {
            key: row.sourceKey,
            current,
            data: {
                session_id: row.calendar.session_id ?? null,
                subject: row.calendar.subject ?? null,
                start_time: new Date(row.calendar.start_time),
                end_time: new Date(row.calendar.end_time),
                teacher: row.calendar.teacher ?? null,
                lesson_name: row.calendar.lesson_name ?? null,
                lesson_document: row.calendar.lesson_document ?? null,
                evg_banner: row.calendar.evg_banner ?? null,
                evg_stream: row.calendar.evg_stream ?? null,
            },
        };
    });
    if (preparedUpdates.length) {
        const fields = [
            'session_id', 'subject', 'start_time', 'end_time', 'teacher',
            'lesson_name', 'lesson_document', 'evg_banner', 'evg_stream',
        ];
        await prisma.$transaction(async (tx) => {
            const assignments = fields.map((field) => (`\`${field}\` = CASE \`key\` ${preparedUpdates
                .map(() => 'WHEN ? THEN ?')
                .join(' ')} ELSE \`${field}\` END`)).join(', ');
            const caseValues = fields.flatMap((field) => preparedUpdates.flatMap((update) => [
                update.key,
                update.data[field],
            ]));
            const keyPlaceholders = preparedUpdates.map(() => '?').join(', ');
            await tx.$executeRawUnsafe(`UPDATE calendar
         SET ${assignments}, updated_at = CURRENT_TIMESTAMP
         WHERE \`key\` IN (${keyPlaceholders})`, ...caseValues, ...preparedUpdates.map((update) => update.key));
            const updatedCalendars = await tx.calendar.findMany({
                where: { key: { in: preparedUpdates.map((update) => update.key) } },
            });
            const updatedByKey = new Map(updatedCalendars
                .filter((calendar) => calendar.key)
                .map((calendar) => [calendar.key, calendar]));
            await (0, teams_notifications_1.enqueueManyCalendarTeamsNotifications)(tx, preparedUpdates.flatMap((update) => {
                const after = updatedByKey.get(update.key);
                return after ? [{
                        eventType: 'updated',
                        before: update.current,
                        after,
                        actor: changeActor,
                    }] : [];
            }));
        }, {
            isolationLevel: client_1.Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 10_000,
            timeout: 30_000,
        });
    }
    return {
        status: 'success',
        count: changedRows.length,
        unchangedRows: inputRows.length - changedRows.length,
        summary: {
            ...buildSummary(inputRows, [], 0, 0),
            successRows: changedRows.length,
            failedRows: 0,
            unchangedRows: inputRows.length - changedRows.length,
        },
    };
};
exports.updateCalendarsFromSheet = updateCalendarsFromSheet;
