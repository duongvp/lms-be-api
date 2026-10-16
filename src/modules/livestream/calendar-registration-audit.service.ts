import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import { registrationAuditDates, registrationsBeforeCutoff } from './calendar-registration-audit-date';
import { buildCalendarClassId } from './calendar-user-sync.service';
import { calendarStudentTimestamps } from './calendar-student-timestamp';
import {
  buildStudentDisplayName, loadRegistrationApiConfig, fetchRegistrationApiPage,
  normalizeRegistrationAuditDate, type HocmaiUser,
} from './calendar-student-sync.service';

const MAX_CALENDARS = 50;
const MAX_ROWS = 100_000;
const TTL = 30 * 60_000;
const text = (value: unknown) => String(value ?? '').trim();
const enrollmentKey = (row: {username: string; code: string; learn_number: number}) =>
  JSON.stringify([row.username.toLowerCase(), row.code.toLowerCase(), Number(row.learn_number)]);

type Target = { id: number; key: string; code: string; learn_number: number; start_time: Date; packages: string[] };
type EnrollmentRow = Prisma.usersCreateManyInput & {learn_number: number};
type MissingRow = { row: EnrollmentRow; packages: Set<string> };
type AuditJob = {
  id: string; owner: number; ids: number[]; date: string; targets: Target[];
  status: 'checking' | 'ready' | 'inserting' | 'completed' | 'failed';
  progress: number; message: string; error?: string; createdAt: number; finishedAt?: number;
  missing: MissingRow[];
  stats?: { apiRows: number; apiRowsSinceDate: number; excludedNewerRows: number; uniqueUsers: number; expectedEnrollments: number; existingEnrollments: number; missingEnrollments: number };
  summary: Array<{ code: string; learnNumber: number; expected: number; existing: number; missing: number }>;
  result?: { inserted: number; alreadyPresent: number; remaining: number };
};
const jobs = new Map<string, AuditJob>();

function cleanup() {
  for (const [id, job] of jobs) {
    if (job.status !== 'checking' && job.status !== 'inserting' && Date.now() - (job.finishedAt ?? job.createdAt) > TTL) jobs.delete(id);
  }
}

function assertScope(targets: Target[], allowed: string[] | null) {
  if (allowed !== null && targets.some(target => !allowed.includes(target.code))) {
    throw new ApiError('Không có quyền kiểm tra/bổ sung học viên của chương trình đã chọn', 403);
  }
}

async function loadTargets(ids: number[], client: any = prisma): Promise<Target[]> {
  const calendars = await client.calendar.findMany({
    where: {id: {in: ids}}, select: {id: true, key: true, code: true, learn_number: true, start_time: true},
  });
  if (calendars.length !== ids.length) throw new ApiError('Có lịch đã chọn không tồn tại; vui lòng tải lại danh sách', 404);
  if (calendars.some((row: any) => !row.key)) throw new ApiError('Có lịch chưa có key để lấy Package ID', 400);
  const mappings = await client.package_lesson_mapping.findMany({
    where: {key: {in: calendars.map((row: any) => row.key)}}, select: {key: true, package_id: true},
  });
  const classIds = new Map<string, string>();
  return calendars.map((calendar: any) => {
    const packages = [...new Set<string>(mappings.filter((row: any) => row.key === calendar.key).map((row: any) => text(row.package_id)))].sort();
    if (!packages.length || packages.some(id => !/^\d+$/.test(id))) {
      throw new ApiError(`${calendar.code} - Bài ${calendar.learn_number}: chưa có Package ID hợp lệ`, 400);
    }
    const key = JSON.stringify([calendar.code, calendar.learn_number]);
    const classId = buildCalendarClassId(calendar.code, calendar.start_time, calendar.learn_number);
    if (classIds.has(key) && classIds.get(key) !== classId) {
      throw new ApiError('Đang chọn nhiều lịch khác ngày cho cùng chương trình/buổi; hãy kiểm tra từng lịch để xác định đúng lớp bổ sung', 400);
    }
    classIds.set(key, classId);
    return {...calendar, key: String(calendar.key), packages};
  });
}

const fingerprint = (targets: Target[]) => JSON.stringify([...targets].sort((a, b) => a.id - b.id)
  .map(target => [target.id, target.key, target.code, target.learn_number, target.start_time.toISOString(), target.packages]));

