import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { resolvePackagesByCourseId } from '../../integrations/package-course-sheet.service';
import {
  enqueueRescheduleSync,
  withManualHocmaiQueue,
} from './hocmai-sync-queue.service';

const prisma = new PrismaClient();

export type CalendarChangeActor = {
  userId: number;
  username: string;
};

const normalizeChangeReason = (payload: any) => {
  const reason = String(payload?.reason ?? payload?.change_reason ?? '').trim();
  if (!reason) {
    throw new Error("Vui lòng nhập lý do thay đổi lịch học");
  }
  if (reason.length > 500) {
    throw new Error("Lý do thay đổi không được vượt quá 500 ký tự");
  }
  return reason;
};

const normalizeChangeActor = (actor?: CalendarChangeActor) => {
  const userId = Number(actor?.userId);
  const username = String(actor?.username || '').trim();
  if (!Number.isInteger(userId) || userId <= 0 || !username) {
    throw new Error("Không xác định được người thay đổi lịch học");
  }
  return { userId, username };
};

const toAuditJson = (value: any) => JSON.stringify(
  value,
  (_key, item) => typeof item === 'bigint' ? item.toString() : item
);

const writeCalendarChangeLog = async (
  tx: Prisma.TransactionClient,
  input: {
    operationId?: string;
    action: string;
    current: any;
    reason: string;
    actor: CalendarChangeActor;
    beforeData: any;
    afterData: any;
    affectedSessions: any[];
    newKey?: string | null;
  }
) => {
  await tx.$executeRaw`
    INSERT INTO calendar_change_logs (
      operation_id,
      action,
      calendar_id,
      old_key,
      new_key,
      code,
      learn_number,
      reason,
      actor_user_id,
      actor_username,
      before_data,
      after_data,
      affected_sessions,
      created_at
    ) VALUES (
      ${input.operationId || crypto.randomUUID()},
      ${input.action},
      ${input.current.id},
      ${input.current.key || null},
      ${input.newKey || null},
      ${input.current.code},
      ${input.current.learn_number},
      ${input.reason},
      ${input.actor.userId},
      ${input.actor.username},
      ${toAuditJson(input.beforeData)},
      ${toAuditJson(input.afterData)},
      ${toAuditJson(input.affectedSessions)},
      NOW(3)
    )
  `;
};

// Helper: Tạo key (sessionId) tự động theo quy tắc
const generateKey = (
  systemType: string,
  startTime: Date,
  code: string,
  learnNumber: number,
  lessonCount: number
): string => {
  const sysCode = systemType === 'topclass' ? 'tc' : (systemType === 'topuni' ? 'tu' : systemType);

  const startYear = startTime.getFullYear();
  const month = startTime.getMonth() + 1;

  let schoolYear;
  if (month >= 6) {
    schoolYear = `${startYear.toString().slice(-2)}${(startYear + 1).toString().slice(-2)}`;
  } else {
    schoolYear = `${(startYear - 1).toString().slice(-2)}${startYear.toString().slice(-2)}`;
  }

  const sessionNum = (lessonCount || 0) + 1;
  const sessionSuffix = sessionNum > 1 ? `_b${sessionNum}` : '';
  return `${sysCode}_${schoolYear}_${code}_${learnNumber}${sessionSuffix}`;
};

const COPY_SESSION_FIELDS = [
  'code',
  'learn_number',
  'subject',
  'teacher',
  'lesson_name',
  'lesson_document',
  'evg_banner',
  'evg_stream',
  'lesson_link',
  'lesson_baitap',
  'lesson_tomtat',
  'lesson_phuongphap',
  'lesson_luuy',
  'lesson_ketqua',
  'channel_name',
  'lesson_count',
  'lesson_noti',
  'system_type',
];

const normalizeRoom = (data: any) => {
  if (data?.room && !data.channel_name) {
    data.channel_name = data.room;
  }
  delete data.room;
  return data;
};

const hydrateLessonData = async (tx: any, input: any) => {
  const data = { ...input };
  const lessonId = data.lesson_id;
  const customLessonName = typeof data.lesson_name === 'string'
    ? data.lesson_name.trim()
    : '';

  if (customLessonName.length > 400) {
    throw new Error("lesson_name không được vượt quá 400 ký tự");
  }

  delete data.lesson_id;
  delete data.package_lesson_mappings;
  delete data.grade;
  delete data.subject_code;
  delete data.subject_name;

  // Các client cũ không gửi lesson_id vẫn tiếp tục dùng payload calendar hiện tại.
  if (lessonId === undefined || lessonId === null || lessonId === '') {
    return data;
  }

  let parsedLessonId: bigint;
  try {
    parsedLessonId = BigInt(lessonId);
  } catch {
    throw new Error("lesson_id không hợp lệ");
  }

  const lessons = await tx.$queryRawUnsafe(
    'SELECT * FROM lessons WHERE id = ? AND status <> 0 LIMIT 1',
    parsedLessonId
  ) as any[];
  const lesson = lessons[0];

  if (!lesson) {
    throw new Error("Bài học không tồn tại hoặc đã ngừng hoạt động");
  }

  return {
    ...data,
    learn_number: lesson.learn_number,
    subject: lesson.subject_name,
    lesson_name: customLessonName || lesson.lesson_name,
    lesson_document: lesson.lesson_document,
    evg_banner: lesson.evg_banner,
    evg_stream: lesson.evg_stream,
    lesson_link: lesson.lesson_link,
    lesson_baitap: lesson.lesson_baitap,
    lesson_tomtat: lesson.lesson_tomtat,
    lesson_phuongphap: lesson.lesson_phuongphap,
    lesson_luuy: lesson.lesson_luuy,
    lesson_ketqua: lesson.lesson_ketqua,
  };
};

