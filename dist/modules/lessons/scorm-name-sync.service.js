"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyScormCourseMappingSync = exports.previewScormCourseMappingSync = exports.getScormNameSyncJob = exports.startScormNameSync = exports.syncScormNames = exports.toScormNamePayload = exports.previewScormNameSync = exports.getScormNameSyncSheets = void 0;
const XLSX = __importStar(require("xlsx"));
const logger_1 = require("../../utils/logger");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const package_course_sheet_service_1 = require("../../integrations/package-course-sheet.service");
const hmo_lesson_sync_service_1 = require("../hmo-lesson-sync/hmo-lesson-sync.service");
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/16jD8NrKsCJIqiz6edfSbsui0CdxQhCLvv8RvChR99M0/edit?usp=sharing';
const REQUIRED_HEADERS = ['Tên bài giảng', 'Tên GV', 'ID course', 'ID Bài giảng'];
const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const headerKey = (value) => normalize(value).toLocaleLowerCase('vi-VN');
const context = (sheet, row, message) => `${sheet} / dòng ${row}: ${message}`;
const positiveInt = (value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const sheetUrl = () => String(process.env.SCORM_NAME_SYNC_SHEET_URL || DEFAULT_SHEET_URL).trim();
const getSpreadsheetId = () => {
    const match = sheetUrl().match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    if (!match)
        throw new Error('SCORM_NAME_SYNC_SHEET_URL không hợp lệ');
    return match[1];
};
let cachedWorkbook = null;
let loadingWorkbook = null;
const getWorkbookCacheTtl = () => Math.max(10_000, Number(process.env.SCORM_NAME_SYNC_SHEET_CACHE_TTL_MS) || 120_000);
const loadWorkbook = async () => {
    let response;
    try {
        response = await fetch(`https://docs.google.com/spreadsheets/d/${getSpreadsheetId()}/export?format=xlsx`, { signal: AbortSignal.timeout(20_000) });
    }
    catch (error) {
        throw new Error(error?.name === 'TimeoutError' ? 'Google Sheets phản hồi quá thời gian' : 'Không thể kết nối tới Google Sheets');
    }
    if (!response.ok)
        throw new Error(`Không thể đọc Google Sheets (HTTP ${response.status}). Hãy kiểm tra quyền xem.`);
    try {
        return XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer', raw: false });
    }
    catch {
        throw new Error('Google Sheets không trả workbook Excel hợp lệ');
    }
};
const getWorkbook = async () => {
    if (cachedWorkbook && cachedWorkbook.expiresAt > Date.now())
        return cachedWorkbook.value;
    if (!loadingWorkbook) {
        loadingWorkbook = loadWorkbook().then((value) => {
            cachedWorkbook = { value, expiresAt: Date.now() + getWorkbookCacheTtl() };
            return value;
        }).finally(() => { loadingWorkbook = null; });
    }
    return loadingWorkbook;
};
const workbookSheets = (workbook) => workbook.SheetNames.map((name) => ({
    // `raw: false` giữ nguyên định dạng hiển thị (đặc biệt số 0 cuối ID) thay vì
    // ép về JavaScript number và làm 173130 thành 17313.
    name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false }),
}));
const getScormNameSyncSheets = async () => {
    const workbook = await getWorkbook();
    return workbookSheets(workbook)
        .filter((sheet) => normalize(sheet.name).toLocaleLowerCase('vi-VN') !== 'gv')
        .filter((sheet) => { try {
        headerIndexes(sheet.rows, sheet.name);
        return true;
    }
    catch {
        return false;
    } })
        .map((sheet) => ({ title: sheet.name }));
};
exports.getScormNameSyncSheets = getScormNameSyncSheets;
const headerIndexes = (rows, sheetName) => {
    for (let headerRow = 0; headerRow < Math.min(rows.length, 20); headerRow += 1) {
        const index = new Map((rows[headerRow] || []).map((value, i) => [headerKey(value), i]));
        const found = Object.fromEntries(REQUIRED_HEADERS.map((name) => [name, index.get(headerKey(name))]));
        if (REQUIRED_HEADERS.every((name) => found[name] !== undefined)) {
            return { headerRow, lessonName: found['Tên bài giảng'], teacher: found['Tên GV'], course: found['ID course'], lesson: found['ID Bài giảng'], subject: index.get(headerKey('Môn')), system: index.get(headerKey('Hệ thống')) };
        }
    }
    throw new Error(`${sheetName}: thiếu header bắt buộc ${REQUIRED_HEADERS.join(', ')}`);
};
const parseIds = (raw, label, sheet, row, warnings) => {
    // Google Sheets có thể tự diễn giải `1771,3355` là số thập phân theo locale
    // và export XLSX thành `1771.3355`. Cả hai biểu diễn đều là danh sách ID
    // được người dùng nhập, không phải một ID thập phân.
    const values = normalize(raw).split(/[,.]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) {
        warnings.push({ sheetName: sheet, rowNumber: row, message: context(sheet, row, `thiếu ${label}`) });
        return null;
    }
    const ids = values.map(positiveInt);
    if (ids.some((id) => id === null)) {
        warnings.push({ sheetName: sheet, rowNumber: row, message: context(sheet, row, `${label} không hợp lệ`) });
        return null;
    }
    return ids;
};
const getTeachers = (sheet) => {
    const header = new Map((sheet.rows[0] || []).map((value, i) => [headerKey(value), i]));
    const nameIndex = header.get(headerKey('Tên GV'));
    const titleIndex = header.get(headerKey('Chức danh'));
    if (nameIndex === undefined || titleIndex === undefined)
        throw new Error('GV: thiếu header Tên GV hoặc Chức danh');
    const teachers = new Map();
    sheet.rows.slice(1).forEach((row) => { const name = normalize(row[nameIndex]); const title = normalize(row[titleIndex]); if (name && title)
        teachers.set(name.toLocaleLowerCase('vi-VN'), title); });
    return teachers;
};
const bareTeacherName = (name) => name.replace(/^(cô|thầy)\s+/iu, '').trim();
const parseProgramRows = (sheets, warnings) => sheets.flatMap((sheet) => {
    const columns = headerIndexes(sheet.rows, sheet.name);
    const parsed = [];
    sheet.rows.slice(columns.headerRow + 1).forEach((row, offset) => {
        const rowNumber = columns.headerRow + offset + 2;
        const lessonName = normalize(row[columns.lessonName]);
        const teacherName = normalize(row[columns.teacher]);
        const subject = columns.subject === undefined ? '' : normalize(row[columns.subject]);
        // Sheet vận hành có các dòng hướng dẫn/đệm; thiếu bất kỳ cột nghiệp vụ nào
        // hoặc Môn trống/chứa "nghỉ" đều không phải lesson cần đồng bộ.
        if (!lessonName || !teacherName || !normalize(row[columns.course]) || !normalize(row[columns.lesson]) || (columns.subject !== undefined && (!subject || /nghỉ/iu.test(subject))))
            return;
        const courseIds = parseIds(row[columns.course], 'ID course', sheet.name, rowNumber, warnings);
        const lessonIds = parseIds(row[columns.lesson], 'ID Bài giảng', sheet.name, rowNumber, warnings);
        if (!courseIds || !lessonIds)
            return;
        if (courseIds.length !== lessonIds.length) {
            warnings.push({ sheetName: sheet.name, rowNumber, message: context(sheet.name, rowNumber, 'số lượng ID course và ID Bài giảng không bằng nhau') });
            return;
        }
        parsed.push({ sheetName: sheet.name, rowNumber, type: columns.system === undefined || normalize(row[columns.system]) === '1' ? 'TOPCLASS' : 'TOPUNI', lessonName, teacherName, courseIds, lessonIds });
    });
    return parsed;
});
const previewScormNameSync = async (selectedNames) => {
    const workbook = await getWorkbook();
    const allSheets = workbookSheets(workbook);
    const gv = allSheets.find((sheet) => normalize(sheet.name).toLocaleLowerCase('vi-VN') === 'gv');
    if (!gv)
        throw new Error('Không tìm thấy tab GV');
    const available = allSheets.filter((sheet) => sheet !== gv);
    const selected = selectedNames.length ? available.filter((sheet) => selectedNames.includes(sheet.name)) : available;
    if (!selected.length)
        throw new Error('Không tìm thấy trang tính được chọn');
    const warnings = [];
    const rows = parseProgramRows(selected, warnings);
    const teachers = getTeachers(gv);
    const courseTeachers = new Map();
    rows.filter((row) => row.type === 'TOPCLASS').forEach((row) => row.courseIds.forEach((courseId) => {
        const name = bareTeacherName(row.teacherName).toLocaleLowerCase('vi-VN');
        if (name)
            (courseTeachers.get(courseId) || courseTeachers.set(courseId, new Set()).get(courseId)).add(name);
    }));
    const updates = [];
    let validLessons = 0;
    rows.forEach((row) => row.courseIds.forEach((courseId, index) => {
        const lessonId = row.lessonIds[index];
        validLessons += 1;
        let newName = row.lessonName;
        if (row.type === 'TOPCLASS') {
            const bare = bareTeacherName(row.teacherName);
            const title = teachers.get(bare.toLocaleLowerCase('vi-VN'));
            if (!title) {
                warnings.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, message: context(row.sheetName, row.rowNumber, `Không tìm thấy chức danh GV: ${bare || '(trống)'} (course_id ${courseId}, lesson_id ${lessonId})`) });
                return;
            }
            if ((courseTeachers.get(courseId)?.size || 0) >= 2)
                newName = `${row.lessonName}_${title} ${bare}`;
        }
        if (newName !== row.lessonName)
            updates.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, type: row.type, courseId, lessonId, teacherName: row.teacherName, oldName: row.lessonName, newName });
    }));
    warnings.forEach((warning) => logger_1.logger.warn(`[SCORM name sync] ${warning.message}`));
    return { sheetsProcessed: selected.length, rowsRead: rows.length, validLessons, skippedLessons: warnings.length, updates, warnings };
};
exports.previewScormNameSync = previewScormNameSync;
const toScormNamePayload = (preview) => preview.updates.map(({ courseId, lessonId, newName }) => ({ course_id: courseId, lesson_id: lessonId, lesson_name: newName }));
exports.toScormNamePayload = toScormNamePayload;
const syncScormNames = async (selectedNames, onProgress) => {
    const preview = await (0, exports.previewScormNameSync)(selectedNames);
    const payload = (0, exports.toScormNamePayload)(preview);
    const token = String(process.env.SYNC_SCORM_TOKEN || '').trim();
    if (!token)
        throw new Error('Chưa cấu hình SYNC_SCORM_TOKEN');
    const batchSize = Math.min(500, Math.max(1, Number(process.env.SYNC_SCORM_BATCH_SIZE) || 500));
    let updated = 0;
    onProgress?.(0, payload.length);
    for (let i = 0; i < payload.length; i += batchSize) {
        const batch = payload.slice(i, i + batchSize);
        let response;
        console.log("batch", batch);
        try {
            response = await fetch('https://hocmai.vn/api/live-class/sync-scorm-name', { method: 'POST', headers: { TOKEN: token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(Number(process.env.SYNC_SCORM_TIMEOUT_MS) || 30_000) });
        }
        catch (error) {
            throw new Error(`Không thể cập nhật batch ${i / batchSize + 1}: ${error?.name === 'TimeoutError' ? 'quá thời gian' : error?.message || 'lỗi kết nối'}`);
        }
        if (!response.ok)
            throw new Error(`API cập nhật batch ${i / batchSize + 1} trả HTTP ${response.status}`);
        const body = await response.text();
        if (body.trim()) {
            try {
                const responseData = JSON.parse(body);
                logger_1.logger.info(`[SCORM name sync] API batch ${i / batchSize + 1} response:`, responseData);
            }
            catch {
                throw new Error(`API cập nhật batch ${i / batchSize + 1} trả dữ liệu không hợp lệ`);
            }
        }
        updated += batch.length;
        onProgress?.(updated, payload.length);
    }
    return { ...preview, updatesNeeded: payload.length, updated };
};
exports.syncScormNames = syncScormNames;
const syncJobs = new Map();
const startScormNameSync = (selectedNames) => {
    const id = crypto.randomUUID();
    const job = { id, status: 'running', updated: 0, total: 0 };
    syncJobs.set(id, job);
    void (0, exports.syncScormNames)(selectedNames, (updated, total) => { job.updated = updated; job.total = total; })
        .then(() => { job.status = 'completed'; job.completedAt = Date.now(); })
        .catch((error) => { job.status = 'failed'; job.error = error?.message || 'Đồng bộ thất bại'; job.completedAt = Date.now(); });
    return job;
};
exports.startScormNameSync = startScormNameSync;
const getScormNameSyncJob = (id) => {
    const job = syncJobs.get(id);
    if (!job)
        throw new Error('Không tìm thấy tiến trình đồng bộ');
    return job;
};
exports.getScormNameSyncJob = getScormNameSyncJob;
const mappingKey = (packageId, courseId) => `${String(packageId)}\u0000${String(courseId)}`;
const previewScormCourseMappingSync = async (programCodeInput, selectedNames) => {
    const programCode = normalize(programCodeInput);
    if (!programCode)
        throw new Error('Vui lòng chọn Chương trình');
    const workbook = await getWorkbook();
    const available = workbookSheets(workbook)
        .filter((sheet) => normalize(sheet.name).toLocaleLowerCase('vi-VN') !== 'gv');
    const selected = selectedNames.length
        ? available.filter((sheet) => selectedNames.includes(sheet.name))
        : available;
    if (!selected.length)
        throw new Error('Không tìm thấy trang tính được chọn');
    const warnings = [];
    const sourceRows = parseProgramRows(selected, warnings);
    const lessons = await prisma_1.default.lessons.findMany({
        where: { subject_code: programCode, status: { not: 0 } },
        select: { id: true, learn_number: true, lesson_name: true },
        orderBy: [{ learn_number: 'asc' }, { id: 'asc' }],
    });
    if (!lessons.length)
        throw new Error(`Chương trình ${programCode} chưa có bài học`);
    const normalizedSourceRows = sourceRows.map((row) => ({
        row,
        normalizedTitle: (0, hmo_lesson_sync_service_1.normalizeTitle)(row.lessonName),
    })).filter((item) => Boolean(item.normalizedTitle));
    const current = await prisma_1.default.lesson_course_mapping.findMany({
        where: { lesson_id: { in: lessons.map((lesson) => lesson.id) } },
        select: { lesson_id: true, package_id: true, course_id: true },
    });
    const currentByLesson = new Map();
    current.forEach((item) => {
        const key = String(item.lesson_id);
        currentByLesson.set(key, [...(currentByLesson.get(key) || []), {
                packageId: item.package_id,
                courseId: item.course_id,
            }]);
    });
    const coursePackageCache = new Map();
    const rows = [];
    let unmatchedLessons = 0;
    for (const lesson of lessons) {
        const lessonTitle = (0, hmo_lesson_sync_service_1.normalizeTitle)(lesson.lesson_name);
        const evaluated = normalizedSourceRows
            .filter((item) => (0, hmo_lesson_sync_service_1.compatibleParts)(lessonTitle, item.normalizedTitle))
            .map((item) => ({ ...item, score: (0, hmo_lesson_sync_service_1.titleSimilarity)(lessonTitle, item.normalizedTitle) }))
            .filter((item) => item.score >= 0.92)
            .sort((left, right) => right.score - left.score);
        const best = evaluated[0];
        // Nhiều dòng cùng tên là hợp lệ (thường là nhiều GV/Course). Chỉ coi là
        // mơ hồ khi hai tên lõi khác nhau có điểm gần như nhau.
        const competing = best && lessonTitle !== best.normalizedTitle && evaluated.find((item) => (item.normalizedTitle !== best.normalizedTitle
            && best.score - item.score < 0.05));
        if (best && competing) {
            warnings.push({
                sheetName: best.row.sheetName,
                rowNumber: best.row.rowNumber,
                message: `Bài ${lesson.learn_number}: tên “${lesson.lesson_name}” khớp gần với nhiều tên trên sheet; cần kiểm tra thủ công`,
            });
            unmatchedLessons += 1;
            continue;
        }
        const matches = best
            ? evaluated.filter((item) => item.normalizedTitle === best.normalizedTitle).map((item) => item.row)
            : [];
        if (!matches.length) {
            unmatchedLessons += 1;
            continue;
        }
        const courseIds = Array.from(new Set(matches.flatMap((row) => row.courseIds.map(String))));
        const sheetMappings = [];
        let mappingResolutionFailed = false;
        for (const courseId of courseIds) {
            try {
                let packageRows = coursePackageCache.get(courseId);
                if (!packageRows) {
                    packageRows = await (0, package_course_sheet_service_1.resolvePackagesByCourseId)(courseId);
                    coursePackageCache.set(courseId, packageRows);
                }
                packageRows.forEach((item) => sheetMappings.push({
                    packageId: item.package_id,
                    courseId: item.course_id,
                }));
            }
            catch (error) {
                mappingResolutionFailed = true;
                warnings.push({
                    sheetName: matches[0].sheetName,
                    rowNumber: matches[0].rowNumber,
                    message: `Bài ${lesson.learn_number} / Course ${courseId}: ${error?.message || 'Không tìm thấy Package ID tương ứng'}`,
                });
            }
        }
        // Không dùng một tập Sheet bị thiếu do lỗi tra Package làm nguồn chuẩn để
        // xóa dữ liệu hiện tại. Người dùng có thể chạy lại sau khi nguồn hoạt động.
        if (mappingResolutionFailed) {
            unmatchedLessons += 1;
            continue;
        }
        const uniqueSheetMappings = Array.from(new Map(sheetMappings.map((item) => [mappingKey(item.packageId, item.courseId), item])).values());
        const currentMappings = currentByLesson.get(String(lesson.id)) || [];
        const currentKeys = new Set(currentMappings.map((item) => mappingKey(item.packageId, item.courseId)));
        const sheetKeys = new Set(uniqueSheetMappings.map((item) => mappingKey(item.packageId, item.courseId)));
        rows.push({
            lessonId: String(lesson.id),
            learnNumber: lesson.learn_number,
            lessonName: lesson.lesson_name,
            sheetNames: Array.from(new Set(matches.map((row) => row.sheetName))),
            currentMappings,
            sheetMappings: uniqueSheetMappings,
            additions: uniqueSheetMappings.filter((item) => !currentKeys.has(mappingKey(item.packageId, item.courseId))),
            removals: currentMappings.filter((item) => !sheetKeys.has(mappingKey(item.packageId, item.courseId))),
        });
    }
    return {
        programCode,
        sheetsProcessed: selected.length,
        lessonsTotal: lessons.length,
        matchedLessons: rows.length,
        unmatchedLessons,
        updatesNeeded: rows.reduce((total, row) => total + row.additions.length + row.removals.length, 0),
        rows,
        warnings,
    };
};
exports.previewScormCourseMappingSync = previewScormCourseMappingSync;
const applyScormCourseMappingSync = async (programCode, selectedNames) => {
    const preview = await (0, exports.previewScormCourseMappingSync)(programCode, selectedNames);
    const result = await prisma_1.default.$transaction(async (tx) => {
        let added = 0;
        let removed = 0;
        for (const row of preview.rows) {
            if (row.removals.length) {
                const deleted = await tx.lesson_course_mapping.deleteMany({
                    where: {
                        lesson_id: BigInt(row.lessonId),
                        OR: row.removals.map((mapping) => ({
                            package_id: mapping.packageId,
                            course_id: mapping.courseId,
                        })),
                    },
                });
                removed += deleted.count;
            }
            if (row.additions.length) {
                const created = await tx.lesson_course_mapping.createMany({
                    data: row.additions.map((mapping) => ({
                        lesson_id: BigInt(row.lessonId),
                        package_id: mapping.packageId,
                        course_id: mapping.courseId,
                    })),
                    skipDuplicates: true,
                });
                added += created.count;
            }
        }
        return { added, removed };
    }, { maxWait: 10_000, timeout: 120_000 });
    return { ...preview, ...result };
};
exports.applyScormCourseMappingSync = applyScormCourseMappingSync;