async function readRegistrationsSince(job: AuditJob, date: string, progressStart: number): Promise<HocmaiUser[]> {
  const packages = [...new Set(job.targets.flatMap(target => target.packages))];
  const config = loadRegistrationApiConfig();
  const first = await fetchRegistrationApiPage(config, packages, date, 1);
  const total = Number(first.total);
  const perPage = Number(first.per_page || config.limit);
  const reportedLastPage = Number(first.last_page ?? 1);
  if (!Number.isSafeInteger(total) || total < 0 || total > MAX_ROWS
    || !Number.isSafeInteger(perPage) || perPage < 1
    || !Number.isSafeInteger(reportedLastPage) || reportedLastPage < 0) {
    throw new ApiError('API trả thông tin phân trang không hợp lệ hoặc vượt 100.000 dòng; hãy chọn ít lịch hơn', 502);
  }
  const pages = Math.max(1, reportedLastPage, Math.ceil(total / perPage));
  if (pages > 1000) throw new ApiError('API trả số trang quá lớn; hãy chọn ít lịch hơn', 502);
  const users: HocmaiUser[] = [];
  const append = (payload: any, page: number) => {
    if (payload.current_page !== undefined && Number(payload.current_page) !== page) throw new ApiError('API trả sai trang; không thể kết luận danh sách học viên đầy đủ', 502);
    users.push(...payload.data);
    if (users.length > MAX_ROWS) throw new ApiError('Danh sách API vượt giới hạn kiểm tra; hãy chọn ít lịch hơn', 502);
    job.progress = progressStart + Math.round(page / pages * 30);
    job.message = `Đang tải đăng ký từ ${date}: trang ${page}/${pages} (${users.length}/${total} dòng)`;
  };
  append(first, 1);
  for (let page = 2; page <= pages; page += 1) append(await fetchRegistrationApiPage(config, packages, date, page), page);
  if (users.length !== total) throw new ApiError(`API trả ${users.length}/${total} dòng; chưa đủ dữ liệu để đối chiếu`, 502);
  return users;
}

function prepareRows(users: HocmaiUser[], targets: Target[]): MissingRow[] {
  const byPackage = new Map<string, Target[]>();
  targets.forEach(target => target.packages.forEach(id => byPackage.set(id, [...(byPackage.get(id) || []), target])));
  const unique = new Map<string, MissingRow>();
  for (const user of users) {
    const packageId = text(user.product_id);
    const matches = byPackage.get(packageId);
    if (!matches?.length) throw new ApiError('API trả đăng ký không thuộc các Package ID đã chọn; không thể đối chiếu chính xác', 502);
    const username = text(user.username);
    const name = buildStudentDisplayName(user);
    if (!username || username.length > 100 || !text(user.userid) || text(user.userid).length > 50
      || !name.trim() || name.length > 150 || text(user.email).length > 100 || text(user.phone).length > 20) {
      throw new ApiError('API có học viên thiếu thông tin hoặc vượt độ dài cho phép; chưa bổ sung dữ liệu nào', 502);
    }
    for (const target of matches) {
      const row: EnrollmentRow = {
        username, student_hmid: text(user.userid), name, email: text(user.email), phone: text(user.phone),
        code: target.code, learn_number: target.learn_number,
        islearn: 0, room_id: 1, class_id: buildCalendarClassId(target.code, target.start_time, target.learn_number),
      };
      const key = enrollmentKey(row);
      const previous = unique.get(key);
      if (previous && previous.row.student_hmid !== row.student_hmid) throw new ApiError('API có cùng username nhưng khác user ID; cần kiểm tra trước khi bổ sung', 502);
      if (previous) previous.packages.add(packageId);
      else unique.set(key, {row, packages: new Set([packageId])});
      if (unique.size > MAX_ROWS) throw new ApiError('Số enrollment vượt 100.000; hãy chọn ít lịch hơn', 400);
    }
  }
  return [...unique.values()];
}

async function missingRows(rows: MissingRow[], client: any = prisma): Promise<MissingRow[]> {
  const existing = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const inputs = rows.slice(offset, offset + 200).map(({row}) => Prisma.sql`SELECT ${row.username} AS username, ${row.code} AS code, ${row.learn_number} AS learn_number`);
    // Let MySQL apply the actual users column collation, then return the input
    // spelling so case/accent-equivalent usernames are not falsely missing.
    const found = await client.$queryRaw(Prisma.sql`
      SELECT DISTINCT requested.username, requested.code, requested.learn_number
      FROM (${Prisma.join(inputs, ' UNION ALL ')}) AS requested
      INNER JOIN users u ON u.username = requested.username
        AND u.code = requested.code AND u.learn_number = requested.learn_number
    `);
    found.forEach((row: any) => existing.add(enrollmentKey(row)));
  }
  return rows.filter(({row}) => !existing.has(enrollmentKey(row)));
}

