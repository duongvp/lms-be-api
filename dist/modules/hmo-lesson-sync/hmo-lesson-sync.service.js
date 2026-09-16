"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHmoLessonSyncRunning = exports.startHmoLessonSync = exports.titleSimilarity = exports.compatibleParts = exports.calendarOccurrence = exports.normalizeTitle = exports.markInterruptedHmoLessonSyncRuns = void 0;
const prisma_1 = __importDefault(require("../../lib/prisma"));
const hocmai_course_outline_service_1 = require("../../integrations/hocmai-course-outline.service");
const logger_1 = require("../../utils/logger");
const hocmai_sync_queue_service_1 = require("../livestream/hocmai-sync-queue.service");
let runningPromise = null;
const HEARTBEAT_INTERVAL_MS = 15_000;
const INTERRUPTED_AFTER_MINUTES = 3;
const markInterruptedHmoLessonSyncRuns = async () => prisma_1.default.$executeRawUnsafe(`
  UPDATE hmo_lesson_sync_runs
  SET status='interrupted', active_key=NULL,
      last_error='Tiến trình backend bị ngắt hoặc mất kết nối. Có thể quét lại.',
      finished_at=NOW(3)
  WHERE active_key='global'
    AND status='running'
    AND COALESCE(heartbeat_at, started_at) < DATE_SUB(NOW(3), INTERVAL ${INTERRUPTED_AFTER_MINUTES} MINUTE)
`);
exports.markInterruptedHmoLessonSyncRuns = markInterruptedHmoLessonSyncRuns;
const canonical = (value) => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
const normalizeTitle = (value) => canonical(value)
    .replace(/^\s*\[\s*(?:lich\s*\d+|bo\s*tro)\s*\]\s*/, '')
    .replace(/^bai\s*\d+\s*[:.\-–—]*\s*/, '')
    .replace(/\bphan\s+(\d+)(?=$|[^a-z0-9])/g, 'p$1')
    .replace(/[^a-z0-9]+/g, ' ').trim();