const ensureValidTimeRange = (startTime: Date, endTime: Date) => {
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    throw new Error("Thời gian không hợp lệ");
  }

  if (startTime >= endTime) {
    throw new Error("Thời gian kết thúc phải sau thời gian bắt đầu");
  }
};

const ensureNotAfterCourseEnd = (endTime: Date, courseEndTime?: unknown) => {
  if (!courseEndTime) return;

  const courseEnd = new Date(String(courseEndTime));
  if (Number.isNaN(courseEnd.getTime())) {
    throw new Error("course_end_time không hợp lệ");
  }

  if (endTime > courseEnd) {
    throw new Error("Lịch học không được vượt ngày kết thúc khóa học");
  }
};

const startOfDay = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const ensureNotBeforeDate = (value: Date, minDate: Date, message: string) => {
  if (startOfDay(value) < startOfDay(minDate)) {
    throw new Error(message);
  }
};

export const isSessionModifiable = (session: any, now = new Date()) => {
  if (Number(session.lesson_status) === 1) return false;

  const startTime = session.start_time ? new Date(session.start_time) : null;
  return Boolean(
    startTime
    && !Number.isNaN(startTime.getTime())
    && startTime > now
  );
};

const assertCanUpdateSession = (session: any) => {
  if (!isSessionModifiable(session)) {
    throw new Error("Chỉ được thay đổi buổi học chưa diễn ra và chưa nghỉ");
  }
};

const withCalendarTriggerErrorHint = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes("The user specified as a definer") || message.includes("code: 1449")) {
      throw new Error(
        "Trigger calendar đang dùng DEFINER không tồn tại trên database. Chạy `npm run db:calendar-triggers` trong lms-manage-api để tạo lại trigger bằng user DB hiện tại."
      );
    }
    throw error;
  }
};

const isTransactionConflict = (error: any) => {
  if (error?.code === 'P2034') return true;

  const message = String(error?.message || '');
  return message.includes('Deadlock found')
    || message.includes('Lock wait timeout exceeded')
    || message.includes('Transaction failed due to a write conflict');
};

const withSerializableTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw new Error("Không thể hoàn tất giao dịch dời lịch");
};

const movePackageLessonMapping = async (
  tx: Prisma.TransactionClient,
  sourceKey: string | null | undefined,
  targetKey: string | null | undefined,
  targetLearnNumber: number
) => {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;

  // Makeup là chuyển cùng bài học sang session mới: giữ nguyên các row/id
  // mapping và chỉ chuyển key, không nhân bản mapping của session đã nghỉ.
  await tx.package_lesson_mapping.updateMany({
    where: { key: sourceKey },
    data: {
      key: targetKey,
      learn_number: targetLearnNumber,
    },
  });
};

const getPackageLessonMappingSnapshot = async (
  tx: any,
  keys: Array<string | null | undefined>
) => {
  const uniqueKeys = Array.from(
    new Set(keys.filter(Boolean).map((key) => String(key)))
  );

  if (uniqueKeys.length === 0) return new Map<string, any[]>();

  const mappings = await tx.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM package_lesson_mapping
      WHERE \`key\` IN (${Prisma.join(uniqueKeys)})
    `
  ) as any[];
  const mappingByKey = new Map<string, any[]>();

  mappings.forEach((mapping: any) => {
    if (!mapping.key) return;
    const key = String(mapping.key);
    const currentMappings = mappingByKey.get(key) || [];
    currentMappings.push(mapping);
    mappingByKey.set(key, currentMappings);
  });

  return mappingByKey;
};

const replacePackageLessonMappingRows = async (
  tx: any,
  sourceMappings: any[],
  targetKey: string | null | undefined,
  targetLearnNumber: number
) => {
  if (!targetKey) return;

  await tx.package_lesson_mapping.deleteMany({
    where: { key: targetKey },
  });

  if (sourceMappings.length === 0) return;

  for (const mapping of sourceMappings) {
    await tx.$executeRaw`
      INSERT INTO package_lesson_mapping (
        package_id, course_id, lesson_id, code, learn_number, \`key\`
      ) VALUES (
        ${mapping.package_id},
        ${mapping.course_id ?? null},
        ${mapping.lesson_id},
        ${mapping.code},
        ${targetLearnNumber},
        ${targetKey}
      )
    `;
  }
};

const copySessionData = (source: any) => {
  const data: any = {};
  COPY_SESSION_FIELDS.forEach((field) => {
    data[field] = source[field];
  });
  return data;
};

const getNextLessonCount = async (
  tx: any,
  code: string,
  systemType: string | null | undefined,
  learnNumber?: number
) => {
  const latest = await tx.calendar.findFirst({
    where: {
      code,
      ...(systemType ? { system_type: systemType } : {}),
      ...(learnNumber !== undefined ? { learn_number: learnNumber } : {}),
    },
    orderBy: { lesson_count: 'desc' },
    select: { lesson_count: true },
  });

  return Number(latest?.lesson_count ?? -1) + 1;
};