async function check(job: AuditJob) {
  try {
    const dates = registrationAuditDates();
    if (job.date !== dates.yesterday) throw new ApiError('Chỉ kiểm tra đăng ký của ngày hôm qua theo giờ Việt Nam; hãy mở lại chức năng', 400);
    const sinceDate = await readRegistrationsSince(job, job.date, 5);
    const sinceToday = await readRegistrationsSince(job, dates.today, 35);
    const users = registrationsBeforeCutoff(sinceDate, sinceToday);
    const expected = prepareRows(users, job.targets);
    job.progress = 75; job.message = 'Đang đối chiếu username theo chương trình và buổi học';
    job.missing = await missingRows(expected);
    job.stats = {apiRows: users.length, apiRowsSinceDate: sinceDate.length, excludedNewerRows: sinceToday.length,
      uniqueUsers: new Set(users.map(user => text(user.username).toLowerCase())).size,
      expectedEnrollments: expected.length, existingEnrollments: expected.length - job.missing.length, missingEnrollments: job.missing.length};
    const missingKeys = new Set(job.missing.map(({row}) => enrollmentKey(row)));
    const summary = new Map<string, AuditJob['summary'][number]>();
    for (const {row} of expected) {
      const key = JSON.stringify([row.code, row.learn_number]);
      const item = summary.get(key) || {code: row.code, learnNumber: row.learn_number, expected: 0, existing: 0, missing: 0};
      item.expected += 1;
      if (missingKeys.has(enrollmentKey(row))) item.missing += 1; else item.existing += 1;
      summary.set(key, item);
    }
    job.summary = [...summary.values()];
    job.status = 'ready'; job.progress = 100;
    job.message = job.missing.length ? `Phát hiện ${job.missing.length} enrollment còn thiếu` : 'Không thiếu học viên theo dữ liệu API của ngày đã chọn';
    job.finishedAt = Date.now();
  } catch (error: any) {
    job.status = 'failed'; job.error = error.message; job.message = 'Không thể hoàn tất kiểm tra'; job.finishedAt = Date.now();
  }
}

