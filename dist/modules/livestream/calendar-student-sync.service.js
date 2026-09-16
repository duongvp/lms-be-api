"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCalendarStudentSyncJob = exports.startCalendarStudentSync = exports.syncCalendarStudents = exports.buildStudentDisplayName = void 0;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const calendar_user_sync_service_1 = require("./calendar-user-sync.service");
const MAX_CALENDARS_PER_SYNC = 500;
let syncRunning = false;
let jobRunning = false;
const syncJobs = new Map();
const normalizeText = (value) => String(value ?? '').trim();
const maskPhone = (value) => `****${normalizeText(value).slice(-4)}`;
const maskEmail = (value) => {
    const localPart = normalizeText(value).split('@')[0];
    return `${localPart.slice(0, 3)}*****`;
};
const buildStudentDisplayName = (user) => {
    const userId = normalizeText(user.userid);
    const rawName = normalizeText(user.name);
    if (/^\d+$/.test(rawName))
        return `${userId} - ${maskPhone(rawName)}`;
    if (rawName.includes('@'))
        return `${userId} - ${maskEmail(rawName)}`;
    return `${userId} - ${rawName || 'Không có tên'}`;
};
exports.buildStudentDisplayName = buildStudentDisplayName;
const positiveNumberEnv = (name, fallback, maximum) => {
    const parsed = Number(process.env[name] || fallback);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), maximum) : fallback;
};
const loadApiConfig = () => {
    const url = normalizeText(process.env.HOCMAI_LIVE_USER_API_URL);
    const token = normalizeText(process.env.HOCMAI_LIVE_USER_API_TOKEN);
    if (!url || !token) {
        throw new ApiError_1.default('Chưa cấu hình HOCMAI_LIVE_USER_API_URL hoặc HOCMAI_LIVE_USER_API_TOKEN', 503);
    }
    try {
        new URL(url);
    }
    catch {
        throw new ApiError_1.default('HOCMAI_LIVE_USER_API_URL không hợp lệ', 503);
    }
    return {
        url,
        token,
        limit: positiveNumberEnv('HOCMAI_LIVE_USER_API_LIMIT', 100, 1000),
        timeoutMs: positiveNumberEnv('HOCMAI_LIVE_USER_API_TIMEOUT_MS', 30_000, 120_000),
        skipFinishTime: normalizeText(process.env.HOCMAI_LIVE_USER_SKIP_FINISHTIME) || '1',
    };
};
const normalizeOptionalRegisteredAt = (value) => {
    if (value === undefined || value === null)
        return undefined;
    const registeredAt = normalizeText(value);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(registeredAt);
    if (!match)
        throw new ApiError_1.default('Ngày đăng ký phải có định dạng dd/mm/yyyy', 400);
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day) {
        throw new ApiError_1.default('Ngày đăng ký không hợp lệ', 400);
    }
    return registeredAt;
};
const fetchApiPage = async (config, productIds, registeredAt, page) => {
    const url = new URL(config.url);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(config.limit));
    url.searchParams.set('skip_finishtime', config.skipFinishTime);
    if (registeredAt)
        url.searchParams.set('registed_at', registeredAt);
    productIds.forEach((productId, index) => {
        url.searchParams.append(`packages[${index}]`, productId);
    });
    let response;
    try {
        response = await fetch(url, {
            headers: { token: config.token, Accept: 'application/json' },
            signal: AbortSignal.timeout(config.timeoutMs),
        });
    }
    catch (error) {
        throw new ApiError_1.default(error?.name === 'TimeoutError'
            ? 'API HOCMAI bị timeout'
            : `Không thể kết nối API HOCMAI: ${error?.message || 'Lỗi không xác định'}`, 502);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        throw new ApiError_1.default(`API HOCMAI trả lỗi HTTP ${response.status}`, 502);
    }
    if (!payload || payload.status !== 'success' || !Array.isArray(payload.data)) {
        throw new ApiError_1.default('API HOCMAI trả dữ liệu không hợp lệ', 502);
    }
    return payload;
};
const fetchAllUsers = async (productIds, registeredAt, onProgress) => {
    const config = loadApiConfig();
    const firstPage = await fetchApiPage(config, productIds, registeredAt, 1);
    const total = Number(firstPage.total || 0);
    const perPage = Number(firstPage.per_page || config.limit);
    const calculatedLastPage = perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1;
    const lastPage = Math.max(1, Number(firstPage.last_page || calculatedLastPage));
    const users = [...firstPage.data];
    onProgress?.(Math.round(10 + 55 / lastPage), `Đã quét trang 1/${lastPage} từ API HOCMAI`);
    for (let page = 2; page <= lastPage; page += 1) {
        const payload = await fetchApiPage(config, productIds, registeredAt, page);
        users.push(...payload.data);
        onProgress?.(Math.round(10 + (55 * page) / lastPage), `Đã quét trang ${page}/${lastPage} từ API HOCMAI`);
    }
    return users;
};
const loadMappings = async (calendarIds) => {
    const calendars = await prisma_1.default.calendar.findMany({
        where: { id: { in: calendarIds } },
        select: { id: true, key: true, code: true, learn_number: true, start_time: true },
    });
    if (calendars.length !== calendarIds.length) {
        const found = new Set(calendars.map((item) => item.id));
        const missing = calendarIds.filter((id) => !found.has(id));
        throw new ApiError_1.default(`Không tìm thấy lịch học: ${missing.join(', ')}`, 404);
    }
    const invalidCalendar = calendars.find((item) => !normalizeText(item.key));
    if (invalidCalendar) {
        throw new ApiError_1.default(`${invalidCalendar.code} - Bài ${invalidCalendar.learn_number}: lịch chưa có key`, 400);
    }
    const classIdByEnrollment = new Map();
    calendars.forEach((calendar) => {
        const enrollmentKey = `${calendar.code}\u0000${calendar.learn_number}`;
        const classId = (0, calendar_user_sync_service_1.buildCalendarClassId)(calendar.code, calendar.start_time, calendar.learn_number);
        const previousClassId = classIdByEnrollment.get(enrollmentKey);
        if (previousClassId && previousClassId !== classId) {
            throw new ApiError_1.default(`Không thể đồng bộ cùng lúc nhiều lịch có chung ${calendar.code} - Bài ${calendar.learn_number}`, 400);
        }
        classIdByEnrollment.set(enrollmentKey, classId);
    });
    const keys = calendars.map((item) => normalizeText(item.key));
    const packageMappings = await prisma_1.default.package_lesson_mapping.findMany({
        where: { key: { in: keys } },
        select: { key: true, package_id: true },
        orderBy: { id: 'asc' },
    });
    const productIdsByKey = new Map();
    packageMappings.forEach((item) => {
        const key = normalizeText(item.key);
        const productId = normalizeText(item.package_id);
        if (!key || !productId)
            return;
        const current = productIdsByKey.get(key) || new Set();
        current.add(productId);
        productIdsByKey.set(key, current);
    });
    const mappings = [];
    for (const calendar of calendars) {
        const productIds = productIdsByKey.get(normalizeText(calendar.key));
        if (!productIds?.size) {
            throw new ApiError_1.default(`${calendar.code} - Bài ${calendar.learn_number}: chưa có package mapping`, 400);
        }
        productIds.forEach((productId) => mappings.push({
            productId,
            code: calendar.code,
            learnNumber: calendar.learn_number,
            startTime: calendar.start_time,
        }));
    }
    return mappings;
};
const isValidCreateRow = (row) => (normalizeText(row.username).length > 0
    && normalizeText(row.username).length <= 100
    && normalizeText(row.name).length > 0
    && normalizeText(row.name).length <= 150
    && normalizeText(row.code).length > 0
    && normalizeText(row.code).length <= 50
    && normalizeText(row.student_hmid).length <= 50
    && normalizeText(row.email).length <= 100
    && normalizeText(row.phone).length <= 20
    && normalizeText(row.class_id).length <= 100
    && Number.isInteger(Number(row.learn_number)));