const normalizePositiveInteger = (value: unknown, fieldName: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} không hợp lệ`);
  }
  return parsed;
};

const normalizeLessonCount = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("lesson_count không hợp lệ");
  }
  return parsed;
};

const lessonIdentityKey = (code: string, systemType: string, learnNumber: number) =>
  `${systemType}::${code}::${learnNumber}`;

const assertLessonCountAvailable = async (
  tx: any,
  code: string,
  systemType: string,
  learnNumber: number,
  lessonCount: number
) => {
  const existing = await tx.calendar.findFirst({
    where: {
      code,
      system_type: systemType,
      learn_number: learnNumber,
      lesson_count: lessonCount,
    },
    select: { id: true, key: true },
  });

  if (existing) {
    throw new Error(
      `Bài ${learnNumber} của khóa ${code} đã có lịch b${lessonCount + 1}${existing.key ? ` (${existing.key})` : ''}`
    );
  }
};

const prepareCalendarCreateData = async (
  tx: any,
  input: any,
  reservedCounts?: Map<string, Set<number>>
) => {
  const data = normalizeRoom(await hydrateLessonData(tx, input));
  if (!data.code) {
    throw new Error("Vui lòng cung cấp mã khóa học");
  }

  data.system_type = data.system_type || 'topclass';
  data.learn_number = normalizePositiveInteger(data.learn_number, 'learn_number');
  data.start_time = new Date(data.start_time);
  data.end_time = new Date(data.end_time);

  ensureValidTimeRange(data.start_time, data.end_time);

  const identity = lessonIdentityKey(data.code, data.system_type, data.learn_number);
  const reserved = reservedCounts?.get(identity) || new Set<number>();
  let lessonCount = normalizeLessonCount(data.lesson_count);
  const isLessonCountProvided = lessonCount !== undefined;

  if (lessonCount !== undefined) {
    if (reserved.has(lessonCount)) {
      throw new Error(`Bài ${data.learn_number} của khóa ${data.code} bị trùng lịch b${lessonCount + 1} trong danh sách tạo`);
    }
    await assertLessonCountAvailable(tx, data.code, data.system_type, data.learn_number, lessonCount);
  } else {
    lessonCount = await getNextLessonCount(tx, data.code, data.system_type, data.learn_number);
    while (reserved.has(lessonCount)) {
      lessonCount += 1;
    }
  }

  data.lesson_count = lessonCount;
  data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount);

  const existingKey = await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } });
  if (existingKey && isLessonCountProvided) {
    throw new Error(`SessionId ${data.key} đã tồn tại`);
  }

  while (!isLessonCountProvided && await tx.calendar.findFirst({ where: { key: data.key }, select: { id: true } })) {
    lessonCount += 1;
    if (reserved.has(lessonCount)) continue;
    data.lesson_count = lessonCount;
    data.key = generateKey(data.system_type, data.start_time, data.code, data.learn_number, lessonCount);
  }

  if (reservedCounts) {
    reserved.add(lessonCount);
    reservedCounts.set(identity, reserved);
  }

  return {
    calendarData: data,
  };
};

const resolvePackageLessonMappings = async (rawMappings: any) => {
  if (!Array.isArray(rawMappings) || rawMappings.length === 0) {
    throw new Error("Vui lòng khai báo ít nhất một Course ID và Lesson ID");
  }
  if (rawMappings.length > 100) {
    throw new Error("Không được khai báo quá 100 nhóm Course/Lesson");
  }

  const normalizedGroups = rawMappings.map((mapping: any, index: number) => {
    const courseId = String(mapping?.course_id ?? '').trim();
    const rawLessonIds = Array.isArray(mapping?.lesson_ids)
      ? mapping.lesson_ids
      : Array.isArray(mapping?.lesson_id)
        ? mapping.lesson_id
        : [mapping?.lesson_id];
    const lessonIds = Array.from(new Set<string>(
      rawLessonIds
        .map((lessonId: unknown) => String(lessonId ?? '').trim())
        .filter((lessonId: string) => lessonId.length > 0)
    ));

    if (!courseId) {
      throw new Error(`Nhóm mapping ${index + 1}: Vui lòng chọn Course ID`);
    }
    if (courseId.length > 50) {
      throw new Error(`Nhóm mapping ${index + 1}: Course ID vượt quá 50 ký tự`);
    }
    if (lessonIds.length === 0) {
      throw new Error(`Nhóm mapping ${index + 1}: Vui lòng nhập ít nhất một Lesson ID`);
    }
    if (lessonIds.length > 100 || lessonIds.some((lessonId) => lessonId.length > 50)) {
      throw new Error(`Nhóm mapping ${index + 1}: Lesson ID không hợp lệ`);
    }
    return { courseId, lessonIds };
  });

  const mappings: Array<{
    package_id: string;
    course_id: string;
    lesson_id: string;
  }> = [];
  const resolvedIdentities = new Set<string>();
  for (const group of normalizedGroups) {
    const packageCourses = await resolvePackagesByCourseId(group.courseId);
    for (const packageCourse of packageCourses) {
      for (const lessonId of group.lessonIds) {
        const identity = `${packageCourse.package_id}::${lessonId}`;
        if (resolvedIdentities.has(identity)) continue;
        resolvedIdentities.add(identity);
        mappings.push({
          package_id: packageCourse.package_id,
          course_id: group.courseId,
          lesson_id: lessonId,
        });
      }
    }
  }
  return mappings;
};

const createPackageLessonMappingForCalendar = async (
  tx: Prisma.TransactionClient,
  calendar: any,
  mappings: Array<{
    package_id: string;
    course_id: string;
    lesson_id: string;
  }>
) => {
  for (const mapping of mappings) {
    await tx.$executeRaw`
      INSERT INTO package_lesson_mapping (
        package_id, course_id, lesson_id, code, learn_number, \`key\`
      ) VALUES (
        ${mapping.package_id},
        ${mapping.course_id},
        ${mapping.lesson_id},
        ${calendar.code},
        ${calendar.learn_number},
        ${calendar.key}
      )
    `;
  }
};

