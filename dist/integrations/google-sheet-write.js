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
exports.writeCalendarWorkbookToSheet = exports.replacementSheetRequests = exports.validateSheetExport = exports.readSheetMetadata = exports.splitSheetRequests = exports.calendarSheetFormatting = exports.calendarSessionEnded = exports.workbookRequests = exports.normalizeSheetPrivateKey = exports.spreadsheetIdFromUrl = exports.DEFAULT_TOPUNI_SHEET_URL = exports.DEFAULT_CALENDAR_SHEET_URL = void 0;
const node_crypto_1 = require("node:crypto");
const googleapis_1 = require("googleapis");
const XLSX = __importStar(require("xlsx"));
exports.DEFAULT_CALENDAR_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1NTrAeL-tEykqqm9R_kQxHVBS-xaGNgarsQ9xP-HM774/edit';
exports.DEFAULT_TOPUNI_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1DejptU8MU5Zvey_6Z5jtFHlwjGIgKpe3Woqq01IjJrw/edit';
const spreadsheetIdFromUrl = (value) => {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Link Google Sheets không hợp lệ.');
    }
    const id = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !id) {
        throw new Error('Link Google Sheets không hợp lệ.');
    }
    return id;
};
exports.spreadsheetIdFromUrl = spreadsheetIdFromUrl;
let cachedAuth;
const normalizeSheetPrivateKey = (value) => value.trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
exports.normalizeSheetPrivateKey = normalizeSheetPrivateKey;
const sheetsClient = () => {
    const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL?.trim();
    const key = (0, exports.normalizeSheetPrivateKey)(process.env.GOOGLE_SHEETS_PRIVATE_KEY || '');
    if (!email || !key)
        throw new Error('Chưa cấu hình tài khoản Google Sheets trên backend. Cần GOOGLE_SHEETS_CLIENT_EMAIL và GOOGLE_SHEETS_PRIVATE_KEY.');
    if (!cachedAuth || cachedAuth.email !== email || cachedAuth.key !== key) {
        try {
            if ((0, node_crypto_1.createPrivateKey)(key).asymmetricKeyType !== 'rsa')
                throw new Error('Not RSA');
        }
        catch {
            throw new Error('GOOGLE_SHEETS_PRIVATE_KEY không phải khóa RSA hợp lệ. Hãy sao chép nguyên trường private_key từ file JSON của Service Account, gồm BEGIN/END PRIVATE KEY.');
        }
        cachedAuth = new googleapis_1.google.auth.JWT({
            email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    }
    return googleapis_1.google.sheets({ version: 'v4', auth: cachedAuth });
};
// Keep the same matrix and cell types as the Excel export.
const workbookRequests = (buffer, suffix) => {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const used = new Set();
    return workbook.SheetNames.flatMap((name) => {
        let sheetId;
        do {
            sheetId = (0, node_crypto_1.randomInt)(1, 2_000_000_000);
        } while (used.has(sheetId));
        used.add(sheetId);
        const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
        const columnCount = Math.max(1, ...matrix.map((row) => row.length));
        const title = `${name.slice(0, 100 - suffix.length - 1)} ${suffix}`;
        return [
            { addSheet: { properties: { sheetId, title, gridProperties: { rowCount: Math.max(1, matrix.length), columnCount, frozenRowCount: matrix.length ? 1 : 0 } } } },
            { updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue', rows: matrix.map((row) => ({ values: row.map((value) => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value ?? '') } })) })) } },
        ];
    });
};
exports.workbookRequests = workbookRequests;
const MAX_BATCH_BYTES = 500_000;
const READ_TIMEOUT_MS = 60_000;
const WRITE_TIMEOUT_MS = 210_000;
const calendarSessionEnded = (date, timeRange, now) => {
    const day = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const times = [...timeRange.matchAll(/(\d{2}):(\d{2})/g)];
    if (!day || times.length !== 2)
        return false;
    const [, d, m, y] = day.map(Number);
    const startMinutes = Number(times[0][1]) * 60 + Number(times[0][2]);
    const endMinutes = Number(times[1][1]) * 60 + Number(times[1][2]);
    if (times.some((time) => Number(time[1]) > 23 || Number(time[2]) > 59))
        return false;
    const midnight = Date.UTC(y, m - 1, d);
    const check = new Date(midnight);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
        return false;
    const end = midnight - 7 * 3600_000 + endMinutes * 60_000 + (endMinutes < startMinutes ? 86400_000 : 0);
    return end <= now.getTime();
};
exports.calendarSessionEnded = calendarSessionEnded;
const calendarSheetFormatting = (requests, now = new Date()) => {
    const color = (hex) => ({ red: parseInt(hex.slice(0, 2), 16) / 255, green: parseInt(hex.slice(2, 4), 16) / 255, blue: parseInt(hex.slice(4, 6), 16) / 255 });
    const result = [];
    for (const request of requests) {
        if (!request.updateCells?.rows?.length)
            continue;
        const update = request.updateCells;
        const sheetId = update.start.sheetId;
        const rows = update.rows;
        const headers = rows[0].values.map((cell) => String(cell.userEnteredValue?.stringValue || ''));
        const range = { sheetId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: headers.length };
        result.push({ repeatCell: { range, cell: { userEnteredFormat: { backgroundColor: color('FFFFFF'), textFormat: { fontFamily: 'Arial', fontSize: 10, foregroundColor: color('000000') }, verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } }, fields: 'userEnteredFormat' } }, { repeatCell: { range: { ...range, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: color('0C343D'), textFormat: { bold: true, foregroundColor: color('FFFFFF') }, wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.wrapStrategy' } }, { updateBorders: { range, top: { style: 'SOLID', color: color('00B050') }, bottom: { style: 'SOLID', color: color('00B050') }, left: { style: 'SOLID', color: color('00B050') }, right: { style: 'SOLID', color: color('00B050') }, innerHorizontal: { style: 'SOLID', color: color('00B050') }, innerVertical: { style: 'SOLID', color: color('00B050') } } }, { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: 'pixelSize' } }, { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: Math.min(3, headers.length) } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
        headers.forEach((header, index) => {
            const width = header === 'Tên bài giảng' ? 330 : ['Tên GV', 'Trợ giảng'].includes(header) ? 150 : header === 'Môn' ? 80 : header === 'Thứ' ? 55 : header.includes('Tài liệu') || header === 'Nhiệm vụ học tập' ? 120 : 110;
            result.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: index, endIndex: index + 1 }, properties: { pixelSize: width }, fields: 'pixelSize' } });
            if (header.startsWith('Tài liệu live') || header === 'Nhiệm vụ học tập')
                result.push({ repeatCell: { range: { ...range, endRowIndex: 1, startColumnIndex: index, endColumnIndex: index + 1 }, cell: { userEnteredFormat: { backgroundColor: color('741B47') } }, fields: 'userEnteredFormat.backgroundColor' } });
        });
        const dateColumn = headers.indexOf('Ngày live');
        const timeColumn = headers.indexOf('Khung giờ');
        const subjectColumn = headers.indexOf('Môn');
        let runStart = -1;
        const flush = (endRowIndex) => {
            if (runStart < 0)
                return;
            result.push({ repeatCell: { range: { ...range, startRowIndex: runStart, endRowIndex }, cell: { userEnteredFormat: { backgroundColor: color('B7E1CD') } }, fields: 'userEnteredFormat.backgroundColor' } });
            runStart = -1;
        };
        for (let i = 1; i < rows.length; i++) {
            const values = rows[i].values || [];
            const ended = dateColumn >= 0 && timeColumn >= 0 && (0, exports.calendarSessionEnded)(String(values[dateColumn]?.userEnteredValue?.stringValue || ''), String(values[timeColumn]?.userEnteredValue?.stringValue || ''), now);
            if (ended && runStart < 0)
                runStart = i;
            if (!ended)
                flush(i);
        }
        flush(rows.length);
        // Nghỉ học: màu chữ đỏ trên toàn dòng, giữ nền xanh nếu đã qua ngày.
        let canceledStart = -1;
        const flushCanceled = (endRowIndex) => {
            if (canceledStart < 0)
                return;
            result.push({ repeatCell: { range: { ...range, startRowIndex: canceledStart, endRowIndex }, cell: { userEnteredFormat: { textFormat: { foregroundColor: color('FF0000'), bold: true, italic: true } } }, fields: 'userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.italic' } });
            canceledStart = -1;
        };
        for (let i = 1; i < rows.length; i++) {
            const canceled = subjectColumn >= 0 && rows[i].values?.[subjectColumn]?.userEnteredValue?.stringValue === 'Nghỉ';
            if (canceled && canceledStart < 0)
                canceledStart = i;
            if (!canceled)
                flushCanceled(i);
        }
        flushCanceled(rows.length);
    }
    return result;
};
exports.calendarSheetFormatting = calendarSheetFormatting;
const requestBytes = (request) => Buffer.byteLength(JSON.stringify(request));
// Measure UTF-8 bytes, including JSON overhead, rather than relying on row counts.
const splitSheetRequests = (requests, maxBytes = MAX_BATCH_BYTES) => {
    const fragments = [];
    for (const request of requests) {
        if (!request.updateCells || requestBytes(request) + 32 <= maxBytes) {
            fragments.push(request);
            continue;
        }
        const update = request.updateCells;
        const base = update.start;
        let rows = [];
        let startRow = base.rowIndex || 0;
        let size = 1024;
        const flush = () => {
            if (rows.length)
                fragments.push({ updateCells: { ...update, start: { ...base, rowIndex: startRow }, rows } });
            startRow += rows.length;
            rows = [];
            size = 1024;
        };
        for (const row of update.rows || []) {
            const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
            if (size + rowBytes > maxBytes)
                flush();
            if (rowBytes + 1024 > maxBytes) {
                let values = [];
                let columnIndex = base.columnIndex || 0;
                let cellSize = 1024;
                const flushCells = () => {
                    if (values.length)
                        fragments.push({ updateCells: { ...update, start: { ...base, rowIndex: startRow, columnIndex }, rows: [{ values }] } });
                    columnIndex += values.length;
                    values = [];
                    cellSize = 1024;
                };
                for (const cell of row.values || []) {
                    const bytes = Buffer.byteLength(JSON.stringify(cell)) + 1;
                    if (bytes + 1024 > maxBytes)
                        throw new Error('Một ô dữ liệu vượt kích thước Google Sheets có thể nhận. Hãy kiểm tra nội dung ô.');
                    if (cellSize + bytes > maxBytes)
                        flushCells();
                    values.push(cell);
                    cellSize += bytes;
                }
                flushCells();
                startRow += 1;
            }
            else {
                rows.push(row);
                size += rowBytes;
            }
        }
        flush();
    }
    const batches = [];
    let batch = [];
    let bytes = 32;
    for (const request of fragments) {
        const size = requestBytes(request) + 1;
        if (size + 32 > maxBytes)
            throw new Error('Một yêu cầu Google Sheets vượt kích thước cho phép.');
        if (bytes + size > maxBytes || batch.length >= 100) {
            batches.push(batch);
            batch = [];
            bytes = 32;
        }
        batch.push(request);
        bytes += size;
    }
    if (batch.length)
        batches.push(batch);
    return batches;
};
exports.splitSheetRequests = splitSheetRequests;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let writeQueue = Promise.resolve();
let nextWriteAt = 0;
const pacedWrite = (task) => {
    const pending = writeQueue.then(async () => {
        await pause(Math.max(0, nextWriteAt - Date.now()));
        nextWriteAt = Date.now() + 1100;
        return task();
    });
    writeQueue = pending.catch(() => undefined);
    return pending;
};
const errorStatus = (error) => {
    const failure = error;
    const status = failure.response?.status || Number(failure.code);
    return status >= 100 && status <= 599 ? status : 0;
};
// Metadata reads are safe to retry, including AbortError (DOM code 20).
const readSheetMetadata = async (sheets, spreadsheetId) => {
    for (let attempt = 0;; attempt++) {
        try {
            return await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title,hidden))' }, { timeout: READ_TIMEOUT_MS, retry: false });
        }
        catch (error) {
            const status = errorStatus(error);
            if ((status && status !== 408 && status !== 429 && status < 500) || attempt >= 3) {
                if (status === 403 || status === 404)
                    throw new Error('Không thể truy cập sheet. Kiểm tra quyền Chỉnh sửa của tài khoản dịch vụ.');
                throw new Error(failureMessage(error) || 'Google Sheets chưa phản hồi khi đọc danh sách tab sau nhiều lần thử. Vui lòng thử lại sau.');
            }
            await pause(1000 * 2 ** attempt);
        }
    }
};
exports.readSheetMetadata = readSheetMetadata;
const failureMessage = (error) => {
    const failure = error;
    const reason = failure.response?.data?.error;
    if (reason === 'invalid_grant' || reason === 'invalid_client')
        return 'Google không chấp nhận tài khoản dịch vụ. Kiểm tra khóa JSON còn hiệu lực và client_email khớp với private_key trong cùng file.';
    const code = failure.cause?.code || failure.code;
    if (code === 'ERR_OSSL_UNSUPPORTED' || (typeof code === 'string' && code.startsWith('ERR_OSSL_PEM')))
        return 'Không thể đọc GOOGLE_SHEETS_PRIVATE_KEY. Kiểm tra định dạng khóa trong cấu hình backend.';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        return 'Backend không phân giải được địa chỉ Google. Kiểm tra DNS và kết nối mạng của máy chủ.';
    if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN')
        return 'Backend không xác minh được chứng chỉ HTTPS của Google. Kiểm tra chứng chỉ và proxy của máy chủ.';
    return undefined;
};
const validateSheetExport = (sheetUrl) => {
    (0, exports.spreadsheetIdFromUrl)(sheetUrl);
    sheetsClient();
};
exports.validateSheetExport = validateSheetExport;
const replacementSheetRequests = (additions, existing, suffix, finalNames) => {
    const newIds = new Set(additions.map((request) => request.addSheet.properties.sheetId));
    const old = existing.filter((sheet) => !newIds.has(sheet.properties?.sheetId));
    return [
        ...additions.map((request) => ({ updateSheetProperties: { properties: { sheetId: request.addSheet.properties.sheetId, hidden: false }, fields: 'hidden' } })),
        ...old.map((sheet) => ({ deleteSheet: { sheetId: sheet.properties.sheetId } })),
        ...additions.map((request) => ({ updateSheetProperties: { properties: { sheetId: request.addSheet.properties.sheetId, title: finalNames?.get(request.addSheet.properties.sheetId) || request.addSheet.properties.title.slice(0, -suffix.length - 1) }, fields: 'title' } })),
    ];
};
exports.replacementSheetRequests = replacementSheetRequests;
const writeCalendarWorkbookToSheet = async (buffer, sheetUrl, onProgress, tabTitles) => {
    const spreadsheetId = (0, exports.spreadsheetIdFromUrl)(sheetUrl);
    const suffix = `LMS ${new Date().toISOString().replace(/[:.]/g, '-')}-${(0, node_crypto_1.randomInt)(1000, 9999)}`;
    const requests = (0, exports.workbookRequests)(buffer, suffix);
    const sheets = sheetsClient();
    onProgress?.(0, 'Đang kết nối Google Sheets và đọc danh sách tab…');
    const existing = await (0, exports.readSheetMetadata)(sheets, spreadsheetId);
    const additions = requests.filter((request) => request.addSheet).map((request) => ({
        addSheet: { properties: { ...request.addSheet.properties, hidden: true } },
    }));
    const finalNames = new Map(additions.map((request, index) => [request.addSheet.properties.sheetId, tabTitles?.[index] || request.addSheet.properties.title.slice(0, -suffix.length - 1)]));
    const creationBatches = (0, exports.splitSheetRequests)(additions);
    const dataBatches = (0, exports.splitSheetRequests)(requests.filter((request) => request.updateCells));
    const formattingBatches = (0, exports.splitSheetRequests)((0, exports.calendarSheetFormatting)(requests));
    const replacement = (0, exports.replacementSheetRequests)(additions, existing.data.sheets || [], suffix, finalNames);
    // Delete old tabs and rename new ones together; retain old data while uploading.
    if (Buffer.byteLength(JSON.stringify({ requests: replacement })) > MAX_BATCH_BYTES)
        throw new Error('Số tab quá lớn để thay thế trong một lần.');
    const attempted = new Map();
    let committed = 0;
    const total = creationBatches.length + dataBatches.length + formattingBatches.length + 1;
    const send = async (batch, safeToRetry) => {
        for (let attempt = 0;; attempt++) {
            try {
                await pacedWrite(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: batch } }, { timeout: WRITE_TIMEOUT_MS, retry: false }));
                break;
            }
            catch (error) {
                const status = errorStatus(error);
                if (batch.every((request) => request.addSheet) && (!status || status === 408 || status >= 500 || status === 400)) {
                    const current = await (0, exports.readSheetMetadata)(sheets, spreadsheetId);
                    if (batch.every((request) => current.data.sheets?.some((sheet) => sheet.properties?.sheetId === request.addSheet.properties.sheetId && sheet.properties?.title === request.addSheet.properties.title)))
                        break;
                    // Stable IDs make retry safe: a delayed first request cannot create
                    // another copy; a subsequent "already exists" is reconciled above.
                    if (status !== 400 && attempt < 5) {
                        await pause(1000 * 2 ** attempt);
                        continue;
                    }
                }
                const transient = status === 429 || (safeToRetry && (!status || status === 408 || status >= 500));
                if (!transient || attempt >= 5)
                    throw error;
                onProgress?.(Math.round(committed / total * 95), 'Google Sheets đang bận, hệ thống đang tự thử lại…');
                await pause(Math.min(32_000, 1000 * 2 ** attempt) + (0, node_crypto_1.randomInt)(0, 1000));
            }
        }
        committed++;
        onProgress?.(Math.round(committed / total * 95), `Đang ghi dữ liệu lên Google Sheets (${committed}/${total} đợt)…`);
    };
    try {
        for (const batch of creationBatches) {
            for (const request of batch)
                attempted.set(request.addSheet.properties.sheetId, request.addSheet.properties.title);
            await send(batch, false);
        }
        for (const batch of dataBatches)
            await send(batch, true);
        for (const batch of formattingBatches)
            await send(batch, true);
        try {
            await send(replacement, false);
        }
        catch (error) {
            // A timeout may occur after Google committed the replacement. Never remove
            // successfully renamed tabs or replay deletion after an uncertain response.
            const current = await (0, exports.readSheetMetadata)(sheets, spreadsheetId);
            const complete = additions.every((request) => current.data.sheets?.some((sheet) => sheet.properties?.sheetId === request.addSheet.properties.sheetId &&
                sheet.properties?.title === finalNames.get(request.addSheet.properties.sheetId) && !sheet.properties?.hidden));
            if (!complete)
                throw error;
        }
    }
    catch (error) {
        let cleanupFailed = false;
        if (attempted.size) {
            try {
                const existing = await (0, exports.readSheetMetadata)(sheets, spreadsheetId);
                const deletions = (existing.data.sheets || []).filter((sheet) => attempted.has(sheet.properties?.sheetId) && attempted.get(sheet.properties?.sheetId) === sheet.properties?.title)
                    .map((sheet) => ({ deleteSheet: { sheetId: sheet.properties.sheetId } }));
                for (const batch of (0, exports.splitSheetRequests)(deletions))
                    await pacedWrite(() => sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: batch } }, { timeout: WRITE_TIMEOUT_MS, retry: false }));
            }
            catch {
                cleanupFailed = true;
            }
        }
        const status = errorStatus(error);
        const specificMessage = failureMessage(error);
        if (specificMessage)
            throw new Error(specificMessage);
        if (status === 403 || status === 404)
            throw new Error(`Không thể ghi vào sheet. Hãy bật Google Sheets API và chia sẻ quyền Chỉnh sửa cho ${process.env.GOOGLE_SHEETS_CLIENT_EMAIL}.`);
        if (status === 401 || status === 400)
            throw new Error('Google Sheets từ chối yêu cầu. Kiểm tra cấu hình tài khoản dịch vụ và dữ liệu xuất.');
        throw new Error(cleanupFailed ? 'Kết nối Google Sheets bị gián đoạn. Hãy kiểm tra các tab của lần xuất này trước khi xuất lại.' : 'Kết nối Google Sheets bị gián đoạn. Các tab tạo dở đã được dọn; bạn có thể bấm xuất lại.');
    }
    onProgress?.(100, 'Đã xuất toàn bộ chương trình vào Google Sheets.');
    return { sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, sheetCount: additions.length };
};
exports.writeCalendarWorkbookToSheet = writeCalendarWorkbookToSheet;
