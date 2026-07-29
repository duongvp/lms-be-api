import ApiError from '../utils/ApiError';

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1m_KNVZc5PMu-UQi2PCrEGuXAfVM0NPGEghRbEYnJeH0/edit?usp=sharing';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export type PackageCourseSheetRow = {
  package_id: string;
  course_id: string;
  product_name?: string;
  course_name?: string;
};

type SheetCache = {
  expiresAt: number;
  rowsByCourseId: Map<string, PackageCourseSheetRow[]>;
};

let cache: SheetCache | null = null;
let refreshPromise: Promise<Map<string, PackageCourseSheetRow[]>> | null = null;

const normalizeHeader = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const PACKAGE_HEADER_ALIASES = new Set([
  'packageid',
  'idpackage',
  'package',
  'magoihoc',
  'magoi',
  'goiid',
]);

const COURSE_HEADER_ALIASES = new Set([
  'courseid',
  'idcourse',
  'course',
  'makhoahoc',
  'khoahocid',
]);

const parseCsv = (content: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const toCsvExportUrl = (sourceUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new ApiError('PACKAGE_COURSE_SHEET_URL không hợp lệ', 500);
  }

  const spreadsheetId = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!spreadsheetId) {
    throw new ApiError('Không xác định được spreadsheet ID từ PACKAGE_COURSE_SHEET_URL', 500);
  }

  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const gid = parsed.searchParams.get('gid') || hashParams.get('gid') || '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
};

const getCacheTtl = () => {
  const configured = Number(process.env.PACKAGE_COURSE_SHEET_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_CACHE_TTL_MS;
};

const downloadRows = async () => {
  const sourceUrl = process.env.PACKAGE_COURSE_SHEET_URL || DEFAULT_SHEET_URL;
  const response = await fetch(toCsvExportUrl(sourceUrl), {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'text/csv' },
  });

  if (!response.ok) {
    throw new ApiError(
      response.status === 401 || response.status === 403
        ? 'Google Sheet package-course chưa được cấp quyền Viewer cho backend'
        : `Không thể đọc Google Sheet package-course (HTTP ${response.status})`,
      503 
    );
  }

  const content = await response.text();
  if (/^\s*<!doctype html/i.test(content)) {
    throw new ApiError('Google Sheet trả về trang đăng nhập thay vì dữ liệu CSV', 503);
  }

  const csvRows = parseCsv(content);
  if (csvRows.length < 2) {
    throw new ApiError('Google Sheet package-course không có dữ liệu', 503);
  }

  const headers = csvRows[0].map(normalizeHeader);
  const packageIndex = headers.findIndex((header) => PACKAGE_HEADER_ALIASES.has(header));
  const courseIndex = headers.findIndex((header) => COURSE_HEADER_ALIASES.has(header));
  const productNameIndex = headers.findIndex((header) => header === 'productname');
  const courseNameIndex = headers.findIndex((header) => header === 'coursename');
  if (packageIndex < 0 || courseIndex < 0) {
    throw new ApiError(
      `Google Sheet cần có cột package_id và course_id. Các cột hiện tại: ${csvRows[0].join(', ')}`,
      503
    );
  }

  const rowsByCourseId = new Map<string, PackageCourseSheetRow[]>();
  for (const row of csvRows.slice(1)) {
    const packageId = String(row[packageIndex] ?? '').trim();
    const courseId = String(row[courseIndex] ?? '').trim();
    const productName = productNameIndex >= 0
      ? String(row[productNameIndex] ?? '').trim()
      : '';
    const courseName = courseNameIndex >= 0
      ? String(row[courseNameIndex] ?? '').trim()
      : '';
    if (!packageId && !courseId) continue;
    if (!packageId || !courseId) {
      throw new ApiError('Google Sheet có dòng thiếu package_id hoặc course_id', 503);
    }
    if (packageId.length > 50 || courseId.length > 50) {
      throw new ApiError('package_id/course_id trong Google Sheet vượt quá 50 ký tự', 503);
    }

    const courseRows = rowsByCourseId.get(courseId) ?? [];
    if (!courseRows.some((item) => item.package_id === packageId)) {
      courseRows.push({
        package_id: packageId,
        course_id: courseId,
        product_name: productName || undefined,
        course_name: courseName || undefined,
      });
    }
    rowsByCourseId.set(courseId, courseRows);
  }

  if (rowsByCourseId.size === 0) {
    throw new ApiError('Google Sheet package-course không có dòng hợp lệ', 503);
  }
  return rowsByCourseId;
};

const getRowsByCourseId = async () => {
  if (cache && cache.expiresAt > Date.now()) return cache.rowsByCourseId;

  try {
    // Nhiều request mở modal cùng lúc chỉ tạo một kết nối tới Google Sheet.
    // Các request còn lại chờ chung promise thay vì tải trùng CSV.
    if (!refreshPromise) refreshPromise = downloadRows();
    const rowsByCourseId = await refreshPromise;
    cache = {
      rowsByCourseId,
      expiresAt: Date.now() + getCacheTtl(),
    };
    return rowsByCourseId;
  } catch (error) {
    // Nếu sheet tạm thời lỗi, tiếp tục dùng snapshot gần nhất thay vì làm gián
    // đoạn tạo lịch. Lần khởi động đầu tiên vẫn bắt buộc đọc sheet thành công.
    if (cache) return cache.rowsByCourseId;
    throw error;
  } finally {
    refreshPromise = null;
  }
};

export const resolvePackagesByCourseId = async (courseIdInput: unknown) => {
  const courseId = String(courseIdInput ?? '').trim();
  if (!courseId) throw new ApiError('Vui lòng cung cấp course_id', 400);
  if (courseId.length > 50) {
    throw new ApiError('course_id không được vượt quá 50 ký tự', 400);
  }

  const rows = (await getRowsByCourseId()).get(courseId);
  if (!rows?.length) {
    throw new ApiError(`Course ID ${courseId} không tồn tại trong Google Sheet`, 400);
  }
  return rows;
};

export const listPackageCoursesFromSheet = async () => (
  Array.from((await getRowsByCourseId()).values())
    .flat()
    .sort((left, right) => (
      left.course_id.localeCompare(right.course_id, undefined, { numeric: true })
      || left.package_id.localeCompare(right.package_id, undefined, { numeric: true })
    ))
);

export const clearPackageCourseSheetCache = () => {
  cache = null;
  refreshPromise = null;
};