const generateUniqueKey = async (
  tx: any,
  systemType: string,
  startTime: Date,
  code: string,
  learnNumber: number,
  lessonCount: number
) => {
  let nextLessonCount = lessonCount;
  let key = generateKey(systemType, startTime, code, learnNumber, nextLessonCount);

  while (await tx.calendar.findFirst({ where: { key } })) {
    nextLessonCount += 1;
    key = generateKey(systemType, startTime, code, learnNumber, nextLessonCount);
  }

  return { key, lesson_count: nextLessonCount };
};

/**
 * Key phát sinh do tạo lịch bù hoặc ở cuối chuỗi dời lịch vẫn thuộc bài học
 * nguồn, vì vậy giữ learn_number/lesson_count và thêm namespace `_rN`.
 * Điều này dành key `..._5` cho bài 5 thật, thay vì để một lần dời bài 4 chiếm
 * key đó và khiến bài 5 lần đầu bị sinh nhầm thành `..._5_b2`.
 */
const generateUniqueRescheduleKey = async (
  tx: any,
  systemType: string,
  startTime: Date,
  code: string,
  learnNumber: number,
  lessonCount: number
) => {
  const baseKey = generateKey(
    systemType,
    startTime,
    code,
    learnNumber,
    lessonCount
  );
  let rescheduleNumber = 1;
  let key = `${baseKey}_r${rescheduleNumber}`;

  while (await tx.calendar.findFirst({ where: { key } })) {
    rescheduleNumber += 1;
    key = `${baseKey}_r${rescheduleNumber}`;
  }

  return {
    key,
    lesson_count: lessonCount,
    reschedule_number: rescheduleNumber,
  };
};

// 1.3 & 5 Kiểm tra trùng lặp
const checkConflict = async ({
  teacher,
  channel_name,
  code,
  start_time,
  end_time,
  id,
  client = prisma,
}: {
  teacher?: string | null,
  channel_name?: string | null,
  code?: string,
  start_time: Date,
  end_time: Date,
  id?: number,
  client?: any,
}) => {
  ensureValidTimeRange(start_time, end_time);

  if (teacher) {
    const conflictTeacher = await client.calendar.findFirst({
      where: {
        teacher,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        id: id ? { not: id } : undefined
      }
    });
    if (conflictTeacher) throw new Error("Trùng lịch giáo viên");
  }

  if (channel_name) {
    const conflictRoom = await client.calendar.findFirst({
      where: {
        channel_name,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        id: id ? { not: id } : undefined
      }
    });
    if (conflictRoom) throw new Error("Trùng lịch phòng học");
  }

  if (code) {
    const conflictCourse = await client.calendar.findFirst({
      where: {
        code,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        id: id ? { not: id } : undefined
      }
    });
    if (conflictCourse) throw new Error("Hai buổi cùng khóa không được trùng thời gian");
  }
};




// 1.1. Thêm từng lịch
export const createSingle = async (data: any) => {
  const resolvedMappings = await resolvePackageLessonMappings(
    data?.package_lesson_mappings
  );
  return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
    const { calendarData } = await prepareCalendarCreateData(tx, data);

    await checkConflict({
      teacher: calendarData.teacher,
      channel_name: calendarData.channel_name,
      code: calendarData.code,
      start_time: calendarData.start_time,
      end_time: calendarData.end_time,
      client: tx,
    });

    const calendar = await tx.calendar.create({ data: calendarData });
    await createPackageLessonMappingForCalendar(tx, calendar, resolvedMappings);
    return calendar;
  }));
};

// 1.2. Thêm nhiều lịch
export const createBulk = async (config: any) => {
  // We assume frontend sends fully constructed objects in an array "calendars"
  const { calendars } = config;
  if (!calendars || !Array.isArray(calendars)) {
    throw new Error("Missing calendars array for bulk insert");
  }

  const reservedCounts = new Map<string, Set<number>>();
  const resolvedMappingsByIndex: Array<
    Awaited<ReturnType<typeof resolvePackageLessonMappings>>
  > = [];
  for (const calendar of calendars) {
    resolvedMappingsByIndex.push(
      await resolvePackageLessonMappings(calendar?.package_lesson_mappings)
    );
  }

  return await withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
    const createdCalendars = [];

    for (let index = 0; index < calendars.length; index += 1) {
      const cal = calendars[index];
      try {
        const { calendarData } = await prepareCalendarCreateData(
          tx,
          cal,
          reservedCounts
        );
        await checkConflict({
          teacher: calendarData.teacher,
          channel_name: calendarData.channel_name,
          code: calendarData.code,
          start_time: calendarData.start_time,
          end_time: calendarData.end_time,
          client: tx,
        });
        const calendar = await tx.calendar.create({ data: calendarData });
        await createPackageLessonMappingForCalendar(
          tx,
          calendar,
          resolvedMappingsByIndex[index]
        );
        createdCalendars.push(calendar);
      } catch (error: any) {
        const lessonLabel = cal.lesson_name ? ` (${cal.lesson_name})` : '';
        throw new Error(`Buổi ${index + 1}${lessonLabel}: ${error.message || 'Không thể tạo lịch học'}`);
      }
    }

    return { count: createdCalendars.length, calendars: createdCalendars };
  }));
};