exports.normalizeTitle = normalizeTitle;
const normalizeTeacher = (value) => canonical(value)
    .replace(/^\s*(?:co|thay)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const calendarOccurrence = (value, lessonCount) => {
    if (lessonCount !== undefined && lessonCount !== null && lessonCount !== '') {
        const count = Number(lessonCount);
        if (Number.isInteger(count) && count >= 0)
            return count + 1;
    }
    const match = /^\s*\[\s*Lịch\s*(\d+)\s*\]/iu.exec(String(value || ''));
    const occurrence = Number(match?.[1] || 1);
    return Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
};
exports.calendarOccurrence = calendarOccurrence;
const parseCandidate = (candidate) => {
    const raw = String(candidate.name || '').trim();
    const suffix = /_\s*(?:Cô|Thầy)\s+(.+?)\s*$/iu.exec(raw);
    return {
        ...candidate,
        title: (0, exports.normalizeTitle)(suffix?.index === undefined ? raw : raw.slice(0, suffix.index)),
        teacher: normalizeTeacher(suffix?.[1]),
    };
};
const teacherMatches = (actual, expected) => actual === expected
    || (!expected.includes(' ') && actual.split(' ').at(-1) === expected);
const teacherMatchQuality = (actual, expected) => {
    if (!expected)
        return 0;
    if (actual === expected)
        return 2;
    return teacherMatches(actual, expected) ? 1 : -1;
};
const partMarkers = (title) => Array.from(new Set(title.split(' ').filter((part) => /^p\d+$/.test(part)))).sort().join('|');
const compatibleParts = (left, right) => {
    const leftParts = partMarkers(left);
    const rightParts = partMarkers(right);
    return (!leftParts && !rightParts) || leftParts === rightParts;
};
exports.compatibleParts = compatibleParts;
const levenshtein = (left, right) => {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= right.length; j += 1)
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        previous = current;
    }
    return previous[right.length];
};
const titleSimilarity = (left, right) => {
    if (!left || !right)
        return 0;
    if (left === right)
        return 1;
    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    const shared = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
    const tokenScore = (2 * shared) / (leftTokens.size + rightTokens.size);
    return tokenScore * 0.6 + (1 - levenshtein(left, right) / Math.max(left.length, right.length)) * 0.4;
};
exports.titleSimilarity = titleSimilarity;
// Cùng quy tắc với màn cập nhật hàng loạt: phân ứng viên trên cả nhóm lịch;
// mỗi calendar nhận một Lesson ID riêng trong từng Course.
const matchCalendarsForCourse = (calendarRows, rawCandidates) => {
    const candidates = rawCandidates.map(parseCandidate);
    const evaluated = calendarRows.map((row, index) => {
        // Modal hàng loạt mặc định dùng tên chuẩn trong bảng lessons để match.
        // Tên calendar có thể chứa [Lịch n], [HỌC BÙ] hoặc hậu tố vận hành và chỉ
        // được dùng để suy ra occurrence.
        const title = (0, exports.normalizeTitle)(row.source_lesson_name);
        const teacher = normalizeTeacher(row.teacher_name || row.teacher);
        const allMatches = candidates.map((candidate) => {
            if (!(0, exports.compatibleParts)(title, candidate.title))
                return null;
            const matchQuality = teacherMatchQuality(teacher, candidate.teacher);
            if (matchQuality < 0)
                return null;
            const score = (0, exports.titleSimilarity)(title, candidate.title);
            if (score < 0.92)
                return null;
            return {
                candidate,
                score,
                exactTitle: title === candidate.title,
                teacherMatched: Boolean(candidate.teacher && teacherMatches(teacher, candidate.teacher)),
                teacherMatchQuality: matchQuality,
            };
        }).filter((item) => Boolean(item)).sort((left, right) => (right.teacherMatchQuality - left.teacherMatchQuality
            || Number(right.exactTitle) - Number(left.exactTitle)
            || right.score - left.score
            || left.candidate.lessonId.localeCompare(right.candidate.lessonId, 'vi', { numeric: true })));
        const bestTeacherQuality = allMatches[0]?.teacherMatchQuality;
        let matches = bestTeacherQuality === undefined
            ? allMatches
            : allMatches.filter((item) => item.teacherMatchQuality === bestTeacherQuality);
        if (matches[0] && !matches[0].exactTitle) {
            const competing = matches.find((item, matchIndex) => matchIndex > 0
                && item.teacherMatched === matches[0].teacherMatched
                && item.candidate.title !== matches[0].candidate.title);
            if (competing && matches[0].score - competing.score < 0.05) {
                return { row, index, teacher, matches: [], ambiguousCount: matches.length };
            }
        }
        if (matches[0]) {
            matches = matches.filter((item) => item.candidate.title === matches[0].candidate.title);
        }
        return { row, index, teacher, matches, ambiguousCount: 0 };
    });
    evaluated.sort((left, right) => (Number(Boolean(right.matches[0]?.teacherMatched)) - Number(Boolean(left.matches[0]?.teacherMatched))
        || left.matches.length - right.matches.length
        || new Date(left.row.start_time).getTime() - new Date(right.row.start_time).getTime()
        || left.index - right.index));
    const claimedLessonIds = new Set();
    const result = new Map();
    evaluated.forEach((item) => {
        if (!item.matches.length) {
            result.set(Number(item.row.calendar_id), {
                errorCode: item.ambiguousCount ? 'AMBIGUOUS' : 'NO_MATCH',
                candidateCount: item.ambiguousCount,
            });
            return;
        }
        const requestedIndex = (0, exports.calendarOccurrence)(item.row.lesson_name, item.row.lesson_count) - 1;
        const requested = requestedIndex > 0 ? item.matches[requestedIndex] : undefined;
        const selected = item.matches.length === 1
            ? item.matches[0]
            : requestedIndex > 0
                ? (requested && !claimedLessonIds.has(requested.candidate.lessonId) ? requested : undefined)
                : item.matches.find((match) => !claimedLessonIds.has(match.candidate.lessonId));
        if (!selected) {
            result.set(Number(item.row.calendar_id), { errorCode: 'NO_MATCH', candidateCount: item.matches.length });
            return;
        }
        claimedLessonIds.add(selected.candidate.lessonId);
        result.set(Number(item.row.calendar_id), { lessonId: selected.candidate.lessonId, candidateCount: item.matches.length });
    });
    return result;
};
const addIssue = async (runId, row, code, message, pair) => {
    await prisma_1.default.$executeRaw `
    INSERT INTO hmo_lesson_sync_issues
      (run_id, program_code, lesson_id, calendar_id, learn_number, lesson_name, teacher,
       course_id, package_id, error_code, message)
    VALUES (${runId}, ${row.subject_code}, ${row.lesson_id}, ${row.calendar_id},
      ${row.learn_number}, ${row.lesson_name}, ${row.teacher_name || row.teacher},
      ${pair?.courseId || null}, ${pair?.packageId || null}, ${code}, ${message})
  `;
};
const executeRun = async (runId) => {
    let heartbeatUpdating = false;
    const updateHeartbeat = async (currentProgram) => {
        if (heartbeatUpdating)
            return;
        heartbeatUpdating = true;
        try {
            if (currentProgram === undefined) {
                await prisma_1.default.$executeRaw `UPDATE hmo_lesson_sync_runs SET heartbeat_at=NOW(3) WHERE id=${runId} AND status='running'`;
            }
            else {
                await prisma_1.default.$executeRaw `UPDATE hmo_lesson_sync_runs SET heartbeat_at=NOW(3), current_program=${currentProgram} WHERE id=${runId} AND status='running'`;
            }
        }
        catch (error) {
            logger_1.logger.warn(`Không thể cập nhật heartbeat lượt đồng bộ HMO ${String(runId)}: ${String(error?.message || error)}`);
        }
        finally {
            heartbeatUpdating = false;
        }
    };
    await updateHeartbeat(null);
    const heartbeatTimer = setInterval(() => { void updateHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
    try {
        const rows = await prisma_1.default.$queryRaw `
      SELECT c.id AS calendar_id, c.key, c.code, c.code AS program_code, c.learn_number, c.lesson_count,
        c.teacher, tp.display_name AS teacher_name, l.id AS lesson_id,
        l.subject_code, l.lesson_name AS source_lesson_name,
        c.lesson_name, lcm.package_id, lcm.course_id,
        plm.lesson_id AS mapped_hmo_lesson_id,
        (c.start_time > NOW() AND COALESCE(c.lesson_status, 0) <> 1) AS is_target
      FROM calendar c
      INNER JOIN lessons l ON l.id = c.session_id AND l.status <> 0
      LEFT JOIN teacher_profiles tp ON tp.username = c.teacher
      LEFT JOIN lesson_course_mapping lcm ON lcm.lesson_id = l.id
      LEFT JOIN package_lesson_mapping plm
        ON plm.key = c.key
       AND plm.package_id = lcm.package_id
       AND plm.course_id = lcm.course_id
      WHERE COALESCE(c.lesson_status, 0) <> 1
      ORDER BY l.subject_code, l.learn_number, c.start_time, c.id
    `;
        const targetRows = rows.filter((row) => Boolean(Number(row.is_target)));
        const programs = Array.from(new Set(targetRows.map((row) => String(row.subject_code))));
        const lessons = Array.from(new Set(targetRows.map((row) => String(row.lesson_id))));
        await prisma_1.default.$executeRaw `UPDATE hmo_lesson_sync_runs SET programs_total=${programs.length}, lessons_total=${lessons.length} WHERE id=${runId}`;
        const pairs = Array.from(new Map(rows.filter((row) => row.package_id && row.course_id).map((row) => {
            const pair = { packageId: String(row.package_id), courseId: String(row.course_id) };
            return [`${pair.packageId}::${pair.courseId}`, pair];
        })).values());
        const outlines = [];
        const outlineErrors = new Map();
        let nextPairIndex = 0;
        const outlineWorker = async () => {
            while (nextPairIndex < pairs.length) {
                const pair = pairs[nextPairIndex++];
                try {
                    const [outline] = await (0, hocmai_course_outline_service_1.fetchHocmaiCourseOutlines)([pair]);
                    if (outline)
                        outlines.push(outline);
                }
                catch (error) {
                    outlineErrors.set(`${pair.packageId}::${pair.courseId}`, String(error?.message || error));
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, pairs.length) }, () => outlineWorker()));
        const outlineByPair = new Map(outlines.map((outline) => [`${outline.packageId}::${outline.courseId}`, outline]));
        let programsProcessed = 0;
        let programsFailed = 0;
        let lessonsSynced = 0;
        let lessonsFailed = 0;
        let calendarsSynced = 0;
        for (const program of programs) {
            await updateHeartbeat(program);
            const programRows = rows.filter((row) => String(row.subject_code) === program);
            const calendarGroups = new Map();
            programRows.forEach((row) => calendarGroups.set(Number(row.calendar_id), [...(calendarGroups.get(Number(row.calendar_id)) || []), row]));
            const courseMatches = new Map();
            const programPairs = Array.from(new Map(programRows.filter((row) => row.package_id && row.course_id).map((row) => {
                const pair = { packageId: String(row.package_id), courseId: String(row.course_id) };
                return [`${pair.packageId}::${pair.courseId}`, pair];
            })).entries());
            programPairs.forEach(([pairKey, pair]) => {
                const outline = outlineByPair.get(pairKey);
                if (!outline?.exists || !outline.lessons.length)
                    return;
                const matchingCalendars = Array.from(calendarGroups.values())
                    .filter((group) => group.some((item) => String(item.package_id) === pair.packageId && String(item.course_id) === pair.courseId))
                    .map((group) => group[0]);
                // Giống modal hàng loạt: reset phép phân bổ Lesson ID cho từng bài nội
                // bộ (session_id), không claim ID xuyên qua các bài trùng tên khác nhau.
                const calendarsByLesson = new Map();
                matchingCalendars.forEach((calendar) => {
                    const lessonId = String(calendar.lesson_id);
                    calendarsByLesson.set(lessonId, [...(calendarsByLesson.get(lessonId) || []), calendar]);
                });
                calendarsByLesson.forEach((lessonCalendars) => {
                    matchCalendarsForCourse(lessonCalendars, outline.lessons).forEach((match, calendarId) => {
                        courseMatches.set(`${calendarId}::${pairKey}`, match);
                    });
                });
            });
            let programHasError = false;
            const failedLessonIds = new Set();
            const syncedLessonIds = new Set();
            for (const calendarRows of calendarGroups.values()) {
                const row = calendarRows[0];
                if (!Boolean(Number(row.is_target)))
                    continue;
                const configuredPairs = calendarRows.filter((item) => item.package_id && item.course_id)
                    .map((item) => ({ packageId: String(item.package_id), courseId: String(item.course_id) }));
                if (!configuredPairs.length) {
                    await addIssue(runId, row, 'MISSING_COURSE_MAPPING', 'Bài chưa có Course ID hoặc Package ID.');
                    programHasError = true;
                    failedLessonIds.add(String(row.lesson_id));
                    continue;
                }
                const nextMappings = [];
                let failure = false;
                for (const pair of configuredPairs) {
                    const pairKey = `${pair.packageId}::${pair.courseId}`;
                    // Mapping do quản trị viên chọn và đã lưu là nguồn tin cậy. Không
                    // gọi lại outline HMO cho cặp này, vì HMO có thể trả rỗng tạm thời
                    // dù Lesson ID đã được gán hợp lệ trong calendar.
                    const existingMapping = calendarRows.find((item) => (String(item.package_id) === pair.packageId
                        && String(item.course_id) === pair.courseId
                        && String(item.mapped_hmo_lesson_id || '').trim()));
                    if (existingMapping?.mapped_hmo_lesson_id) {
                        nextMappings.push({
                            package_id: pair.packageId,
                            course_id: pair.courseId,
                            lesson_id: String(existingMapping.mapped_hmo_lesson_id),
                        });
                        continue;
                    }
                    const outlineError = outlineErrors.get(pairKey);
                    if (outlineError) {
                        await addIssue(runId, row, 'HMO_REQUEST_FAILED', outlineError, pair);
                        failure = true;
                        continue;
                    }
                    const outline = outlineByPair.get(pairKey);
                    if (!outline?.exists || !outline.lessons.length) {
                        await addIssue(runId, row, 'HMO_EMPTY', `Course ${pair.courseId} không trả Lesson ID HMO.`, pair);
                        failure = true;
                        continue;
                    }
                    const match = courseMatches.get(`${Number(row.calendar_id)}::${pairKey}`);
                    if (!match?.lessonId) {
                        const ambiguous = match?.errorCode === 'AMBIGUOUS';
                        const message = ambiguous
                            ? `Course ${pair.courseId} có ${match?.candidateCount || 2} tên bài gần giống cùng khớp; cần chọn thủ công.`
                            : `Course ${pair.courseId} không có Lesson ID phù hợp sau khi phân theo tên bài và giáo viên.`;
                        await addIssue(runId, row, ambiguous ? 'AMBIGUOUS' : 'NO_MATCH', message, pair);
                        failure = true;
                        continue;
                    }
                    nextMappings.push({ package_id: pair.packageId, course_id: pair.courseId, lesson_id: match.lessonId });
                }
                if (failure) {
                    programHasError = true;
                    failedLessonIds.add(String(row.lesson_id));
                    continue;
                }
                if (!row.key) {
                    await addIssue(runId, row, 'MISSING_CALENDAR_KEY', 'Lịch chưa có key nên không thể lưu Lesson ID HMO.');
                    programHasError = true;
                    failedLessonIds.add(String(row.lesson_id));
                    continue;
                }
                const mappingResult = await prisma_1.default.$transaction((tx) => (0, hocmai_sync_queue_service_1.reconcileCalendarMappingsAndEnqueue)(tx, row, nextMappings), {
                    maxWait: 10_000,
                    // Prisma mặc định đóng interactive transaction sau 5 giây. Job có
                    // thể phải chờ lock khi calendar đang được cập nhật đồng thời.
                    timeout: 30_000,
                });
                if (mappingResult.changed)
                    calendarsSynced += 1;
                syncedLessonIds.add(String(row.lesson_id));
            }
            programsProcessed += 1;
            if (programHasError)
                programsFailed += 1;
            lessonsFailed += failedLessonIds.size;
            lessonsSynced += Array.from(syncedLessonIds).filter((id) => !failedLessonIds.has(id)).length;
            await prisma_1.default.$executeRaw `UPDATE hmo_lesson_sync_runs SET programs_processed=${programsProcessed}, programs_failed=${programsFailed}, lessons_synced=${lessonsSynced}, lessons_failed=${lessonsFailed}, calendars_synced=${calendarsSynced}, heartbeat_at=NOW(3) WHERE id=${runId}`;
        }
        await prisma_1.default.$executeRaw `
      UPDATE hmo_lesson_sync_runs SET status=${lessonsFailed ? 'completed_with_errors' : 'completed'},
        active_key=NULL, current_program=NULL, heartbeat_at=NOW(3), finished_at=NOW(3) WHERE id=${runId}
    `;
    }
    catch (error) {
        const message = String(error?.message || error).slice(0, 2000);
        await prisma_1.default.$executeRaw `UPDATE hmo_lesson_sync_runs SET status='failed', active_key=NULL, current_program=NULL, heartbeat_at=NOW(3), last_error=${message}, finished_at=NOW(3) WHERE id=${runId}`.catch(() => undefined);
        logger_1.logger.error('HMO lesson sync failed:', message);
    }
    finally {
        clearInterval(heartbeatTimer);
    }
};
const startHmoLessonSync = async (triggerType, startedBy) => {
    await (0, exports.markInterruptedHmoLessonSyncRuns)();
    let inserted;
    try {
        inserted = await prisma_1.default.$executeRaw `INSERT INTO hmo_lesson_sync_runs (trigger_type, active_key, started_by, heartbeat_at) VALUES (${triggerType}, 'global', ${startedBy || null}, NOW(3))`;
    }
    catch (error) {
        if (String(error?.code) === 'P2010' || String(error?.message).includes('Duplicate'))
            return { started: false, message: 'Một lượt đồng bộ đang chạy' };
        throw error;
    }
    if (!inserted)
        return { started: false, message: 'Không thể tạo lượt đồng bộ' };
    const [{ id }] = await prisma_1.default.$queryRaw `SELECT id FROM hmo_lesson_sync_runs WHERE active_key='global' LIMIT 1`;
    runningPromise = executeRun(id).finally(() => { runningPromise = null; });
    void runningPromise;
    return { started: true, runId: String(id) };
};
exports.startHmoLessonSync = startHmoLessonSync;
const isHmoLessonSyncRunning = () => Boolean(runningPromise);
exports.isHmoLessonSyncRunning = isHmoLessonSyncRunning;