export async function startRegistrationAudit(rawIds: unknown, rawDate: unknown, owner: number, allowed: string[] | null) {
  cleanup();
  if (!Number.isSafeInteger(owner) || owner <= 0) throw new ApiError('Phiên đăng nhập không hợp lệ', 401);
  if (!Array.isArray(rawIds) || !rawIds.length || rawIds.some(id => !['number', 'string'].includes(typeof id) || !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new ApiError('Vui lòng chọn lịch hợp lệ để kiểm tra', 400);
  const ids = [...new Set(rawIds.map(Number))];
  if (ids.length > MAX_CALENDARS) throw new ApiError(`Mỗi lần kiểm tra tối đa ${MAX_CALENDARS} lịch`, 400);
  const date = normalizeRegistrationAuditDate(rawDate);
  if (!date) throw new ApiError('Vui lòng chọn ngày đăng ký cần kiểm tra', 400);
  if (date !== registrationAuditDates().yesterday) throw new ApiError('Chỉ kiểm tra đăng ký của ngày hôm qua theo giờ Việt Nam', 400);
  if ([...jobs.values()].some(job => job.owner === owner && ['checking', 'inserting'].includes(job.status))) throw new ApiError('Bạn đang có một lượt kiểm tra/bổ sung chưa hoàn tất', 409);
  if (jobs.size >= 10 || [...jobs.values()].filter(job => ['checking', 'inserting'].includes(job.status)).length >= 3) throw new ApiError('Đang có nhiều lượt đối chiếu; vui lòng thử lại sau', 429);
  const targets = await loadTargets(ids);
  assertScope(targets, allowed);
  // Recheck after awaited reads to prevent simultaneous starts for one owner.
  if ([...jobs.values()].some(job => job.owner === owner && ['checking', 'inserting'].includes(job.status))) throw new ApiError('Bạn đang có một lượt kiểm tra/bổ sung chưa hoàn tất', 409);
  const job: AuditJob = {id: crypto.randomUUID(), owner, ids, date, targets, status: 'checking', progress: 5,
    message: 'Đang tải danh sách đăng ký từ API Học Mãi', createdAt: Date.now(), missing: [], summary: []};
  jobs.set(job.id, job);
  void check(job);
  return {jobId: job.id};
}

function ownedJob(id: string, owner: number, allowed: string[] | null): AuditJob {
  cleanup();
  const job = jobs.get(id);
  if (!job || job.owner !== owner) throw new ApiError('Lượt kiểm tra không tồn tại hoặc đã hết hạn; hãy kiểm tra lại', 404);
  assertScope(job.targets, allowed);
  return job;
}

export function getRegistrationAudit(id: string, owner: number, allowed: string[] | null, rawPage: unknown = 1, rawLimit: unknown = 50) {
  const job = ownedJob(id, owner, allowed);
  const page = Number(rawPage), limit = Number(rawLimit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError('Phân trang không hợp lệ', 400);
  return {
    jobId: job.id, status: job.status, progress: job.progress, message: job.message, error: job.error,
    registeredAt: job.date, calendarCount: job.ids.length, stats: job.stats, summary: job.summary, result: job.result,
    totalMissing: job.missing.length, page, limit,
    rows: job.missing.slice((page - 1) * limit, page * limit).map(({row, packages}, index) => ({
      key: String((page - 1) * limit + index), username: row.username, studentHmid: row.student_hmid,
      name: row.name, code: row.code, learnNumber: row.learn_number, packages: [...packages],
    })),
  };
}

async function insert(job: AuditJob, allowed: string[] | null) {
  try {
    const originalCount = job.missing.length;
    const result = await prisma.$transaction(async tx => {
      const uniqueIndexes = await tx.$queryRaw<any[]>`
        SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME
        HAVING COUNT(*) IN (3, 4)
          AND SUM(COLUMN_NAME IN ('username', 'code', 'learn_number')) = 3
          AND SUM(COLUMN_NAME NOT IN ('username', 'code', 'learn_number', 'class_id')) = 0
          AND SUM(SUB_PART IS NOT NULL) = 0
      `;
      if (!uniqueIndexes.length) throw new ApiError('Bảng users thiếu ràng buộc duy nhất theo username/chương trình/buổi hoặc lớp. Chưa bổ sung dữ liệu; cần quản trị viên kiểm tra cấu trúc bảng.', 409);
      // Lock schedule identity while validating the snapshot and inserting.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM calendar WHERE id IN (${Prisma.join(job.ids)}) FOR SHARE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM package_lesson_mapping WHERE \`key\` IN (${Prisma.join(job.targets.map(target => target.key))}) FOR SHARE`);
      const targets = await loadTargets(job.ids, tx);
      assertScope(targets, allowed);
      if (fingerprint(targets) !== fingerprint(job.targets)) throw new ApiError('Lịch hoặc Package ID đã thay đổi; hãy kiểm tra lại trước khi bổ sung', 409);
      // Re-read at write time: another user/job may already have added these.
      const missing = await missingRows(job.missing, tx);
      let inserted = 0;
      for (let offset = 0; offset < missing.length; offset += 500) {
        const batch = missing.slice(offset, offset + 500);
        const timestamps = await calendarStudentTimestamps(tx);
        inserted += (await tx.users.createMany({data: batch.map(item => ({...item.row, ...timestamps})), skipDuplicates: true})).count;
        job.progress = Math.round(Math.min(95, (offset + batch.length) / Math.max(missing.length, 1) * 95));
        job.message = `Đã bổ sung ${inserted} enrollment`;
      }
      const remaining = await missingRows(job.missing, tx);
      return {inserted, alreadyPresent: originalCount - inserted - remaining.length, remaining};
    }, {maxWait: 10_000, timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted});
    job.missing = result.remaining;
    job.result = {inserted: result.inserted, alreadyPresent: result.alreadyPresent, remaining: result.remaining.length};
    if (job.stats) {job.stats.missingEnrollments = job.missing.length; job.stats.existingEnrollments = job.stats.expectedEnrollments - job.missing.length;}
    job.summary.forEach(item => {item.missing = job.missing.filter(({row}) => row.code === item.code && row.learn_number === item.learnNumber).length; item.existing = item.expected - item.missing;});
    job.status = 'completed'; job.progress = 100; job.message = `Đã bổ sung ${result.inserted} enrollment còn thiếu`; job.finishedAt = Date.now();
  } catch (error: any) {
    job.status = 'failed'; job.error = error instanceof ApiError ? error.message : 'Không thể bổ sung học viên; toàn bộ lượt bổ sung đã được hoàn tác. Vui lòng kiểm tra lại hoặc liên hệ quản trị viên.'; job.message = 'Chưa bổ sung dữ liệu; vui lòng kiểm tra lại'; job.finishedAt = Date.now();
  }
}

export function applyRegistrationAudit(id: string, owner: number, allowed: string[] | null) {
  const job = ownedJob(id, owner, allowed);
  if (job.status === 'completed') return {jobId: job.id}; // Safe repeated request.
  if (job.status !== 'ready') throw new ApiError('Lượt kiểm tra chưa sẵn sàng để bổ sung', 409);
  job.status = 'inserting'; job.progress = 0; job.message = 'Đang kiểm tra lại và bổ sung học viên thiếu';
  void insert(job, allowed);
  return {jobId: job.id};
}
