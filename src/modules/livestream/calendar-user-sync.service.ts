import { Prisma } from '@prisma/client';

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type TeachingProfile = {
  username: string;
  display_name: string | null;
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
    select: { username: true, display_name: true },
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
        },
        select: { username: true, display_name: true },
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
  try {
    return {
      profiles: await resolveTeachingProfiles(client, calendar),
      hasLegacyIdentityIssue: false,
    };
  } catch (error) {
    // Lịch cũ từng lưu display_name thay vì username. Nếu tên hiện trùng,
    // không được chặn thao tác cập nhật lịch; user legacy sẽ không bị xóa
    // cho đến khi người dùng chọn lại nhân sự bằng username.
    if (
      error instanceof Error
      && (error.message.includes('trùng nhiều tài khoản')
        || error.message.includes('Không xác định được tài khoản giáo viên'))
    ) {
      return {
        profiles: [] as TeachingProfile[],
        hasLegacyIdentityIssue: true,
      };
    }
    throw error;
  }
};

const upsertTeachingUser = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: TeachingProfile,
  classId: string
) => {
  const username = normalizeText(profile.username);
  const displayName = normalizeText(profile.display_name) || username;
  if (username.length > 100) {
    throw new Error(`Username nhân sự "${username}" vượt quá 100 ký tự`);
  }
  const existingWithHmid = await client.users.findFirst({
    where: { username, student_hmid: { not: null } },
    select: { student_hmid: true }
  });
  const studentHmid = existingWithHmid?.student_hmid || null;

  await client.users.upsert({
    where: {
      username_code_learn_number: {
        username,
        code: calendar.code,
        learn_number: calendar.learn_number,
      },
    },
    create: {
      username,
      student_hmid: studentHmid,
      email: username,
      phone: null,
      name: displayName,
      code: calendar.code,
      learn_number: calendar.learn_number,
      islearn: 0,
      room_id: 1,
      class_id: classId,
      created_at: new Date(),
      updated_at: new Date(),
    },
    update: {
      name: displayName,
      islearn: 0,
      room_id: 1,
      class_id: classId,
      ...(studentHmid ? { student_hmid: studentHmid } : {}),
      updated_at: new Date(),
    },
  });
};

/**
 * Bổ sung enrollment cho nhân sự đã gán trên calendar nhưng chưa có trong
 * users. Dùng ở cập nhật hàng loạt để khôi phục các lịch legacy đã tồn tại
 * trước khi cơ chế tự đồng bộ được bật. Hàm này tuyệt đối không cập nhật hay
 * xóa user đã có; chỉ tạo đúng các bản ghi còn thiếu.
 */
