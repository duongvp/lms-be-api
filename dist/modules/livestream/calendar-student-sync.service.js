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
let activeJobId = null;
const syncJobs = new Map();
const normalizeText = (value) => String(value ?? '').trim();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const networkErrorDetail = (error) => {
    const cause = error?.cause;
    const code = normalizeText(cause?.code || error?.code);
    const message = normalizeText(cause?.message || error?.message) || 'Lỗi không xác định';
    return code && !message.includes(code) ? `${code}: ${message}` : message;
};
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
    // Không log token; chỉ log URL/query để đối chiếu tham số gọi HOCMAI.
    console.info('[calendar-student-sync][HOCMAI API]', url.toString());
    const maximumAttempts = 5;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { token: config.token, Accept: 'application/json' },
                signal: AbortSignal.timeout(config.timeoutMs),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                if ((response.status === 429 || response.status >= 500) && attempt < maximumAttempts) {
                    await wait(Math.min(8_000, 1_000 * (2 ** (attempt - 1))));
                    continue;
                }
                throw new ApiError_1.default(`API HOCMAI trả lỗi HTTP ${response.status} ở trang ${page}`, 502);
            }
            if (!payload || payload.status !== 'success' || !Array.isArray(payload.data)) {
                throw new ApiError_1.default(`API HOCMAI trả dữ liệu không hợp lệ ở trang ${page}`, 502);
            }
            return payload;
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            if (attempt < maximumAttempts) {
                await wait(Math.min(8_000, 1_000 * (2 ** (attempt - 1))));
                continue;
            }
            throw new ApiError_1.default(error?.name === 'TimeoutError'
                ? `API HOCMAI bị timeout ở trang ${page} sau ${maximumAttempts} lần thử`
                : `Không thể kết nối API HOCMAI ở trang ${page} sau ${maximumAttempts} lần thử: ${networkErrorDetail(error)}`, 502);
        }
    }
    throw new ApiError_1.default(`Không thể tải trang ${page} từ API HOCMAI`, 502);
};
const fetchAllUsers = async (productIds, registeredAt, onProgress) => {
    const config = loadApiConfig();
    const firstPage = await fetchApiPage(config, productIds, registeredAt, 1);
    const total = Number(firstPage.total ?? 0);
    if (!Number.isSafeInteger(total) || total < 0) {
        throw new ApiError_1.default('API HOCMAI trả tổng học viên không hợp lệ', 502);
    }
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
    return { users, total };
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
const syncCalendarStudents = async (rawIds, rawRegisteredAt, onProgress, prefetchedApiUsers) => {
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
        const fetched = prefetchedApiUsers
            ? { users: prefetchedApiUsers, total: prefetchedApiUsers.length }
            : await fetchAllUsers([...mappingsByProductId.keys()], registeredAt, onProgress);
        const apiUsers = fetched.users;
        const rowContexts = [];
        let unmatched = 0;
        apiUsers.forEach((user) => {
            const userMappings = mappingsByProductId.get(normalizeText(user.product_id)) || [];
            if (!userMappings.length) {
                unmatched += 1;
                return;
            }
            userMappings.forEach((mapping) => rowContexts.push({
                productId: normalizeText(user.product_id),
                row: {
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
                },
            }));
        });
        const rows = rowContexts.map(({ row }) => row);
        onProgress?.(72, `Đã mapping ${rows.length} dòng học viên`);
        const validRowContexts = rowContexts.filter(({ row }) => isValidCreateRow(row));
        let failed = rows.length - validRowContexts.length;
        const uniqueRowsByEnrollment = new Map();
        const duplicateDetails = [];
        validRowContexts.forEach((context) => {
            const key = enrollmentKey(context.row);
            const kept = uniqueRowsByEnrollment.get(key);
            if (!kept) {
                uniqueRowsByEnrollment.set(key, context);
                return;
            }
            duplicateDetails.push({
                studentHmid: normalizeText(context.row.student_hmid),
                username: normalizeText(context.row.username),
                code: normalizeText(context.row.code),
                learnNumber: Number(context.row.learn_number),
                classId: normalizeText(context.row.class_id),
                productId: context.productId,
                duplicateOfProductId: kept.productId,
            });
        });
        const uniqueRows = [...uniqueRowsByEnrollment.values()].map(({ row }) => row);
        const duplicateRows = duplicateDetails.length;
        let skipped = 0;
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
        const plannedInserted = newRows.length;
        const plannedUpdated = [...updateGroups.values()].reduce((total, group) => total + group.ids.length, 0);
        let inserted = 0;
        let updated = 0;
        const insertBatches = Math.ceil(newRows.length / 200);
        const updateBatches = [...updateGroups.values()].reduce((total, group) => total + Math.ceil(group.ids.length / 500), 0);
        const totalBatches = Math.max(1, insertBatches + updateBatches);
        let completedBatches = 0;
        for (let index = 0; index < newRows.length; index += 200) {
            const batch = newRows.slice(index, index + 200);
            const write = await prisma_1.default.users.createMany({ data: batch, skipDuplicates: true });
            inserted += write.count;
            skipped += batch.length - write.count;
            completedBatches += 1;
            onProgress?.(Math.round(76 + (23 * completedBatches) / totalBatches), `Đã thêm ${inserted}/${newRows.length} enrollment`);
        }
        for (const group of updateGroups.values()) {
            for (let index = 0; index < group.ids.length; index += 500) {
                const ids = group.ids.slice(index, index + 500);
                const write = await prisma_1.default.users.updateMany({
                    where: { id: { in: ids } },
                    data: { class_id: group.classId, room_id: 1, islearn: 0 },
                });
                updated += write.count;
                failed += ids.length - write.count;
                completedBatches += 1;
                onProgress?.(Math.round(76 + (23 * completedBatches) / totalBatches), `Đã cập nhật ${updated}/${plannedUpdated} enrollment`);
            }
        }
        const result = {
            preview: false,
            apiUsers: fetched.total,
            uniqueApiUsers: new Set(apiUsers.map((user) => normalizeText(user.username).toLowerCase()).filter(Boolean)).size,
            mappedRows: rows.length,
            uniqueEnrollments: uniqueRows.length,
            duplicateRows,
            duplicateDetails,
            unmatched,
            inserted,
            updated,
            plannedInserted,
            plannedUpdated,
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
    if (jobRunning || syncRunning) {
        const activeJob = activeJobId ? syncJobs.get(activeJobId) : undefined;
        if (activeJob && activeJob.ownerUserId === ownerUserId) {
            return {
                jobId: activeJob.jobId,
                status: activeJob.status,
                progress: activeJob.progress,
                resumed: true,
            };
        }
        throw new ApiError_1.default('Đang có một lượt đồng bộ học viên khác', 409);
    }
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
    activeJobId = jobId;
    void (async () => {
        job.status = 'running';
        try {
            const calendars = await prisma_1.default.calendar.findMany({
                where: { id: { in: ids } },
                select: { id: true, key: true, code: true, learn_number: true, lesson_name: true, start_time: true, system_type: true },
            });
            if (calendars.length !== ids.length) {
                const found = new Set(calendars.map((calendar) => calendar.id));
                throw new ApiError_1.default(`Không tìm thấy lịch học: ${ids.filter((id) => !found.has(id)).join(', ')}`, 404);
            }
            const calendarsByProgram = new Map();
            ids.forEach((id) => {
                const calendar = calendars.find((row) => row.id === id);
                const group = calendarsByProgram.get(calendar.code) || [];
                group.push(calendar);
                calendarsByProgram.set(calendar.code, group);
            });
            job.items = [...calendarsByProgram.entries()].map(([code, programCalendars]) => ({
                calendarId: programCalendars[0].id,
                calendarIds: programCalendars.map((calendar) => calendar.id),
                calendarCount: programCalendars.length,
                lessonCount: new Set(programCalendars.map((calendar) => calendar.learn_number)).size,
                code,
                learnNumber: 0,
                lessonName: `${programCalendars.length} lịch đã chọn`,
                startTime: null,
                systemType: programCalendars[0].system_type,
                status: 'pending',
                progress: 0,
                message: 'Chờ xử lý chương trình',
            }));
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
                preview: false, apiUsers: 0, uniqueApiUsers: 0, mappedRows: 0,
                uniqueEnrollments: 0, duplicateRows: 0, duplicateDetails: [], unmatched: 0, inserted: 0, updated: 0,
                plannedInserted: 0, plannedUpdated: 0, skipped: 0, failed: 0,
            };
            for (const [index, item] of job.items.entries()) {
                item.status = 'running';
                try {
                    item.result = await (0, exports.syncCalendarStudents)(item.calendarIds, rawRegisteredAt, (progress, message) => {
                        item.progress = progress;
                        item.message = message;
                        job.progress = Math.round((index * 100 + progress) / job.items.length);
                        job.message = `${item.code}: ${message}`;
                    });
                    item.status = item.result.failed ? 'error' : 'success';
                    item.message = `Thêm ${item.result.inserted}, cập nhật ${item.result.updated}, bỏ qua ${item.result.skipped}${item.result.failed ? `, lỗi ${item.result.failed}` : ''}`;
                    const numericKeys = [
                        'uniqueApiUsers', 'mappedRows', 'uniqueEnrollments', 'duplicateRows', 'unmatched',
                        'inserted', 'updated', 'plannedInserted', 'plannedUpdated', 'skipped', 'failed',
                    ];
                    for (const key of numericKeys) {
                        totals[key] += item.result[key];
                    }
                    totals.duplicateDetails.push(...item.result.duplicateDetails);
                    totals.apiUsers += item.result.apiUsers;
                }
                catch (error) {
                    item.status = 'error';
                    item.message = String(error?.message || 'Không thể đồng bộ chương trình này');
                }
                item.progress = 100;
                job.progress = Math.round(((index + 1) * 100) / ids.length);
            }
            job.result = totals;
            job.status = 'completed';
            job.progress = 100;
            const errors = job.items.filter((item) => item.status === 'error').length;
            job.message = `Đã xử lý ${job.items.length} chương trình${errors ? `, ${errors} chương trình có lỗi` : ''}`;
        }
        catch (error) {
            job.status = 'failed';
            job.error = String(error?.message || 'Không thể đồng bộ học viên');
            job.message = 'Đồng bộ học viên thất bại';
        }
        finally {
            jobRunning = false;
            if (activeJobId === jobId)
                activeJobId = null;
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