const cancelWithoutMakeup = async (tx: any, current: any) => {
  return await tx.calendar.update({
    where: { id: current.id },
    data: { lesson_status: 1 },
  });
};

const cancelWithMakeup = async (tx: any, current: any, payload: any) => {
  const newSessionInput = normalizeRoom({ ...(payload.new_session || payload) });
  delete newSessionInput.mode;
  delete newSessionInput.update_mode;
  delete newSessionInput.reason;
  delete newSessionInput.change_reason;
  delete newSessionInput.course_end_time;
  const startTime = new Date(newSessionInput.start_time);
  const endTime = new Date(newSessionInput.end_time);
  const systemType = String(current.system_type || 'topclass');
  ensureNotAfterCourseEnd(endTime, payload.course_end_time);
  ensureNotBeforeDate(
    startTime,
    current.start_time,
    "Ngày học bù không được trước ngày của buổi học hiện tại"
  );

  await checkConflict({
    teacher: newSessionInput.teacher ?? current.teacher,
    channel_name: newSessionInput.channel_name ?? current.channel_name,
    code: current.code,
    start_time: startTime,
    end_time: endTime,
    client: tx,
  });

  // Lịch bù là lịch phát sinh do dời: giữ nguyên bài và số lần chiếu, đồng
  // thời dùng namespace `_rN` giống luồng dời chuỗi. `_bN` chỉ dành cho
  // trường hợp chủ động tạo thêm buổi chiếu của cùng một bài.
  const uniqueKey = await generateUniqueRescheduleKey(
    tx,
    systemType,
    startTime,
    current.code,
    current.learn_number,
    normalizeLessonCount(current.lesson_count) ?? 0
  );
  const newSessionData = {
    ...copySessionData(current),
    ...newSessionInput,
    start_time: startTime,
    end_time: endTime,
    teacher: newSessionInput.teacher ?? current.teacher,
    channel_name: newSessionInput.channel_name ?? current.channel_name,
    lesson_status: 0,
    lesson_count: uniqueKey.lesson_count,
    key: uniqueKey.key,
  };

  const [updatedCurrent, createdSession] = await Promise.all([
    tx.calendar.update({
      where: { id: current.id },
      data: { lesson_status: 1 },
    }),
    tx.calendar.create({ data: newSessionData }),
  ]);

  await movePackageLessonMapping(tx, current.key, createdSession.key, createdSession.learn_number);

  return { canceled_session: updatedCurrent, created_session: createdSession };
};

const rescheduleFollowing = async (tx: any, current: any, payload: any) => {
  const newSessionInput = normalizeRoom({ ...(payload.new_session || {}) });
  if (!newSessionInput.start_time || !newSessionInput.end_time) {
    throw new Error("Vui lòng cung cấp new_session.start_time và new_session.end_time");
  }

  const startTime = new Date(newSessionInput.start_time);
  const endTime = new Date(newSessionInput.end_time);
  const systemType = String(current.system_type || 'topclass');
  const lastCourseSession = await tx.calendar.findFirst({
    where: {
      code: current.code,
      system_type: current.system_type,
    },
    orderBy: [{ end_time: 'desc' }, { id: 'desc' }],
    select: { end_time: true },
  });
  ensureNotBeforeDate(
    startTime,
    lastCourseSession?.end_time ?? current.end_time,
    "Ngày buổi mới không được trước ngày kết thúc khóa"
  );

  await checkConflict({
    teacher: newSessionInput.teacher ?? current.teacher,
    channel_name: newSessionInput.channel_name ?? current.channel_name,
    code: current.code,
    start_time: startTime,
    end_time: endTime,
    client: tx,
  });

  const followings = await tx.calendar.findMany({
    where: {
      code: current.code,
      system_type: current.system_type,
      start_time: { gt: current.start_time },
      OR: [
        { lesson_status: null },
        { lesson_status: { not: 1 } },
      ],
    },
    orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
  });

  const allSessions = [current, ...followings];
  // Snapshot trước khi dời: 1 key có thể map nhiều lesson_id/package_id.
  const packageLessonMappingsByKey = await getPackageLessonMappingSnapshot(
    tx,
    allSessions.map((session) => session.key)
  );
  const updatedCurrent = await tx.calendar.update({
    where: { id: current.id },
    // Buổi cũ vẫn là lịch sử của bài đã xếp; chỉ đánh dấu nghỉ.
    data: { lesson_status: 1 },
  });

  // package_lesson_mapping chỉ phản ánh key hiện hành của lesson. Snapshot ở
  // trên đã giữ dữ liệu cần thiết để dịch chuỗi; xóa mapping của key nghỉ để
  // một lesson_id không đồng thời trỏ vào cả lịch cũ và lịch mới.
  if (current.key) {
    await tx.package_lesson_mapping.deleteMany({
      where: { key: current.key },
    });
  }

  const shiftedSessions = [];
  for (let i = 0; i < followings.length; i++) {
    const targetSession = followings[i];
    const sourceSession = allSessions[i];
    const updateData = {
      ...copySessionData(sourceSession),
      lesson_status: 0,
    };

    const shiftedSession = await tx.calendar.update({
      where: { id: targetSession.id },
      data: updateData,
    });

    await replacePackageLessonMappingRows(
      tx,
      packageLessonMappingsByKey.get(String(sourceSession.key)) || [],
      targetSession.key,
      sourceSession.learn_number
    );
    shiftedSessions.push(shiftedSession);
  }

  const lastSource = allSessions[allSessions.length - 1];
  const uniqueKey = await generateUniqueRescheduleKey(
    tx,
    systemType,
    startTime,
    current.code,
    lastSource.learn_number,
    normalizeLessonCount(lastSource.lesson_count) ?? 0
  );
  const newSessionData = {
    ...copySessionData(lastSource),
    ...newSessionInput,
    start_time: startTime,
    end_time: endTime,
    teacher: newSessionInput.teacher ?? lastSource.teacher,
    channel_name: newSessionInput.channel_name ?? lastSource.channel_name,
    lesson_status: 0,
    lesson_count: uniqueKey.lesson_count,
    key: uniqueKey.key,
  };

  const createdSession = await tx.calendar.create({ data: newSessionData });
  await replacePackageLessonMappingRows(
    tx,
    packageLessonMappingsByKey.get(String(lastSource.key)) || [],
    createdSession.key,
    createdSession.learn_number
  );

  return {
    canceled_session: updatedCurrent,
    shifted_sessions: shiftedSessions,
    created_session: createdSession,
  };
};

