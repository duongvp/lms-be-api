import { Prisma } from '@prisma/client';
import { getVietnamWallClockDate } from '../../utils/dateTime';

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type TeachingProfile = {
  username: string;
  display_name: string | null;
  student_hmid?: string | null;
};

type ResolvedTeachingProfile = TeachingProfile & {
  role: 'teacher' | 'assistant';
};

type CalendarTeachingSnapshot = {
  id?: number;
  code: string;
  learn_number: number;
  start_time: Date | string;
  teacher?: string | null;
  assistant_teacher?: string | null;
  lesson_status?: number | null;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const sameDateTime = (left: unknown, right: Date) => {
  if (!(left instanceof Date) && typeof left !== 'string') return false;
  const leftDate = left instanceof Date ? left : new Date(left);
  return !Number.isNaN(leftDate.getTime()) && leftDate.getTime() === right.getTime();
};

/** Chỉ cập nhật enrollment khi trạng thái thực tế đã thay đổi. */
const teachingUserNeedsUpdate = (existing: any, next: {
  name: string;
  islearn: number;
  room_id: number;
  class_id: string;
  created_at: Date;
  student_hmid?: string;
}) => (
  normalizeText(existing?.name) !== next.name
  || Number(existing?.islearn) !== next.islearn
  || Number(existing?.room_id) !== next.room_id
  || normalizeText(existing?.class_id) !== next.class_id
  || !sameDateTime(existing?.created_at, next.created_at)
  || (next.student_hmid !== undefined
    && normalizeText(existing?.student_hmid) !== next.student_hmid)
);

export const buildTeachingUserName = (
  studentHmid: unknown,
  displayName: unknown,
  username: unknown
) => {
  const normalizedHmid = normalizeText(studentHmid);
  const normalizedDisplayName = normalizeText(displayName) || normalizeText(username);
  if (!normalizedHmid) return normalizedDisplayName.slice(0, 150);

  const prefix = `${normalizedHmid} - `;
  if (normalizedDisplayName.startsWith(prefix)) {
    return normalizedDisplayName.slice(0, 150);
  }
  return `${prefix}${normalizedDisplayName.slice(0, Math.max(0, 150 - prefix.length))}`;
};

const parseAssistantTeachers = (value: unknown) => Array.from(new Set(
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map(normalizeText)
    .filter(Boolean)
));

const isActiveSchedule = (calendar?: CalendarTeachingSnapshot | null) => (
  !!calendar && Number(calendar.lesson_status ?? 0) !== 1
);

const teachingAssignmentsMatch = (
  before: CalendarTeachingSnapshot,
  after: CalendarTeachingSnapshot
) => (
  normalizeText(before.teacher) === normalizeText(after.teacher)
  && parseAssistantTeachers(before.assistant_teacher).sort().join(',')
    === parseAssistantTeachers(after.assistant_teacher).sort().join(',')
);

/**
 * Excel dùng hệ ngày 1900 và giữ lại leap-year bug lịch sử. Epoch 30/12/1899
 * cho kết quả tương đương VALUE(date) với mọi ngày nghiệp vụ hiện đại.
 * Calendar đang lưu giờ Việt Nam dưới dạng UTC wall-clock nên phải lấy các
 * thành phần UTC, không đổi timezone trước khi tính ngày.
 */
export const excelDateSerialFromCalendarDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Ngày lịch học không hợp lệ');

  const dateOnlyUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  return Math.floor((dateOnlyUtc - EXCEL_EPOCH_UTC) / DAY_IN_MS);
};

export const calendarDateAtMidnight = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Ngày lịch học không hợp lệ');
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
};

export const buildCalendarClassId = (
  code: string,
  startTime: Date | string,
  learnNumber: number
) => {
  const normalizedCode = normalizeText(code);
  const normalizedLearnNumber = Number(learnNumber);
  if (!normalizedCode) throw new Error('Không thể tạo class_id khi thiếu code');
  if (!Number.isInteger(normalizedLearnNumber) || normalizedLearnNumber <= 0) {
    throw new Error('Không thể tạo class_id khi learn_number không hợp lệ');
  }
  const classId = `${normalizedCode}${excelDateSerialFromCalendarDate(startTime)}${normalizedLearnNumber}1`;
  if (classId.length > 100) throw new Error('class_id vượt quá 100 ký tự');
  return classId;
};

/**
 * Công thức class_id có room 1 ở ký tự cuối. Các classroom tiếp theo giữ
 * nguyên code + ngày lịch + bài và chỉ thay hậu tố bằng room_id tương ứng.
 */
