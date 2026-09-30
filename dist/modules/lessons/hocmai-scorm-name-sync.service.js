"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHocmaiScormNameSyncJob = exports.startHocmaiScormNameSync = exports.resolveManualHocmaiScormLesson = exports.resolveManualHocmaiScormLessons = exports.previewHocmaiScormNameSync = exports.buildScheduleOccurrenceMap = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const hocmai_course_outline_service_1 = require("../../integrations/hocmai-course-outline.service");
const logger_1 = require("../../utils/logger");
const hmo_lesson_sync_service_1 = require("../hmo-lesson-sync/hmo-lesson-sync.service");
const clean = (value) => String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
const canonicalTeacher = (value) => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/^\s*(?:co|thay)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const teacherMatchQuality = (leftValue, rightValue) => {
    const left = canonicalTeacher(leftValue);
    const right = canonicalTeacher(rightValue);
    if (!left || !right)
        return -1;
    if (left === right)
        return 2;
    return left.split(" ").at(-1) === right || right.split(" ").at(-1) === left
        ? 1
        : -1;
};
const pairKey = (packageId, courseId) => `${String(packageId)}::${String(courseId)}`;
const stripOperationalPrefix = (value) => value.replace(/^\s*\[\s*(?:HỌC BÙ|HOC BU)\s*\]\s*[-–—:]*\s*/iu, "");
const outlineParts = (value) => {
    const raw = stripOperationalPrefix(clean(value));
    const suffix = /(?:_|-\s*)\s*(Cô|Thầy)\s+(.+?)\s*$/iu.exec(raw);
    return {
        title: (0, hmo_lesson_sync_service_1.normalizeTitle)(suffix?.index === undefined ? raw : raw.slice(0, suffix.index)),
        teacher: suffix?.[2] ? canonicalTeacher(suffix[2]) : "",
        honorific: suffix?.[1] || "",
    };
};
const titleScore = (leftValue, rightValue) => {
    const left = (0, hmo_lesson_sync_service_1.normalizeTitle)(leftValue);
    const right = (0, hmo_lesson_sync_service_1.normalizeTitle)(rightValue);
    return (0, hmo_lesson_sync_service_1.compatibleParts)(left, right) ? (0, hmo_lesson_sync_service_1.titleSimilarity)(left, right) : 0;
};
const displayTeacher = (row) => clean(row.teacher_name || row.teacher);
const scheduleOccurrence = (row) => {
    if (row.lesson_count !== null && row.lesson_count !== undefined) {
        const count = Number(row.lesson_count);
        if (Number.isInteger(count) && count >= 0)
            return count + 1;
    }
    const match = /^\s*\[\s*Lịch\s*(\d+)\s*\]/iu.exec(clean(row.calendar_lesson_name));
    const occurrence = Number(match?.[1] || 1);
    return Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
};
const scheduleGroupKey = (row) => `${String(row.lesson_id)}::${canonicalTeacher(displayTeacher(row))}`;
const buildScheduleOccurrenceMap = (rows) => {
    const calendarsByGroup = new Map();
    rows.forEach((row) => {
        const groupKey = scheduleGroupKey(row);
        const calendarId = String(row.calendar_id);
        const calendars = calendarsByGroup.get(groupKey) || new Map();
        if (!calendars.has(calendarId)) {
            calendars.set(calendarId, { calendarId, startTime: row.start_time });
            calendarsByGroup.set(groupKey, calendars);
        }
    });
    const result = new Map();
    calendarsByGroup.forEach((calendars) => {
        Array.from(calendars.values())
            .sort((left, right) => {
            const timeDiff = new Date(left.startTime).getTime()
                - new Date(right.startTime).getTime();
            return timeDiff || left.calendarId.localeCompare(right.calendarId, "vi", { numeric: true });
        })
            .forEach((calendar, index) => result.set(calendar.calendarId, index + 1));
    });
    return result;
};
exports.buildScheduleOccurrenceMap = buildScheduleOccurrenceMap;
const scormBaseName = (value) => clean(value).replace(/\.+$/, "").trim();
const numericId = (value, label) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        throw new Error(`${label} không hợp lệ: ${value}`);
    return parsed;
};
const getProgramSchedules = async (programCode) => prisma_1.default.$queryRaw `
  SELECT c.id AS calendar_id, l.id AS lesson_id, l.learn_number,
    l.lesson_name AS source_lesson_name,
    c.lesson_name AS calendar_lesson_name, c.lesson_count,
    c.start_time, c.teacher,
    tp.display_name AS teacher_name, lcm.package_id, lcm.course_id
  FROM calendar c
  INNER JOIN lessons l ON l.id = c.session_id AND l.status <> 0
  LEFT JOIN teacher_profiles tp ON tp.username = c.teacher
  LEFT JOIN lesson_course_mapping lcm ON lcm.lesson_id = l.id
  WHERE l.subject_code = ${programCode}
    AND COALESCE(c.lesson_status, 0) <> 1
  ORDER BY l.learn_number, c.start_time, c.id, lcm.package_id, lcm.course_id
`;
const scheduleMonthYear = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime()))
        return undefined;
    // MySQL DATETIME được driver trả thành Date với chính các thành phần giờ lưu
    // trong UTC; dùng UTC để không làm lệch tháng ở ranh giới ngày/tháng.
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
};
const sectionMonthYear = (value) => {
    const normalized = clean(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const match = /(?:^|\b)thang\s*(\d{1,2})(?:\s*[\/-]\s*(\d{4}))?/.exec(normalized);
    if (!match)
        return undefined;
    const month = Number(match[1]);
    const year = match[2] ? Number(match[2]) : undefined;
    return month >= 1 && month <= 12 ? { month, year } : undefined;
};
const sessionMatchQuality = (row, candidate) => {
    const schedule = scheduleMonthYear(row.start_time);
    const section = sectionMonthYear(candidate.sectionName);
    if (!schedule || !section)
        return 0;
    if (schedule.month !== section.month)
        return -1;
    if (section.year && section.year !== schedule.year)
        return -1;
    return section.year === schedule.year ? 2 : 1;
};
const groupCandidateSessions = (candidates) => {
    const groups = new Map();
    candidates.forEach((candidate) => {
        const key = candidate.sectionId ||
            `index:${candidate.sectionIndex ?? "unknown"}:${candidate.sectionName || ""}`;
        const group = groups.get(key) || {
            key,
            name: clean(candidate.sectionName) || "Không rõ session",
            lessons: [],
        };
        group.lessons.push({
            lessonId: candidate.lessonId,
            name: clean(candidate.name) || `Lesson ${candidate.lessonId}`,
            lessonIndex: candidate.lessonIndex,
        });
        groups.set(key, group);
    });
    return Array.from(groups.values())
        .map((group) => ({
        ...group,
        lessons: group.lessons.sort((left, right) => (left.lessonIndex ?? Number.MAX_SAFE_INTEGER)
            - (right.lessonIndex ?? Number.MAX_SAFE_INTEGER)
            || left.lessonId.localeCompare(right.lessonId, "vi", { numeric: true })),
    }))
        .sort((left, right) => left.name.localeCompare(right.name, "vi", { numeric: true }));
};
const resolveOutlineLesson = (row, candidates, multipleTeachers) => {
    const localTitle = (0, hmo_lesson_sync_service_1.normalizeTitle)(row.source_lesson_name);
    let evaluated = candidates
        .map((candidate) => {
        const candidateParts = outlineParts(candidate.name);
        return {
            candidate,
            title: candidateParts.title,
            score: titleScore(row.source_lesson_name, candidateParts.title),
            teacherQuality: multipleTeachers
                ? teacherMatchQuality(displayTeacher(row), candidateParts.teacher)
                : 0,
            sessionQuality: sessionMatchQuality(row, candidate),
        };
    })
        .filter((item) => item.score >= 0.92 && item.teacherQuality >= 0);
    if (!evaluated.length)
        return { candidates: [], sessionCertain: false };
    // Chỉ tự động chọn khi section có đủ Tháng M/YYYY và khớp chính xác
    // với lịch. Section thiếu năm/tên không chuẩn phải được người dùng xác nhận.
    const exactSessionMatches = evaluated.filter((item) => item.sessionQuality === 2);
    const sessionCertain = exactSessionMatches.length > 0;
    if (sessionCertain)
        evaluated = exactSessionMatches;
    if (multipleTeachers) {
        const bestTeacherQuality = Math.max(...evaluated.map((item) => item.teacherQuality));
        evaluated = evaluated.filter((item) => item.teacherQuality === bestTeacherQuality);
    }
    const exactTitleMatches = evaluated.filter((item) => item.title === localTitle);
    if (exactTitleMatches.length)
        evaluated = exactTitleMatches;
    if (!sessionCertain) {
        return {
            candidates: evaluated.map((item) => item.candidate),
            sessionCertain: false,
        };
    }
    if (evaluated.length <= 1) {
        return {
            candidates: evaluated.map((item) => item.candidate),
            sessionCertain: true,
        };
    }
    evaluated.sort((left, right) => right.score - left.score ||
        left.candidate.lessonId.localeCompare(right.candidate.lessonId, "vi", {
            numeric: true,
        }));
    if (evaluated[0].score - evaluated[1].score >= 0.02) {
        return { candidates: [evaluated[0].candidate], sessionCertain: true };
    }
    return {
        candidates: evaluated.map((item) => item.candidate),
        sessionCertain: true,
    };
};
const previewHocmaiScormNameSync = async (programCodeInput) => {
    const programCode = clean(programCodeInput);
    if (!programCode)
        throw new Error("Vui lòng chọn Chương trình");
    const schedules = await getProgramSchedules(programCode);
    if (!schedules.length)
        throw new Error(`Chương trình ${programCode} chưa có lịch học để đối chiếu`);
    const teacherKeys = new Set(schedules
        .map((row) => canonicalTeacher(displayTeacher(row)))
        .filter(Boolean));
    const multipleTeachers = teacherKeys.size > 1;
    const pairMap = new Map();
    schedules.forEach((row) => {
        if (!row.package_id || !row.course_id)
            return;
        const pair = {
            packageId: String(row.package_id),
            courseId: String(row.course_id),
        };
        pairMap.set(pairKey(pair.packageId, pair.courseId), pair);
    });
    const outlineByPair = new Map();
    const outlineErrors = new Map();
    await Promise.all(Array.from(pairMap.values()).map(async (pair) => {
        try {
            const [outline] = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)([pair]);
            if (!outline?.exists)
                outlineErrors.set(pairKey(pair.packageId, pair.courseId), "HOCMAI không tìm thấy Course/Package");
            else
                outlineByPair.set(pairKey(pair.packageId, pair.courseId), {
                    lessons: outline.lessons,
                });
        }
        catch (error) {
            outlineErrors.set(pairKey(pair.packageId, pair.courseId), clean(error?.message || error));
        }
    }));
    const rows = [];
    const targetRowIndexes = new Map();
    const occurrenceByCalendar = (0, exports.buildScheduleOccurrenceMap)(schedules);
    const seenSchedulePairs = new Set();
    for (const schedule of schedules) {
        const schedulePairKey = `${String(schedule.calendar_id)}::${schedule.package_id || ""}::${schedule.course_id || ""}`;
        if (seenSchedulePairs.has(schedulePairKey))
            continue;
        seenSchedulePairs.add(schedulePairKey);
        const base = {
            key: schedulePairKey,
            learnNumber: Number(schedule.learn_number),
            lessonName: clean(schedule.source_lesson_name),
            teacherName: displayTeacher(schedule),
            scheduleTime: new Date(schedule.start_time).toISOString(),
            occurrence: occurrenceByCalendar.get(String(schedule.calendar_id))
                || scheduleOccurrence(schedule),
            packageId: schedule.package_id ? String(schedule.package_id) : undefined,
            courseId: schedule.course_id ? String(schedule.course_id) : undefined,
        };
        if (!base.packageId || !base.courseId) {
            rows.push({
                ...base,
                status: "skipped",
                reason: "Bài học chưa được gắn Package/Course",
            });
            continue;
        }
        const pair = pairKey(base.packageId, base.courseId);
        if (outlineErrors.has(pair)) {
            rows.push({
                ...base,
                status: "skipped",
                reason: outlineErrors.get(pair),
            });
            continue;
        }
        const outline = outlineByPair.get(pair);
        const resolution = resolveOutlineLesson(schedule, outline?.lessons || [], multipleTeachers);
        const candidates = resolution.candidates;
        if (candidates.length !== 1 || !resolution.sessionCertain) {
            rows.push({
                ...base,
                status: "skipped",
                reason: candidates.length
                    ? resolution.sessionCertain
                        ? "Có nhiều Lesson HOCMAI cùng khớp; vui lòng chọn session và Lesson"
                        : "Session HOCMAI chưa có định dạng Tháng M/YYYY khớp lịch; vui lòng chọn session và Lesson"
                    : "Không tìm thấy Lesson HOCMAI khớp tên bài và giáo viên",
                candidateSessions: candidates.length
                    ? groupCandidateSessions(candidates)
                    : undefined,
            });
            continue;
        }
        const candidate = candidates[0];
        const teacher = displayTeacher(schedule);
        const candidateParts = outlineParts(candidate.name);
        const fullTeacherName = canonicalTeacher(teacher).split(" ").length >= 2 ? teacher : "";
        const expectedName = multipleTeachers && candidateParts.honorific && fullTeacherName
            ? `${scormBaseName(base.lessonName)}_${candidateParts.honorific} ${fullTeacherName}`
            : multipleTeachers
                ? ""
                : base.lessonName;
        if (!expectedName) {
            rows.push({
                ...base,
                hocmaiLessonId: candidate.lessonId,
                hocmaiSessionName: clean(candidate.sectionName) || undefined,
                currentName: clean(candidate.name),
                status: "skipped",
                reason: "Hồ sơ giáo viên thiếu chức danh Cô/Thầy hoặc họ tên đầy đủ",
            });
            continue;
        }
        const target = `${base.courseId}::${candidate.lessonId}`;
        const currentName = clean(candidate.name);
        const targetIndexes = targetRowIndexes.get(target) || [];
        targetIndexes.push(rows.length);
        targetRowIndexes.set(target, targetIndexes);
        rows.push({
            ...base,
            hocmaiLessonId: candidate.lessonId,
            hocmaiSessionName: clean(candidate.sectionName) || undefined,
            currentName,
            expectedName,
            status: currentName === expectedName ? "unchanged" : "update",
        });
    }
    targetRowIndexes.forEach((indexes) => {
        if (indexes.length <= 1)
            return;
        const expectedNames = new Set(indexes.map((index) => rows[index].expectedName).filter(Boolean));
        if (expectedNames.size > 1) {
            const reason = "Cùng một Lesson HOCMAI nhưng lịch cho ra hai tên đích khác nhau";
            indexes.forEach((index) => {
                rows[index] = { ...rows[index], status: "skipped", reason };
            });
            return;
        }
        indexes.forEach((index) => {
            rows[index] = { ...rows[index], sharedTarget: true };
        });
    });
    const warnings = rows
        .filter((row) => row.status === "skipped")
        .map((row) => `Bài ${row.learnNumber}: ${row.reason}`);
    return {
        programCode,
        teacherCount: teacherKeys.size,
        scheduleCount: new Set(schedules.map((row) => String(row.calendar_id)))
            .size,
        packageCourseCount: pairMap.size,
        updateCount: new Set(rows
            .filter((row) => row.status === "update" && row.courseId && row.hocmaiLessonId)
            .map((row) => `${row.courseId}::${row.hocmaiLessonId}`)).size,
        unchangedCount: rows.filter((row) => row.status === "unchanged").length,
        skippedCount: rows.filter((row) => row.status === "skipped").length,
        rows,
        warnings,
    };
};
exports.previewHocmaiScormNameSync = previewHocmaiScormNameSync;
const resolveManualHocmaiScormLessons = async (programCodeInput, selectionsInput) => {
    const programCode = clean(programCodeInput);
    if (!programCode || !Array.isArray(selectionsInput) || !selectionsInput.length)
        throw new Error("Chương trình hoặc danh sách Lesson cần kiểm tra không hợp lệ");
    if (selectionsInput.length > 200)
        throw new Error("Mỗi lượt chỉ hỗ trợ tối đa 200 Lesson");
    const selections = selectionsInput.map((selection) => ({
        rowKey: clean(selection?.rowKey),
        lessonId: clean(selection?.lessonId),
    }));
    if (selections.some((item) => !item.rowKey || !/^\d+$/.test(item.lessonId)))
        throw new Error("Dòng preview hoặc Lesson ID không hợp lệ");
    if (new Set(selections.map((item) => item.rowKey)).size !== selections.length)
        throw new Error("Danh sách duyệt có dòng preview bị trùng");
    const schedules = await getProgramSchedules(programCode);
    const scheduleByKey = new Map(schedules.map((row) => [
        `${String(row.calendar_id)}::${row.package_id || ""}::${row.course_id || ""}`,
        row,
    ]));
    const pairs = new Map();
    selections.forEach((selection) => {
        const schedule = scheduleByKey.get(selection.rowKey);
        if (!schedule?.package_id || !schedule?.course_id)
            throw new Error(`Không tìm thấy lịch hoặc Package/Course của dòng ${selection.rowKey}`);
        const pair = {
            packageId: String(schedule.package_id),
            courseId: String(schedule.course_id),
        };
        pairs.set(pairKey(pair.packageId, pair.courseId), pair);
    });
    const outlines = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)(Array.from(pairs.values()));
    const outlineByPair = new Map(outlines.map((outline) => [
        pairKey(outline.packageId, outline.courseId),
        outline,
    ]));
    const teachers = new Set(schedules
        .map((row) => canonicalTeacher(displayTeacher(row)))
        .filter(Boolean));
    return selections.map((selection) => {
        const schedule = scheduleByKey.get(selection.rowKey);
        const packageId = String(schedule.package_id);
        const courseId = String(schedule.course_id);
        const outline = outlineByPair.get(pairKey(packageId, courseId));
        const candidate = outline?.exists
            ? outline.lessons.find((lesson) => lesson.lessonId === selection.lessonId)
            : undefined;
        if (!candidate)
            throw new Error(`Lesson ID ${selection.lessonId} không thuộc Package ${packageId} / Course ${courseId}`);
        const candidateParts = outlineParts(candidate.name);
        const teacher = displayTeacher(schedule);
        const suggestedName = teachers.size > 1 && candidateParts.honorific && teacher
            ? `${scormBaseName(schedule.source_lesson_name)}_${candidateParts.honorific} ${teacher}`
            : scormBaseName(schedule.source_lesson_name);
        return {
            rowKey: selection.rowKey,
            lessonId: selection.lessonId,
            currentName: clean(candidate.name),
            suggestedName,
            sessionName: clean(candidate.sectionName) || undefined,
            packageId,
            courseId,
        };
    });
};
exports.resolveManualHocmaiScormLessons = resolveManualHocmaiScormLessons;
const resolveManualHocmaiScormLesson = async (programCodeInput, rowKeyInput, lessonIdInput) => {
    const [resolved] = await (0, exports.resolveManualHocmaiScormLessons)(programCodeInput, [{
            rowKey: rowKeyInput,
            lessonId: lessonIdInput,
        }]);
    return resolved;
};
exports.resolveManualHocmaiScormLesson = resolveManualHocmaiScormLesson;
const resolveManualOverrides = async (programCode, overrides) => {
    if (overrides.length > 200)
        throw new Error("Mỗi lượt chỉ hỗ trợ tối đa 200 Lesson nhập tay");
    const result = [];
    const targets = new Map();
    const resolvedItems = overrides.length
        ? await (0, exports.resolveManualHocmaiScormLessons)(programCode, overrides.map((override) => ({
            rowKey: override.rowKey,
            lessonId: override.lessonId,
        })))
        : [];
    for (let index = 0; index < overrides.length; index += 1) {
        const override = overrides[index];
        const resolved = resolvedItems[index];
        const expectedName = clean(override.expectedName);
        if (!expectedName || expectedName.length > 255)
            throw new Error(`Tên dự kiến của Lesson ${override.lessonId} phải từ 1 đến 255 ký tự`);
        const target = `${resolved.courseId}::${resolved.lessonId}`;
        const prior = targets.get(target);
        if (prior && prior !== expectedName)
            throw new Error(`Lesson ${resolved.lessonId} đang có hai tên dự kiến khác nhau`);
        targets.set(target, expectedName);
        result.push({
            course_id: numericId(resolved.courseId, "Course ID"),
            lesson_id: numericId(resolved.lessonId, "Lesson ID"),
            lesson_name: expectedName,
        });
    }
    return Array.from(new Map(result.map((item) => [`${item.course_id}::${item.lesson_id}`, item])).values());
};
const toPayload = (preview) => Array.from(new Map(preview.rows
    .filter((row) => row.status === "update" &&
    row.courseId &&
    row.hocmaiLessonId &&
    row.expectedName)
    .map((row) => [
    `${row.courseId}::${row.hocmaiLessonId}`,
    {
        course_id: numericId(row.courseId, "Course ID"),
        lesson_id: numericId(row.hocmaiLessonId, "Lesson ID"),
        lesson_name: row.expectedName,
    },
])).values());
const applyPreview = async (preview, manualPayload, onProgress) => {
    const payloadMap = new Map(toPayload(preview).map((item) => [
        `${item.course_id}::${item.lesson_id}`,
        item,
    ]));
    manualPayload.forEach((item) => payloadMap.set(`${item.course_id}::${item.lesson_id}`, item));
    const payload = Array.from(payloadMap.values());
    onProgress?.(0, payload.length);
    if (!payload.length)
        return { updated: 0, total: 0 };
    const token = clean(process.env.SYNC_SCORM_TOKEN);
    if (!token)
        throw new Error("Chưa cấu hình SYNC_SCORM_TOKEN");
    const batchSize = Math.min(500, Math.max(1, Number(process.env.SYNC_SCORM_BATCH_SIZE) || 500));
    let updated = 0;
    for (let index = 0; index < payload.length; index += batchSize) {
        const batch = payload.slice(index, index + batchSize);
        const response = await fetch("https://hocmai.vn/api/live-class/sync-scorm-name", {
            method: "POST",
            headers: {
                TOKEN: token,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify(batch),
            signal: AbortSignal.timeout(Number(process.env.SYNC_SCORM_TIMEOUT_MS) || 30_000),
        });
        if (!response.ok)
            throw new Error(`API cập nhật tên SCORM trả HTTP ${response.status}`);
        const text = await response.text();
        if (text.trim()) {
            try {
                JSON.parse(text);
            }
            catch {
                throw new Error("API cập nhật tên SCORM trả dữ liệu không hợp lệ");
            }
        }
        updated += batch.length;
        onProgress?.(updated, payload.length);
    }
    return { updated, total: payload.length };
};
const jobs = new Map();
const startHocmaiScormNameSync = (programCode, overrides = []) => {
    const id = crypto.randomUUID();
    const job = {
        id,
        status: "running",
        updated: 0,
        total: 0,
    };
    jobs.set(id, job);
    void Promise.all([
        (0, exports.previewHocmaiScormNameSync)(programCode),
        resolveManualOverrides(programCode, overrides),
    ])
        .then(([preview, manualPayload]) => applyPreview(preview, manualPayload, (updated, total) => {
        job.updated = updated;
        job.total = total;
    }))
        .then(() => {
        job.status = "completed";
        job.completedAt = Date.now();
    })
        .catch((error) => {
        logger_1.logger.error("[HOCMAI SCORM name sync]", error);
        job.status = "failed";
        job.error = clean(error?.message || error) || "Đồng bộ thất bại";
        job.completedAt = Date.now();
    });
    return job;
};
exports.startHocmaiScormNameSync = startHocmaiScormNameSync;
const getHocmaiScormNameSyncJob = (id) => {
    const job = jobs.get(id);
    if (!job)
        throw new Error("Không tìm thấy tiến trình đồng bộ HOCMAI");
    return job;
};
exports.getHocmaiScormNameSyncJob = getHocmaiScormNameSyncJob;