export const rescheduleSession = async (
  id: number,
  payload: any,
  changeActor?: CalendarChangeActor
) => {
  const mode = payload.mode || payload.update_mode || 'cancel';
  const reason = normalizeChangeReason(payload);
  const actor = normalizeChangeActor(changeActor);

  return await withCalendarTriggerErrorHint(() => withSerializableTransaction(async (tx) => withManualHocmaiQueue(tx, async () => {
    const operationId = crypto.randomUUID();
    // Đọc và validate bên trong transaction để không dùng snapshot cũ khi có
    // hai yêu cầu cùng dời lịch của một khóa.
    const current = await tx.calendar.findUnique({ where: { id } });
    if (!current) throw new Error("Not found");
    assertCanUpdateSession(current);

    let action: 'cancel' | 'makeup' | 'following';
    let result: any;
    let beforeFollowingSessions: any[] = [];

    if (['cancel', 'cancel_only', 'no_makeup', 'no_make_up'].includes(mode)) {
      action = 'cancel';
      result = await cancelWithoutMakeup(tx, current);
    } else if (['makeup', 'make_up', 'compensate'].includes(mode)) {
      action = 'makeup';
      result = await cancelWithMakeup(tx, current, payload);
    } else if (mode === 'following') {
      action = 'following';
      beforeFollowingSessions = await tx.calendar.findMany({
        where: {
          code: current.code,
          system_type: current.system_type,
          start_time: { gt: current.start_time },
          OR: [
            { lesson_status: null },
            { lesson_status: { not: 1 } },
          ],
        },
        orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
      });
      result = await rescheduleFollowing(tx, current, payload);
    } else {
      throw new Error("Invalid reschedule mode");
    }

    const affectedSessions = action === 'cancel'
      ? [result]
      : action === 'makeup'
        ? [result.canceled_session, result.created_session]
        : [
            result.canceled_session,
            ...(result.shifted_sessions || []),
            result.created_session,
          ];

    await writeCalendarChangeLog(tx, {
      operationId,
      action,
      current,
      reason,
      actor,
      beforeData: {
        source_session: current,
        following_sessions: beforeFollowingSessions,
      },
      afterData: result,
      affectedSessions,
      newKey: result?.created_session?.key,
    });

    await enqueueRescheduleSync(tx, action, result, operationId);

    return result;
  })));
};

// 2.1 & 2.2 Sửa lịch
export const updateSchedule = async (
  id: number,
  data: any,
  updateMode: string,
  changeActor?: CalendarChangeActor
) => {
  if (updateMode && updateMode !== 'current') {
    return await rescheduleSession(id, { ...data, mode: updateMode }, changeActor);
  }

  normalizeRoom(data);
  delete data.key;
  delete data.new_session;

  const current = await prisma.calendar.findUnique({ where: { id } });
  if (!current) throw new Error("Not found");
  assertCanUpdateSession(current);
  delete data.allow_past;

  if (data.start_time) data.start_time = new Date(data.start_time);
  if (data.end_time) data.end_time = new Date(data.end_time);

  if (data.start_time || data.end_time || data.teacher || data.channel_name) {
    await checkConflict({
      teacher: data.teacher ?? current.teacher,
      channel_name: data.channel_name ?? current.channel_name,
      code: current.code,
      start_time: data.start_time ?? current.start_time,
      end_time: data.end_time ?? current.end_time,
      id,
    });
  }

  return await withCalendarTriggerErrorHint(() => prisma.calendar.update({ where: { id }, data }));
};

// 2.3 Nghỉ không dời
export const cancelSession = async (
  id: number,
  payload: any,
  changeActor?: CalendarChangeActor
) => rescheduleSession(id, { ...payload, mode: 'cancel' }, changeActor);