export const buildCalendarRoomClassId = (
  code: string,
  startTime: Date | string,
  learnNumber: number,
  roomId: number
) => {
  const normalizedRoomId = Number(roomId);
  if (!Number.isInteger(normalizedRoomId) || normalizedRoomId <= 0) {
    throw new Error('Không thể tạo class_id khi room_id không hợp lệ');
  }
  const roomOneClassId = buildCalendarClassId(code, startTime, learnNumber);
  const classId = `${roomOneClassId.slice(0, -1)}${normalizedRoomId}`;
  if (classId.length > 100) throw new Error('class_id vượt quá 100 ký tự');
  return classId;
};

export const resolveCalendarTeacherProfile = async (client: any, identifier: unknown) => {
  const normalizedIdentifier = normalizeText(identifier);
  if (!normalizedIdentifier) return null;

  const profiles = await client.teacher_profiles.findMany({
    where: {
      can_view_stream_key: 1,
      status: 1,
      OR: [
        { username: normalizedIdentifier },
        { display_name: normalizedIdentifier },
      ],
    },
    select: { username: true, display_name: true, student_hmid: true },
    orderBy: { id: 'asc' },
  }) as TeachingProfile[];
  const exactUsername = profiles.find((profile) => profile.username === normalizedIdentifier);
  if (exactUsername) return exactUsername;
  if (profiles.length === 1) return profiles[0];
  if (profiles.length > 1) {
    throw new Error(`Tên giáo viên "${normalizedIdentifier}" trùng nhiều tài khoản`);
  }
  throw new Error(`Không xác định được tài khoản giáo viên "${normalizedIdentifier}"`);
};

const resolveTeachingProfiles = async (
  client: any,
  calendar: CalendarTeachingSnapshot
) => {
  const teacher = await resolveCalendarTeacherProfile(client, calendar.teacher);
  const assistantUsernames = parseAssistantTeachers(calendar.assistant_teacher);
  const assistants = assistantUsernames.length
    ? await client.teacher_profiles.findMany({
        where: {
          username: { in: assistantUsernames },
          can_view_stream_key: 0,
          status: 1,
        },
        select: { username: true, display_name: true, student_hmid: true },
      }) as TeachingProfile[]
    : [];
  const assistantByUsername = new Map(
    assistants.map((profile) => [profile.username, profile])
  );
  const missingAssistants = assistantUsernames.filter(
    (username) => !assistantByUsername.has(username)
  );
  if (missingAssistants.length) {
    throw new Error(`Không xác định được tài khoản trợ giảng: ${missingAssistants.join(', ')}`);
  }

  return [
    ...(teacher ? [{ ...teacher, role: 'teacher' as const }] : []),
    ...assistantUsernames.map((username) => ({
      ...assistantByUsername.get(username)!,
      role: 'assistant' as const,
    })),
  ];
};

const resolvePreviousTeachingProfiles = async (
  client: any,
  calendar: CalendarTeachingSnapshot
) => {
  // Thu hồi trợ giảng theo username đã lưu, kể cả profile đã bị vô hiệu hóa/xóa.
  const assistants: TeachingProfile[] = parseAssistantTeachers(calendar.assistant_teacher)
    .map((username) => ({ username, display_name: null }));
  try {
    const teacher = await resolveCalendarTeacherProfile(client, calendar.teacher);
    return { profiles: [...(teacher ? [teacher] : []), ...assistants] };
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('trùng nhiều tài khoản')
      || error.message.includes('Không xác định được tài khoản giáo viên')
    )) {
      return { profiles: assistants };
    }
    throw error;
  }
};

const findTeachingStudentHmid = async (
  client: any,
  username: string,
  code: string
) => {
  const validHmidWhere = {
    username,
    student_hmid: { not: null },
    NOT: { student_hmid: '' },
  };
  // Cùng username có thể mang HMID khác nhau giữa các chương trình. Luôn ưu
  // tiên row của chính chương trình đang quét để không sao chép nhầm HMID.
  const sameProgram = await client.users.findFirst({
    where: { ...validHmidWhere, code },
    select: { student_hmid: true },
    orderBy: { id: 'asc' },
  });
  const sameProgramHmid = normalizeText(sameProgram?.student_hmid);
  if (sameProgramHmid) return sameProgramHmid;

  const fallback = await client.users.findFirst({
    where: validHmidWhere,
    select: { student_hmid: true },
    orderBy: { id: 'asc' },
  });
  return normalizeText(fallback?.student_hmid) || null;
};