const enrollmentKey = (row) => (`${normalizeText(row.username).toLocaleLowerCase()}\u0000${normalizeText(row.code).toLocaleLowerCase()}\u0000${Number(row.learn_number)}`);
const loadExistingEnrollments = async (rows) => {
    const existing = new Map();
    for (let index = 0; index < rows.length; index += 200) {
        const batch = rows.slice(index, index + 200);
        const found = await prisma_1.default.users.findMany({
            where: {
                OR: batch.map((row) => ({
                    username: normalizeText(row.username),
                    code: normalizeText(row.code),
                    learn_number: Number(row.learn_number),
                })),
            },
            select: { id: true, username: true, code: true, learn_number: true, class_id: true, room_id: true, islearn: true },
        });
        found.forEach((row) => existing.set(enrollmentKey(row), {
            id: row.id,
            class_id: row.class_id,
            room_id: row.room_id,
            islearn: row.islearn,
        }));
    }
    return existing;
};
const syncCalendarStudents = async (rawIds, rawRegisteredAt, onProgress) => {
    if (syncRunning)
        throw new ApiError_1.default('Đang có một lượt đồng bộ học viên khác', 409);
    const ids = Array.from(new Set((Array.isArray(rawIds) ? rawIds : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)));
    if (!ids.length)
        throw new ApiError_1.default('Vui lòng chọn ít nhất một lịch học', 400);
    if (ids.length > MAX_CALENDARS_PER_SYNC) {
        throw new ApiError_1.default(`Mỗi lần chỉ được đồng bộ tối đa ${MAX_CALENDARS_PER_SYNC} lịch học`, 400);
    }
    const registeredAt = normalizeOptionalRegisteredAt(rawRegisteredAt);
    syncRunning = true;
    try {
        onProgress?.(2, 'Đang đọc thông tin các lịch đã chọn');
        const mappings = await loadMappings(ids);
        const mappingsByProductId = new Map();
        mappings.forEach((mapping) => {
            const current = mappingsByProductId.get(mapping.productId) || [];
            current.push(mapping);
            mappingsByProductId.set(mapping.productId, current);
        });
        onProgress?.(8, `Đã tìm thấy ${mappingsByProductId.size} package, đang gọi API HOCMAI`);
        const apiUsers = await fetchAllUsers([...mappingsByProductId.keys()], registeredAt, onProgress);
        const rows = [];
        let unmatched = 0;
        apiUsers.forEach((user) => {
            const userMappings = mappingsByProductId.get(normalizeText(user.product_id)) || [];
            if (!userMappings.length) {
                unmatched += 1;
                return;
            }
            userMappings.forEach((mapping) => rows.push({
                student_hmid: normalizeText(user.userid),
                username: normalizeText(user.username),
                email: normalizeText(user.email),
                name: (0, exports.buildStudentDisplayName)(user),
                phone: normalizeText(user.phone),
                code: mapping.code,
                learn_number: mapping.learnNumber,
                islearn: 0,
                room_id: 1,
                class_id: (0, calendar_user_sync_service_1.buildCalendarClassId)(mapping.code, mapping.startTime, mapping.learnNumber),
            }));
        });
        onProgress?.(72, `Đã mapping ${rows.length} dòng học viên`);
        const validRows = rows.filter(isValidCreateRow);
        let failed = rows.length - validRows.length;
        const uniqueRowsByEnrollment = new Map();
        validRows.forEach((row) => {
            const key = enrollmentKey(row);
            if (!uniqueRowsByEnrollment.has(key))
                uniqueRowsByEnrollment.set(key, row);
        });
        const uniqueRows = [...uniqueRowsByEnrollment.values()];
        let skipped = validRows.length - uniqueRows.length;
        onProgress?.(76, `Đang kiểm tra ${uniqueRows.length} enrollment hiện có`);
        const existingByEnrollment = await loadExistingEnrollments(uniqueRows);
        const newRows = [];
        const updateGroups = new Map();
        uniqueRows.forEach((row) => {
            const existing = existingByEnrollment.get(enrollmentKey(row));
            if (!existing) {
                newRows.push(row);
                return;
            }
            const classId = normalizeText(row.class_id);
            if (existing.class_id === classId && existing.room_id === 1 && existing.islearn === 0) {
                skipped += 1;
                return;
            }
            const group = updateGroups.get(classId) || { classId, ids: [] };
            group.ids.push(existing.id);
            updateGroups.set(classId, group);
        });
        let inserted = 0;
        let updated = 0;
        const insertBatches = Math.ceil(newRows.length / 200);
        const updateBatches = [...updateGroups.values()].reduce((total, group) => total + Math.ceil(group.ids.length / 500), 0);
        const totalBatches = Math.max(1, insertBatches + updateBatches);
        let completedBatches = 0;
        for (let index = 0; index < newRows.length; index += 200) {
            const result = await prisma_1.default.users.createMany({
                data: newRows.slice(index, index + 200),
                skipDuplicates: true,
            });
            inserted += result.count;
            skipped += newRows.slice(index, index + 200).length - result.count;
            completedBatches += 1;
            onProgress?.(Math.round(76 + (23 * completedBatches) / totalBatches), `Đã thêm ${inserted}/${newRows.length} học viên mới`);
        }
        for (const group of updateGroups.values()) {
            for (let index = 0; index < group.ids.length; index += 500) {
                const ids = group.ids.slice(index, index + 500);
                const result = await prisma_1.default.users.updateMany({
                    where: { id: { in: ids } },
                    data: {
                        class_id: group.classId,
                        room_id: 1,
                        islearn: 0,
                    },
                });
                updated += result.count;
                failed += ids.length - result.count;
                completedBatches += 1;
                onProgress?.(Math.round(76 + (23 * completedBatches) / totalBatches), `Đã cập nhật lớp cho ${updated} học viên hiện có`);
            }
        }
        const result = {
            apiUsers: apiUsers.length,
            mappedRows: rows.length,
            unmatched,
            inserted,
            updated,
            skipped,
            failed,
        };
        onProgress?.(100, 'Đồng bộ học viên hoàn tất');
        return result;
    }
    finally {
        syncRunning = false;
    }
};
exports.syncCalendarStudents = syncCalendarStudents;
const startCalendarStudentSync = (rawIds, rawRegisteredAt, ownerUserId) => {
    if (jobRunning || syncRunning)
        throw new ApiError_1.default('Đang có một lượt đồng bộ học viên khác', 409);
    const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map(Number)
            .filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length)
        throw new ApiError_1.default('Vui lòng chọn ít nhất một lịch học', 400);
    if (ids.length > MAX_CALENDARS_PER_SYNC)
        throw new ApiError_1.default(`Chỉ được chọn tối đa ${MAX_CALENDARS_PER_SYNC} lịch`, 400);
    normalizeOptionalRegisteredAt(rawRegisteredAt);
    jobRunning = true;
    const jobId = (0, crypto_1.randomUUID)();
    const job = {
        jobId,
        ownerUserId,
        status: 'queued',
        progress: 0,
        message: 'Đang chờ bắt đầu đồng bộ',
        items: [],
    };
    syncJobs.set(jobId, job);
    void (async () => {
        job.status = 'running';
        try {
            const calendars = await prisma_1.default.calendar.findMany({
                where: { id: { in: ids } },
                select: { id: true, code: true, learn_number: true, lesson_name: true, start_time: true, system_type: true },
            });
            const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));
            job.items = ids.map((id) => {
                const calendar = byId.get(id);
                return {
                    calendarId: id, code: calendar?.code || 'Lịch không còn tồn tại',
                    learnNumber: calendar?.learn_number || 0, lessonName: calendar?.lesson_name || '',
                    startTime: calendar?.start_time || null, systemType: calendar?.system_type || null,
                    status: 'pending', progress: 0, message: 'Chờ xử lý',
                };
            });
            // Không cho hai lịch ghi đè cùng enrollment sang hai class_id khác nhau.
            const targets = new Map();
            for (const calendar of calendars) {
                const key = `${calendar.code.toLowerCase()}\u0000${calendar.learn_number}`;
                const classId = (0, calendar_user_sync_service_1.buildCalendarClassId)(calendar.code, calendar.start_time, calendar.learn_number);
                if (targets.has(key) && targets.get(key) !== classId) {
                    throw new ApiError_1.default(`Vui lòng chỉ chọn một lịch cho ${calendar.code} - Bài ${calendar.learn_number}: các lịch đang có ngày học khác nhau`, 400);
                }
                targets.set(key, classId);
            }
            const totals = {
                apiUsers: 0, mappedRows: 0, unmatched: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
            };
            for (const [index, item] of job.items.entries()) {
                item.status = 'running';
                try {
                    item.result = await (0, exports.syncCalendarStudents)([item.calendarId], rawRegisteredAt, (progress, message) => {
                        item.progress = progress;
                        item.message = message;
                        job.progress = Math.round((index * 100 + progress) / ids.length);
                        job.message = `${item.code} - Bài ${item.learnNumber}: ${message}`;
                    });
                    item.status = item.result.failed ? 'error' : 'success';
                    item.message = `Thêm mới ${item.result.inserted}, cập nhật lớp ${item.result.updated}, bỏ qua ${item.result.skipped}${item.result.failed ? `, thất bại ${item.result.failed}` : ''}`;
                    for (const key of Object.keys(totals)) {
                        totals[key] += item.result[key];
                    }
                }
                catch (error) {
                    item.status = 'error';
                    item.message = String(error?.message || 'Không thể đồng bộ lịch này');
                }
                item.progress = 100;
                job.progress = Math.round(((index + 1) * 100) / ids.length);
            }
            job.result = totals;
            job.status = 'completed';
            job.progress = 100;
            const errors = job.items.filter((item) => item.status === 'error').length;
            job.message = `Đã xử lý ${ids.length} lịch${errors ? `, ${errors} lịch có lỗi` : ''}`;
        }
        catch (error) {
            job.status = 'failed';
            job.error = String(error?.message || 'Không thể đồng bộ học viên');
            job.message = 'Đồng bộ học viên thất bại';
        }
        finally {
            jobRunning = false;
            const cleanupTimer = setTimeout(() => syncJobs.delete(jobId), 30 * 60 * 1000);
            cleanupTimer.unref?.();
        }
    })();
    return { jobId, status: job.status, progress: job.progress };
};
exports.startCalendarStudentSync = startCalendarStudentSync;
const getCalendarStudentSyncJob = (jobId, ownerUserId) => {
    const job = syncJobs.get(jobId);
    if (!job || job.ownerUserId !== ownerUserId) {
        throw new ApiError_1.default('Không tìm thấy tiến trình đồng bộ học viên', 404);
    }
    return job;
};
exports.getCalendarStudentSyncJob = getCalendarStudentSyncJob;
