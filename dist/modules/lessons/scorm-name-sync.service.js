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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScormNameSyncJob = exports.startScormNameSync = exports.syncScormNames = exports.toScormNamePayload = exports.previewScormNameSync = exports.getScormNameSyncSheets = void 0;
const XLSX = __importStar(require("xlsx"));
const logger_1 = require("../../utils/logger");
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
    const batchSize = Math.min(500, Math.max(1, Number(process.env.SYNC_SCORM_BATCH_SIZE) || 200));
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