const upsertTeachingUser = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: ResolvedTeachingProfile,
  classId: string
) => {
  const lessonDate = calendarDateAtMidnight(calendar.start_time);
  const username = normalizeText(profile.username);
  if (username.length > 100) {
    throw new Error(`Username nhân sự "${username}" vượt quá 100 ký tự`);
  }
  const studentHmid = normalizeText(profile.student_hmid)
    || await findTeachingStudentHmid(client, username, calendar.code);
  const displayName = buildTeachingUserName(
    studentHmid,
    profile.role === 'assistant' ? 'Giáo viên' : profile.display_name,
    username
  );
  const identityWhere = { username, code: calendar.code, learn_number: calendar.learn_number };
  const existing = await client.users.findFirst({
    where: identityWhere,
    select: { id: true, student_hmid: true, name: true, islearn: true, room_id: true, class_id: true, created_at: true },
  });
  const createData = {
    username, student_hmid: studentHmid, email: username, phone: null, name: displayName,
    code: calendar.code, learn_number: calendar.learn_number, islearn: 0, room_id: 1,
    class_id: classId, created_at: lessonDate, updated_at: getVietnamWallClockDate(),
  };
  const updateFields = {
    name: displayName, islearn: 0, room_id: 1, class_id: classId, created_at: lessonDate,
    ...(studentHmid ? { student_hmid: studentHmid } : {}),
  };
  if (existing) {
    if (teachingUserNeedsUpdate(existing, updateFields)) {
      await client.users.update({ where: { id: existing.id }, data: { ...updateFields, updated_at: getVietnamWallClockDate() } });
    }
    return;
  }
  try {
    await client.users.create({ data: createData });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await client.users.findFirst({
      where: identityWhere,
      select: { id: true, student_hmid: true, name: true, islearn: true, room_id: true, class_id: true, created_at: true },
    });
    if (!concurrent) throw error;
    if (teachingUserNeedsUpdate(concurrent, updateFields)) {
      await client.users.update({ where: { id: concurrent.id }, data: { ...updateFields, updated_at: getVietnamWallClockDate() } });
    }
  }
};

/**
 * Đối soát enrollment theo phân công hiện tại, bao gồm thu hồi class_id thừa.
 * Không xóa user hoặc thay đổi các quan hệ phân quyền của tài khoản.
 */
