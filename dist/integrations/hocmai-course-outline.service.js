"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchHocmaiCourseOutlines = exports.HmoCourseOutlineError = void 0;
class HmoCourseOutlineError extends Error {
    errorCode;
    constructor(errorCode, message) {
        super(message);
        this.errorCode = errorCode;
    }
}
exports.HmoCourseOutlineError = HmoCourseOutlineError;
const DEFAULT_OUTLINE_URL = 'https://hocmai.vn/api/course/outline';
const getPositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const parseSuccessfulResponse = (payload, pair) => {
    const course = payload?.data?.course;
    if (!course || String(course.id ?? '').trim() !== pair.courseId) {
        throw new HmoCourseOutlineError('HMO_INVALID_RESPONSE', `HMO trả Course không hợp lệ cho Package ${pair.packageId} / Course ${pair.courseId}`);
    }
    if (!Array.isArray(course.sections)) {
        throw new HmoCourseOutlineError('HMO_INVALID_RESPONSE', `HMO thiếu danh sách Section cho Package ${pair.packageId} / Course ${pair.courseId}`);
    }
    // `section.id` chỉ là ID nhóm nội dung. Lesson ID HMO cần dùng trong lịch là
    // ID của phần tử nằm trong `section.lessons[]`.
    const lessons = course.sections.flatMap((section) => (Array.isArray(section?.lessons) ? section.lessons : [])).map((lesson) => ({
        lessonId: String(lesson?.id ?? lesson?.lessonId ?? '').trim(),
        name: String(lesson?.name ?? '').trim() || undefined,
    })).filter((lesson) => lesson.lessonId);
    return {
        packageId: pair.packageId,
        courseId: pair.courseId,
        exists: true,
        lessons: Array.from(new Map(lessons.map((lesson) => [lesson.lessonId, lesson])).values()),
    };
};
const fetchCourseOutline = async (baseUrl, token, timeoutMs, pair) => {
    const url = new URL(baseUrl);
    url.searchParams.set('course', pair.courseId);
    url.searchParams.set('package', pair.packageId);
    url.searchParams.set('token', token);
    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
            headers: { Accept: 'application/json' },
        });
    }
    catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            throw new HmoCourseOutlineError('HMO_TIMEOUT', `HMO quá thời gian chờ cho Package ${pair.packageId} / Course ${pair.courseId}`);
        }
        throw new HmoCourseOutlineError('HMO_BATCH_ERROR', `Không thể gọi HMO cho Package ${pair.packageId} / Course ${pair.courseId}: ${error?.message || 'Lỗi kết nối'}`);
    }
    if (!response.ok) {
        throw new HmoCourseOutlineError('HMO_BATCH_ERROR', `HMO trả HTTP ${response.status} cho Package ${pair.packageId} / Course ${pair.courseId}`);
    }
    let payload;
    try {
        payload = await response.json();
    }
    catch {
        throw new HmoCourseOutlineError('HMO_INVALID_RESPONSE', `HMO trả dữ liệu không phải JSON cho Package ${pair.packageId} / Course ${pair.courseId}`);
    }
    if (payload?.status === 'error' || payload?.data === null) {
        return {
            packageId: pair.packageId,
            courseId: pair.courseId,
            exists: false,
            lessons: [],
        };
    }
    if (payload?.status !== 'success') {
        throw new HmoCourseOutlineError('HMO_INVALID_RESPONSE', `HMO trả trạng thái không hợp lệ cho Package ${pair.packageId} / Course ${pair.courseId}`);
    }
    return parseSuccessfulResponse(payload, pair);
};
const wait = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});
// HMO đôi khi trả `success` nhưng chưa hydrate `section.lessons`. Retry chỉ
// áp dụng cho phản hồi thành công rỗng; lỗi HTTP/timeout vẫn được trả ngay.
const fetchCourseOutlineWithEmptyLessonsRetry = async (baseUrl, token, timeoutMs, pair, retryCount, retryDelayMs) => {
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const result = await fetchCourseOutline(baseUrl, token, timeoutMs, pair);
        if (!result.exists || result.lessons.length || attempt === retryCount) {
            return result;
        }
        await wait(retryDelayMs * (attempt + 1));
    }
    throw new Error('Không thể tải outline HMO');
};
const fetchHocmaiCourseOutlines = async (pairs) => {
    if (!pairs.length)
        return [];
    const baseUrl = String(process.env.HMO_COURSE_OUTLINE_URL || DEFAULT_OUTLINE_URL).trim();
    const token = String(process.env.HMO_COURSE_OUTLINE_TOKEN || process.env.HMO_BATCH_TOKEN || '').trim();
    if (!token) {
        throw new HmoCourseOutlineError('HMO_BATCH_ERROR', 'Chưa cấu hình HMO_COURSE_OUTLINE_TOKEN');
    }
    const timeoutMs = getPositiveInteger(process.env.HMO_COURSE_OUTLINE_TIMEOUT_MS
        || process.env.HMO_BATCH_TIMEOUT_MS, 15_000);
    const concurrency = Math.min(getPositiveInteger(process.env.HMO_COURSE_OUTLINE_CONCURRENCY, 5), 20);
    const emptyLessonsRetryCount = Math.min(getPositiveInteger(process.env.HMO_COURSE_OUTLINE_EMPTY_LESSONS_RETRIES, 2), 5);
    const emptyLessonsRetryDelayMs = Math.min(getPositiveInteger(process.env.HMO_COURSE_OUTLINE_EMPTY_LESSONS_RETRY_DELAY_MS, 400), 5_000);
    const results = new Array(pairs.length);
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < pairs.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await fetchCourseOutlineWithEmptyLessonsRetry(baseUrl, token, timeoutMs, pairs[index], emptyLessonsRetryCount, emptyLessonsRetryDelayMs);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker));
    return results;
};
exports.fetchHocmaiCourseOutlines = fetchHocmaiCourseOutlines;