export const deleteSession = async (id: number) =>
  withCalendarTriggerErrorHint(() => prisma.$transaction(async (tx) => {
    const current = await tx.calendar.findUnique({ where: { id } });
    if (!current) throw new Error("Not found");
    assertCanUpdateSession(current);

    if (current.key) {
      await tx.package_lesson_mapping.deleteMany({
        where: { key: current.key },
      });
    }

    return tx.calendar.delete({ where: { id } });
  }));

const CALENDAR_SYSTEM_TYPES = ['topclass', 'event', 'phaken', 'topuni'];
const CALENDAR_SORT_FIELDS = [
  'id',
  'code',
  'learn_number',
  'subject',
  'teacher',
  'start_time',
  'end_time',
  'lesson_status',
  'system_type',
  'created_at',
];

const normalizeString = (value: unknown) => {
  if (Array.isArray(value)) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeNumber = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} không hợp lệ`);
  }
  return parsed;
};

const normalizeDate = (value: unknown, fieldName: string) => {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} không hợp lệ`);
  }

  return date;
};

const normalizeSortOrder = (value: unknown): Prisma.SortOrder => {
  const order = normalizeString(value);
  return order === 'desc' || order === 'descend' ? 'desc' : 'asc';
};

// 3. Lấy danh sách lịch
export const getCalendar = async (query: any) => {
  const page = normalizeNumber(query.page, 'page') ?? 1;
  const limit = normalizeNumber(query.limit, 'limit') ?? 10;

  if (page < 1) throw new Error('page phải lớn hơn 0');
  if (limit < 1 || limit > 100) throw new Error('limit phải nằm trong khoảng 1-100');

  const skip = (page - 1) * limit;
  const take = limit;

  const keyword = normalizeString(query.keyword);
  const code = normalizeString(query.code);
  const exactCode = normalizeString(query.code_exact);
  const teacher = normalizeString(query.teacher);
  const subject = normalizeString(query.subject);
  const classroom = normalizeString(query.classroom);
  const systemType = normalizeString(query.system_type);
  const lessonStatus = normalizeNumber(query.lesson_status, 'lesson_status');
  const startTime = normalizeDate(query.start_time, 'start_time');
  const endTime = normalizeDate(query.end_time, 'end_time');
  const sortFields = (normalizeString(query.sort_by) || '')
    .split(',')
    .map((field) => field.trim())
    .filter((field) => CALENDAR_SORT_FIELDS.includes(field));
  const requestedSortOrders = (normalizeString(query.sort_order) || '')
    .split(',')
    .map((order) => normalizeSortOrder(order));

  if (systemType && !CALENDAR_SYSTEM_TYPES.includes(systemType)) {
    throw new Error('system_type không hợp lệ');
  }

  if (lessonStatus !== undefined && ![0, 1, 2].includes(lessonStatus)) {
    throw new Error('lesson_status không hợp lệ');
  }

  if (startTime && endTime && startTime > endTime) {
    throw new Error('Khoảng thời gian không hợp lệ');
  }

  const where: Prisma.calendarWhereInput = {};

  if (keyword) {
    where.OR = [
      { code: { contains: keyword } },
      { subject: { contains: keyword } },
      { teacher: { contains: keyword } },
      { lesson_name: { contains: keyword } },
      { lesson_link: { contains: keyword } },
      { channel_name: { contains: keyword } },
    ];
  }
  if (exactCode) {
    where.code = exactCode;
  } else if (code) {
    where.code = { contains: code };
  }
  if (teacher) where.teacher = { contains: teacher };
  if (subject) where.subject = { contains: subject };
  if (classroom) where.channel_name = { contains: classroom };
  if (systemType) where.system_type = systemType as any;
  if (lessonStatus !== undefined) where.lesson_status = lessonStatus;
  if (startTime || endTime) {
    where.start_time = {
      ...(startTime ? { gte: startTime } : {}),
      ...(endTime ? { lte: endTime } : {}),
    };
  }

  const orderBy: Prisma.calendarOrderByWithRelationInput[] = sortFields.length
    ? sortFields.map((field, index) => ({
        [field]: requestedSortOrders[index] ?? 'asc',
      }))
    : [{ start_time: 'asc' }];

  const [total, data] = await Promise.all([
    prisma.calendar.count({ where }),
    prisma.calendar.findMany({
      where,
      skip,
      take,
      orderBy,
    }),
  ]);

  return { total, page, limit, data };
};