export const ensureCalendarTeachingUsers = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profileCache?: Map<string, ResolvedTeachingProfile[]>,
  additionalProfiles: ResolvedTeachingProfile[] = []
) => {
  if (!isActiveSchedule(calendar)) {
    await removeLegacyTeachingUsersNotInNext(client, calendar, new Set());
    return { created: 0, updated: 0, skipped: 0 };
  }
  const profileCacheKey = [
    normalizeText(calendar.teacher),
    parseAssistantTeachers(calendar.assistant_teacher).sort().join(','),
  ].join('|');
  let profiles = profileCache?.get(profileCacheKey);
  if (!profiles) {
    profiles = await resolveTeachingProfiles(client, calendar);
    profileCache?.set(profileCacheKey, profiles);
  }
  // Tài khoản bổ sung là ngoại lệ được cấp quyền ngoài phân công. Không
  // dọn các user ngoài lịch tại đây vì không có metadata phân biệt chúng
  // với tài khoản bổ sung đã được quét trước đó.
  profiles = Array.from(new Map(
    [...profiles, ...additionalProfiles].map((profile) => [normalizeText(profile.username), profile])
  ).values());
  if (!profiles.length) return { created: 0, updated: 0, skipped: 0 };

  const classId = buildCalendarClassId(calendar.code, calendar.start_time, calendar.learn_number);
  const lessonDate = calendarDateAtMidnight(calendar.start_time);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const username = normalizeText(profile.username);
    const identityWhere = { username, code: calendar.code, learn_number: calendar.learn_number };
    const existing = await client.users.findFirst({
      where: identityWhere,
      select: { id: true, student_hmid: true, name: true, islearn: true, room_id: true, class_id: true, created_at: true },
    });
    const studentHmid = normalizeText(existing?.student_hmid)
      || normalizeText(profile.student_hmid)
      || await findTeachingStudentHmid(client, username, calendar.code);
    const displayName = buildTeachingUserName(
      studentHmid,
      profile.role === 'assistant' ? 'Giáo viên' : profile.display_name,
      username
    );
    const updateFields = {
      name: displayName, islearn: 0, room_id: 1, class_id: classId, created_at: lessonDate,
      ...(studentHmid ? { student_hmid: studentHmid } : {}),
    };
    if (existing) {
      if (teachingUserNeedsUpdate(existing, updateFields)) {
        await client.users.update({
          where: { id: existing.id },
          data: { ...updateFields, updated_at: getVietnamWallClockDate() },
        });
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    try {
      await client.users.create({
        data: {
          username, student_hmid: studentHmid, email: username, phone: null, name: displayName,
          code: calendar.code, learn_number: calendar.learn_number, islearn: 0, room_id: 1,
          class_id: classId, created_at: lessonDate, updated_at: getVietnamWallClockDate(),
        },
      });
      created += 1;
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const concurrent = await client.users.findFirst({
        where: identityWhere,
        select: { id: true, student_hmid: true, name: true, islearn: true, room_id: true, class_id: true, created_at: true },
      });
      if (!concurrent) throw error;
      if (teachingUserNeedsUpdate(concurrent, updateFields)) {
        await client.users.update({
          where: { id: concurrent.id },
          data: { ...updateFields, updated_at: getVietnamWallClockDate() },
        });
        updated += 1;
      } else {
        skipped += 1;
      }
    }
  }
  return { created, updated, skipped };
};

export type ScanTeachingUser = { username: string; role: 'teacher' | 'assistant' };

export const normalizeScanTeachingUsers = (value: unknown): ScanTeachingUser[] => {
  if (value === undefined) return [{ username: 'loandtt3@hocmai.vn', role: 'assistant' }];
  if (!Array.isArray(value)) throw new Error('Danh sách tài khoản bổ sung không hợp lệ');
  const users = new Map<string, ScanTeachingUser>();
  for (const item of value) {
    const username = normalizeText(item?.username);
    if (!username || username.length > 100 || !['teacher', 'assistant'].includes(item?.role)) {
      throw new Error('Tài khoản hoặc vai trò nhân sự bổ sung không hợp lệ');
    }
    users.set(username, { username, role: item.role });
  }
  return Array.from(users.values());
};

/** Bổ sung các tài khoản được chọn riêng khi chạy Quét user nhân sự. */
export const ensureCalendarScanTeachingUsers = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  additionalUsers: ScanTeachingUser[] = normalizeScanTeachingUsers(undefined)
) => {
  if (!isActiveSchedule(calendar)) return ensureCalendarTeachingUsers(client, calendar);
  const profiles: TeachingProfile[] = additionalUsers.length
    ? await client.teacher_profiles.findMany({
        where: { username: { in: additionalUsers.map((user) => user.username) } },
        select: { username: true, display_name: true, student_hmid: true },
      })
    : [];
  const profilesByUsername = new Map(profiles.map((profile) => [profile.username, profile]));
  return ensureCalendarTeachingUsers(client, calendar, undefined, additionalUsers.map((user) => ({
    ...profilesByUsername.get(user.username),
    username: user.username,
    display_name: profilesByUsername.get(user.username)?.display_name ?? null,
    role: user.role,
  })));
};

