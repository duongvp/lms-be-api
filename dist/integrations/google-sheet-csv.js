"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicGoogleSheetCsv = exports.buildPublicGoogleSheetCsvUrls = void 0;
const GOOGLE_SHEETS_HOST = 'docs.google.com';
const getSheetGid = (url) => {
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const gid = url.searchParams.get('gid') || hashParams.get('gid') || '0';
    return /^\d+$/.test(gid) ? gid : '0';
};
const buildPublicGoogleSheetCsvUrls = (sheetUrl) => {
    let parsed;
    try {
        parsed = new URL(sheetUrl);
    }
    catch {
        throw new Error('Link Google Sheets không hợp lệ');
    }
    if (parsed.hostname.toLowerCase() !== GOOGLE_SHEETS_HOST) {
        throw new Error('Chỉ hỗ trợ link Google Sheets từ docs.google.com');
    }
    const gid = getSheetGid(parsed);
    const publishedMatch = parsed.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)/);
    if (publishedMatch) {
        return [
            `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/e/${publishedMatch[1]}/pub?output=csv&single=true&gid=${encodeURIComponent(gid)}`,
        ];
    }
    const sheetMatch = parsed.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    if (!sheetMatch)
        throw new Error('Link Google Sheets không hợp lệ');
    const spreadsheetId = sheetMatch[1];
    return [
        `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`,
        `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out%3Acsv&gid=${encodeURIComponent(gid)}`,
    ];
};
exports.buildPublicGoogleSheetCsvUrls = buildPublicGoogleSheetCsvUrls;
const looksLikeHtml = (contentType, buffer) => {
    if (contentType.toLowerCase().includes('text/html'))
        return true;
    return buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase().startsWith('<!doctype html')
        || buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase().startsWith('<html');
};
const getPublicGoogleSheetCsv = async (sheetUrl) => {
    const candidateUrls = (0, exports.buildPublicGoogleSheetCsvUrls)(sheetUrl);
    const statuses = [];
    let networkError;
    for (const url of candidateUrls) {
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(20_000),
                headers: { 'User-Agent': 'LMS-Calendar-Importer/1.0' },
            });
            statuses.push(response.status);
            if (!response.ok)
                continue;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length || looksLikeHtml(response.headers.get('content-type') || '', buffer)) {
                continue;
            }
            return buffer;
        }
        catch (error) {
            networkError = error;
        }
    }
    if (statuses.some((status) => status === 401 || status === 403)) {
        throw new Error('Google Sheets từ chối truy cập. Hãy đặt quyền “Bất kỳ ai có đường liên kết” thành “Người xem”.');
    }
    if (statuses.some((status) => status === 404)) {
        throw new Error('Không tìm thấy Google Sheets hoặc tab đã chọn. Hãy kiểm tra lại link và gid của tab.');
    }
    if (networkError && statuses.length === 0) {
        const isTimeout = networkError instanceof Error
            && (networkError.name === 'TimeoutError' || networkError.name === 'AbortError');
        throw new Error(isTimeout
            ? 'Google Sheets phản hồi quá thời gian. Vui lòng thử lại.'
            : 'Backend không thể kết nối tới Google Sheets. Vui lòng thử lại sau.');
    }
    throw new Error(`Không thể xuất tab Google Sheets thành CSV${statuses.length ? ` (HTTP ${statuses.join('/')})` : ''}. `
        + 'Hãy kiểm tra link, tab đang chọn và quyền xem công khai.');
};
exports.getPublicGoogleSheetCsv = getPublicGoogleSheetCsv;