export const getCalendarRowsForExport = async (rawIds?: unknown) => {
  const ids = String(rawIds ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  const calendars = await prisma.calendar.findMany({
    where: ids.length ? { id: { in: ids } } : {},
    orderBy: [{ start_time: 'asc' }, { id: 'asc' }],
  });
  const keys = calendars
    .map((calendar) => calendar.key)
    .filter((key): key is string => Boolean(key));
  const mappings = keys.length
    ? await prisma.package_lesson_mapping.findMany({
        where: { key: { in: keys } },
        orderBy: [{ course_id: 'asc' }, { lesson_id: 'asc' }],
      })
    : [];

  const mappingsByKey = new Map<string, Map<string, string[]>>();
  mappings.forEach((mapping) => {
    if (!mapping.key || !mapping.course_id) return;
    const byCourse = mappingsByKey.get(mapping.key) ?? new Map<string, string[]>();
    const lessonIds = byCourse.get(mapping.course_id) ?? [];
    if (!lessonIds.includes(mapping.lesson_id)) lessonIds.push(mapping.lesson_id);
    byCourse.set(mapping.course_id, lessonIds);
    mappingsByKey.set(mapping.key, byCourse);
  });

  return calendars.map((calendar) => ({
    system_type: calendar.system_type,
    code: calendar.code,
    learn_number: calendar.learn_number,
    lesson_count: calendar.lesson_count ?? 0,
    subject: calendar.subject,
    teacher: calendar.teacher,
    lesson_name: calendar.lesson_name,
    start_time: calendar.start_time.toISOString(),
    end_time: calendar.end_time.toISOString(),
    channel_name: calendar.channel_name,
    lesson_status: calendar.lesson_status ?? 0,
    package_lesson_mappings: Array.from(
      mappingsByKey.get(calendar.key || '')?.entries() ?? []
    ).map(([courseId, lessonIds]) => `${courseId}:${lessonIds.join('|')}`).join(';'),
  }));
};


// Sửa nhiều lịch (Bulk Update)
export const updateBulk = async (config: any) => {
  const { ids, config_mode, update_data } = config;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new Error("Missing or invalid ids array for bulk update");
  }

  // 1. CẤU HÌNH CHUNG: Tất cả các lịch chọn được cập nhật bằng 1 data chung
  if (config_mode === 'common') {
    if (!update_data) throw new Error("Missing update_data for common bulk update");

    const dataToUpdate: any = {};
    if (update_data.teacher) dataToUpdate.teacher = update_data.teacher;
    if (update_data.room) dataToUpdate.channel_name = update_data.room;

    // LƯU Ý QUAN TRỌNG: 
    // Nếu đổi thời gian chung (ví dụ từ 19:00 -> 21:00) cho nhiều ngày khác nhau, 
    // ta KHÔNG THỂ dùng prisma.calendar.updateMany được, vì mỗi dòng có start_time/end_time thuộc ngày khác nhau.
    // Nếu có đổi thời gian, bắt buộc phải duyệt qua từng record để giữ ngày cũ và chỉ đắp giờ mới vào.
    if (update_data.start_time || update_data.end_time) {
      return await prisma.$transaction(async (tx) => {
        const results = [];
        for (const idStr of ids) {
          const id = Number(idStr);
          const current = await tx.calendar.findUnique({ where: { id } });
          if (!current) continue;
          assertCanUpdateSession(current);

          let newStart = current.start_time;
          let newEnd = current.end_time;

          // Thay thế giờ/phút, giữ nguyên ngày/tháng/năm
          if (update_data.start_time) {
            const [hours, minutes] = update_data.start_time.split(':');
            newStart = new Date(current.start_time);
            newStart.setHours(Number(hours), Number(minutes), 0, 0);
          }

          if (update_data.end_time) {
            const [hours, minutes] = update_data.end_time.split(':');
            newEnd = new Date(current.end_time);
            newEnd.setHours(Number(hours), Number(minutes), 0, 0);
          }

          // Check conflict
          await checkConflict({
            teacher: dataToUpdate.teacher || current.teacher,
            start_time: newStart,
            end_time: newEnd,
            id
          });

          const updated = await tx.calendar.update({
            where: { id },
            data: {
              ...dataToUpdate,
              start_time: newStart,
              end_time: newEnd,
            }
          });
          results.push(updated);
        }
        return results;
      });
    }

    // Dù chỉ đổi giáo viên/phòng vẫn phải khóa và kiểm tra từng buổi để
    // không cập nhật lịch đã bắt đầu.
    return await prisma.$transaction(async (tx) => {
      const normalizedIds = ids.map((id: string | number) => Number(id));
      const sessions = await tx.calendar.findMany({
        where: { id: { in: normalizedIds } },
      });
      sessions.forEach(assertCanUpdateSession);

      return tx.calendar.updateMany({
        where: { id: { in: normalizedIds } },
        data: dataToUpdate,
      });
    });
  }


  // 2. CẤU HÌNH RIÊNG: Mỗi bài học có data cập nhật riêng
  if (config_mode === 'separate') {
    if (!update_data || !Array.isArray(update_data)) {
      throw new Error("Missing or invalid update_data array for separate bulk update");
    }

    return await prisma.$transaction(async (tx) => {
      const results = [];
      for (const item of update_data) {
        const id = Number(item.id);
        const current = await tx.calendar.findUnique({ where: { id } });
        if (!current) continue;
        assertCanUpdateSession(current);

        const dataToUpdate: any = {};
        if (item.teacher) dataToUpdate.teacher = item.teacher;
        if (item.room) dataToUpdate.channel_name = item.room;

        let newStart = current.start_time;
        let newEnd = current.end_time;

        if (item.start_time) {
          const [hours, minutes] = item.start_time.split(':');
          newStart = new Date(current.start_time);
          newStart.setHours(Number(hours), Number(minutes), 0, 0);
        }

        if (item.end_time) {
          const [hours, minutes] = item.end_time.split(':');
          newEnd = new Date(current.end_time);
          newEnd.setHours(Number(hours), Number(minutes), 0, 0);
        }

        if (item.start_time || item.end_time) {
          dataToUpdate.start_time = newStart;
          dataToUpdate.end_time = newEnd;
        }

        // Check conflict
        await checkConflict({
          teacher: dataToUpdate.teacher || current.teacher,
          start_time: newStart,
          end_time: newEnd,
          id
        });

        const updated = await tx.calendar.update({
          where: { id },
          data: dataToUpdate
        });
        results.push(updated);
      }
      return results;
    });
  }

  throw new Error("Invalid config_mode");
};