const isStillAssigned = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: TeachingProfile
) => {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT teacher, assistant_teacher, start_time
    FROM calendar
    WHERE code = ${calendar.code}
      AND learn_number = ${calendar.learn_number}
      AND (lesson_status IS NULL OR lesson_status <> 1)
      ${calendar.id ? Prisma.sql`AND id <> ${calendar.id}` : Prisma.empty}
  `) as Array<{ teacher: string | null; assistant_teacher: string | null; start_time: Date | string }>;
  const identifiers = new Set([
    normalizeText(profile.username),
    normalizeText(profile.display_name),
  ].filter(Boolean));
  const classId = buildCalendarClassId(calendar.code, calendar.start_time, calendar.learn_number);
  const isDefaultSupport = normalizeScanTeachingUsers(undefined)
    .some((user) => user.username === profile.username);
  return rows.some((row) => (
    buildCalendarClassId(calendar.code, row.start_time, calendar.learn_number) === classId
    && (isDefaultSupport || identifiers.has(normalizeText(row.teacher))
      || parseAssistantTeachers(row.assistant_teacher).includes(profile.username))
  ));
};

const removeUnassignedTeachingUser = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: TeachingProfile
) => {
  // Tài khoản hỗ trợ mặc định vẫn được phép vào lớp dù bỏ khỏi phân công.
  if (isActiveSchedule(calendar)
    && normalizeScanTeachingUsers(undefined).some((user) => user.username === profile.username)) return;
  if (await isStillAssigned(client, calendar, profile)) return;
  await client.users.updateMany({
    where: {
      username: profile.username,
      code: calendar.code,
      learn_number: calendar.learn_number,
      class_id: buildCalendarClassId(calendar.code, calendar.start_time, calendar.learn_number),
    },
    // Giữ nguyên user, HMID, trạng thái học và quyền quản trị; chỉ thu hồi lớp Live.
    data: { class_id: null, updated_at: getVietnamWallClockDate() },
  });
};

const removeLegacyTeachingUsersNotInNext = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  nextUsernames: Set<string>
) => {
  if (typeof client.users.findMany !== 'function') return;
  const users = await client.users.findMany({
    where: {
      code: calendar.code,
      learn_number: calendar.learn_number,
      class_id: buildCalendarClassId(calendar.code, calendar.start_time, calendar.learn_number),
    },
    select: { username: true },
  }) as Array<{ username: string }>;
  const candidates = users.filter((user) => !nextUsernames.has(user.username));
  if (!candidates.length) return;
  // Học viên cũng có room_id=1 và islearn=0. Chỉ dọn user thuộc nhân sự.
  const profiles = await client.teacher_profiles.findMany({
    where: { username: { in: candidates.map((user) => user.username) } },
    select: { username: true, display_name: true },
  }) as TeachingProfile[];
  for (const profile of profiles) {
    await removeUnassignedTeachingUser(client, calendar, profile);
  }
};

const calendarSyncSignature = (calendar?: CalendarTeachingSnapshot | null) => {
  if (!calendar) return '';
  const date = new Date(calendar.start_time);
  return [
    calendar.code,
    calendar.learn_number,
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    normalizeText(calendar.teacher),
    parseAssistantTeachers(calendar.assistant_teacher).sort().join(','),
    Number(calendar.lesson_status ?? 0) === 1 ? 'cancelled' : 'active',
  ].join('|');
};

/** Đồng bộ enrollment của giáo viên/trợ giảng theo trạng thái calendar cuối cùng. */
export const syncCalendarTeachingUsers = async (
  client: any,
  before: CalendarTeachingSnapshot | null,
  after: CalendarTeachingSnapshot
) => {
  if (before && calendarSyncSignature(before) === calendarSyncSignature(after)) return;

  // Khi chỉ thay ngày/giờ của lịch cũ, teacher có thể là display_name trùng
  // nhiều profile. Chỉ chuyển nhân sự đã có tại class_id cũ; không chuyển
  // học viên hay user của một lớp khác cùng code + learn_number.
  if (
    before
    && isActiveSchedule(before)
    && isActiveSchedule(after)
    && teachingAssignmentsMatch(before, after)
  ) {
    const classId = buildCalendarClassId(after.code, after.start_time, after.learn_number);
    const assignedProfiles = await client.teacher_profiles.findMany({
      where: { status: 1, OR: [
        ...(normalizeText(after.teacher) ? [
          { username: normalizeText(after.teacher) },
          { display_name: normalizeText(after.teacher) },
        ] : []),
        { username: { in: [
          ...parseAssistantTeachers(after.assistant_teacher),
          ...normalizeScanTeachingUsers(undefined).map((user) => user.username),
        ] } },
      ] },
      select: { username: true, display_name: true },
    }) as TeachingProfile[];
    const assignedUsernames = new Set(assignedProfiles.map((profile) => profile.username));
    await client.users.updateMany({
      where: {
        code: before.code,
        learn_number: before.learn_number,
        class_id: buildCalendarClassId(before.code, before.start_time, before.learn_number),
        username: { in: [...assignedUsernames] },
      },
      data: {
        room_id: 1,
        class_id: classId,
        updated_at: getVietnamWallClockDate(),
      },
    });
    return;
  }

  const previousProfileResolution = before && isActiveSchedule(before)
    ? await resolvePreviousTeachingProfiles(client, before)
    : { profiles: [] as TeachingProfile[] };
  const beforeProfiles = previousProfileResolution.profiles;
  const afterProfiles = isActiveSchedule(after)
    ? await resolveTeachingProfiles(client, after)
    : [];
  const nextUsernames = new Set(afterProfiles.map((profile) => profile.username));

  if (afterProfiles.length) {
    const classId = buildCalendarClassId(
      after.code,
      after.start_time,
      after.learn_number
    );
    for (const profile of afterProfiles) {
      await upsertTeachingUser(client, after, profile, classId);
    }
  }

  if (!isActiveSchedule(after)) {
    await removeLegacyTeachingUsersNotInNext(client, after, nextUsernames);
  }
  if (before) {
    for (const profile of beforeProfiles) {
      if (!nextUsernames.has(profile.username)) {
        await removeUnassignedTeachingUser(client, before, profile);
      }
    }
  }
};