export const ensureCalendarTeachingUsers = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profileCache?: Map<string, ResolvedTeachingProfile[]>
) => {
  if (!isActiveSchedule(calendar)) return { created: 0 };

  const profileCacheKey = [
    normalizeText(calendar.teacher),
    parseAssistantTeachers(calendar.assistant_teacher).sort().join(','),
  ].join('|');
  let profiles = profileCache?.get(profileCacheKey);
  if (!profiles) {
    profiles = await resolveTeachingProfiles(client, calendar);
    profileCache?.set(profileCacheKey, profiles);
  }
  if (!profiles.length) return { created: 0 };

  const classId = buildCalendarClassId(
    calendar.code,
    calendar.start_time,
    calendar.learn_number
  );
  let created = 0;

  for (const profile of profiles) {
    const username = normalizeText(profile.username);
    const existing = await client.users.findUnique({
      where: {
        username_code_learn_number: {
          username,
          code: calendar.code,
          learn_number: calendar.learn_number,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    const existingWithHmid = await client.users.findFirst({
      where: { username, student_hmid: { not: null } },
      select: { student_hmid: true },
    });
    const studentHmid = existingWithHmid?.student_hmid || null;
    const displayName = profile.role === 'assistant'
      ? [normalizeText(studentHmid), 'Giáo viên'].filter(Boolean).join(' - ')
      : normalizeText(profile.display_name) || username;

    try {
      await client.users.create({
        data: {
          username,
          student_hmid: studentHmid,
          email: username,
          phone: null,
          name: displayName,
          code: calendar.code,
          learn_number: calendar.learn_number,
          islearn: 0,
          room_id: 1,
          class_id: classId,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      created += 1;
    } catch (error: any) {
      // Một request khác có thể vừa tạo cùng enrollment. Khi đó giữ nguyên
      // bản ghi vừa có, không coi đây là lỗi của cập nhật lịch hàng loạt.
      if (error?.code !== 'P2002') throw error;
    }
  }

  return { created };
};

const isStillAssigned = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: TeachingProfile
) => {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT teacher, assistant_teacher
    FROM calendar
    WHERE code = ${calendar.code}
      AND learn_number = ${calendar.learn_number}
      AND (lesson_status IS NULL OR lesson_status <> 1)
      ${calendar.id ? Prisma.sql`AND id <> ${calendar.id}` : Prisma.empty}
  `) as Array<{ teacher: string | null; assistant_teacher: string | null }>;
  const identifiers = new Set([
    normalizeText(profile.username),
    normalizeText(profile.display_name),
  ].filter(Boolean));
  return rows.some((row) => (
    identifiers.has(normalizeText(row.teacher))
    || parseAssistantTeachers(row.assistant_teacher).includes(profile.username)
  ));
};

const removeUnassignedTeachingUser = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  profile: TeachingProfile
) => {
  if (await isStillAssigned(client, calendar, profile)) return;
  await client.users.deleteMany({
    where: {
      username: profile.username,
      code: calendar.code,
      learn_number: calendar.learn_number,
      room_id: 1,
      islearn: 0,
      userRoles: { none: {} },
    },
  });
};

const removeLegacyTeachingUsersNotInNext = async (
  client: any,
  calendar: CalendarTeachingSnapshot,
  nextUsernames: Set<string>
) => {
  // Only runs with the Prisma client. Keeping this guard also makes the
  // synchronizer usable by lightweight test clients.
  if (typeof client.users.findMany !== 'function') return;

  const users = await client.users.findMany({
    where: {
      code: calendar.code,
      learn_number: calendar.learn_number,
      room_id: 1,
      islearn: 0,
    },
    select: { username: true, name: true },
  }) as Array<{ username: string; name: string | null }>;

  for (const user of users) {
    if (nextUsernames.has(user.username)) continue;
    await removeUnassignedTeachingUser(client, calendar, {
      username: user.username,
      display_name: user.name,
    });
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
  // nhiều profile. Không cần resolve lại tên đó: cập nhật class_id trực tiếp
  // trên các user đã được liên kết với code + learn_number.
  if (
    before
    && isActiveSchedule(before)
    && isActiveSchedule(after)
    && teachingAssignmentsMatch(before, after)
  ) {
    const classId = buildCalendarClassId(after.code, after.start_time, after.learn_number);
    await client.users.updateMany({
      where: {
        code: after.code,
        learn_number: after.learn_number,
        room_id: 1,
        islearn: 0,
      },
      data: {
        room_id: 1,
        class_id: classId,
        updated_at: new Date(),
      },
    });
    return;
  }

  const previousProfileResolution = before && isActiveSchedule(before)
    ? await resolvePreviousTeachingProfiles(client, before)
    : { profiles: [] as TeachingProfile[], hasLegacyIdentityIssue: false };
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

  if (before) {
    for (const profile of beforeProfiles) {
      if (!nextUsernames.has(profile.username)) {
        await removeUnassignedTeachingUser(client, before, profile);
      }
    }
    if (previousProfileResolution.hasLegacyIdentityIssue) {
      await removeLegacyTeachingUsersNotInNext(client, before, nextUsernames);
    }
  }
};
