import { reconcileCalendarMappingsAndEnqueue, withManualHocmaiQueue, enqueueCalendarSync } from './hocmai-sync-queue.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  fetchHocmaiCourseOutlines,
  HmoCourseOutlineError,
  PackageCoursePair,
} from '../../integrations/hocmai-course-outline.service';
import { resolvePackagesByCourseId } from '../../integrations/package-course-sheet.service';
import {
  CalendarImportError,
  CalendarImportRow,
  CalendarImportSummary,
  HmoCourseOutlineResult,
  ResolvedCalendarImportRow,
  ResolvedPackageLessonMapping,
} from './calendar-import.types';
import {
  createValidatedCalendarImport,
  createValidatedInternalCalendarImport,
} from './livestream.service';
import { enqueueManyCalendarTeamsNotifications } from '../teams-notifications';

type RowWithPackages = CalendarImportRow & {
  packageIds: string[];
  packageCoursePairs?: PackageCoursePair[];
};

const pairKey = (packageId: string, courseId: string) =>
  `${packageId}::${courseId}`;

const getRowPackageCoursePairs = (row: RowWithPackages) => (
  row.packageCoursePairs
  ?? row.packageIds.flatMap((packageId) => (
    row.courseIds.map((courseId) => ({ packageId, courseId }))
  ))
);

const mappingScheduleKey = (
  mapping: ResolvedPackageLessonMapping,
  row: CalendarImportRow
) => [
  mapping.package_id,
  mapping.course_id,
  mapping.lesson_id,
  new Date(row.calendar.start_time).getTime(),
  new Date(row.calendar.end_time).getTime(),
].join('::');

const unique = (values: string[]) => Array.from(new Set(values));

const normalizeTeachingIdentifier = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ');

const splitAssistantIdentifiers = (value: unknown) => Array.from(new Set(
  String(value ?? '')
    .split(/[;,]/)
    .map(normalizeTeachingIdentifier)
    .filter(Boolean)
));

export const resolveCalendarImportFieldValue = (
  currentValue: unknown,
  importedValue: unknown,
  mode: 'skip' | 'overwrite'
) => {
  const hasCurrentValue = currentValue !== undefined
    && currentValue !== null
    && String(currentValue).trim() !== '';
  const hasImportedValue = importedValue !== undefined
    && importedValue !== null
    && String(importedValue).trim() !== '';
  // Ô trống trong file không dùng để xóa dữ liệu. Chế độ skip chỉ bổ sung
  // những trường đang trống; overwrite thay dữ liệu khi file có giá trị.
  if (!hasImportedValue) return hasCurrentValue ? currentValue : null;
  if (mode === 'skip' && hasCurrentValue) return currentValue;
  return importedValue;
};

export const shouldResolveCalendarImportField = (
  currentValue: unknown,
  importedValue: unknown,
  mode: 'skip' | 'overwrite'
) => Boolean(String(importedValue ?? '').trim()) && (
  mode === 'overwrite' || !String(currentValue ?? '').trim()
);

const addError = (
  errors: CalendarImportError[],
  error: CalendarImportError
) => {
  const identity = [
    error.row,
    error.errorCode,
    error.field,
    error.message,
    error.packageId,
    error.courseId,
    error.lessonId,
    error.duplicateWithRow,
  ].join('::');
  if (!errors.some((item) => [
    item.row,
    item.errorCode,
    item.field,
    item.message,
    item.packageId,
    item.courseId,
    item.lessonId,
    item.duplicateWithRow,
  ].join('::') === identity)) {
    errors.push(error);
  }
};

const buildSummary = (
  rows: RowWithPackages[],
  errors: CalendarImportError[],
  pairCount: number,
  hmoRequests: number
): CalendarImportSummary => {
  const invalidRowNumbers = new Set(
    errors
      .filter((error) => error.row > 1)
      .map((error) => error.row)
  );
  const hasGlobalError = errors.some((error) => error.row <= 1);
  const invalidRows = hasGlobalError ? rows.length : invalidRowNumbers.size;
  return {
    totalRows: rows.length,
    validRows: Math.max(0, rows.length - invalidRows),
    invalidRows,
    uniquePackageIds: unique(rows.flatMap((row) => row.packageIds)).length,
    uniqueCourseIds: unique(rows.flatMap((row) => row.courseIds)).length,
    uniqueLessonIds: unique(rows.flatMap((row) => row.lessonIds)).length,
    uniquePackageCoursePairs: pairCount,
    hmoRequests,
  };
};

/**
 * File import dùng tên hiển thị để người vận hành dễ quản lý, còn calendar
 * luôn lưu username. Username từ format Email TG cũ vẫn được hỗ trợ.
 */
export const resolveCalendarImportTeachers = async (
  rows: CalendarImportRow[],
  existingByKey = new Map<string, {teacher: string | null}>(),
) => {
  const errors: CalendarImportError[] = [];
  const supplied = rows.filter(row => String(row.calendar.teacher || '').trim());
  if (!supplied.length) return errors;
  const profiles = await prisma.teacher_profiles.findMany({
    where: {can_view_stream_key: 1, status: 1},
    select: {username: true, display_name: true},
  });
  for (const row of supplied) {
    const identifier = normalizeTeachingIdentifier(row.calendar.teacher).toLowerCase();
    const username = profiles.find(profile => normalizeTeachingIdentifier(profile.username).toLowerCase() === identifier);
    const matches = username ? [username] : profiles.filter(profile => normalizeTeachingIdentifier(profile.display_name).toLowerCase() === identifier);
    if (matches.length !== 1) {
      addError(errors, {row:row.row, field:'Tên GV', errorCode:'INVALID_ROW', message: matches.length
        ? `Tên giáo viên "${row.calendar.teacher}" trùng nhiều tài khoản; hãy nhập tài khoản giáo viên`
        : `Không tìm thấy giáo viên đang hoạt động có tên hoặc tài khoản "${row.calendar.teacher}"`});
      continue;
    }
    const profile = matches[0];
    const current = existingByKey.get(row.sourceKey || '');
    // Keep an unchanged legacy username while matching the bulk-create convention.
    row.calendar.teacher = current?.teacher === profile.username ? current.teacher : profile.display_name || profile.username;
  }
  return errors;
};

const resolveCalendarImportAssistants = async (rows: CalendarImportRow[]) => {
  const errors: CalendarImportError[] = [];
  const rowsWithAssistants = rows.map((row) => ({
    row,
    identifiers: splitAssistantIdentifiers(row.calendar.assistant_teacher),
  })).filter((item) => item.identifiers.length > 0);
  if (!rowsWithAssistants.length) return errors;

  const profiles = await prisma.teacher_profiles.findMany({
    where: { can_view_stream_key: 0, status: 1 },
    select: { username: true, display_name: true },
    orderBy: { id: 'asc' },
  });
  const usernameMap = new Map<string, typeof profiles[number]>();
  const displayNameMap = new Map<string, typeof profiles>();
  profiles.forEach((profile) => {
    usernameMap.set(normalizeTeachingIdentifier(profile.username).toLowerCase(), profile);
    const displayName = normalizeTeachingIdentifier(profile.display_name).toLowerCase();
    if (!displayName) return;
    const matches = displayNameMap.get(displayName) ?? [];
    matches.push(profile);
    displayNameMap.set(displayName, matches);
  });

  rowsWithAssistants.forEach(({ row, identifiers }) => {
    const resolvedUsernames: string[] = [];
    identifiers.forEach((identifier) => {
      const normalized = identifier.toLowerCase();
      const usernameMatch = usernameMap.get(normalized);
      const matches = usernameMatch ? [usernameMatch] : (displayNameMap.get(normalized) ?? []);
      if (!matches.length) {
        addError(errors, {
          row: row.row,
          field: 'Trợ giảng',
          errorCode: 'INVALID_ROW',
          message: `Không tìm thấy trợ giảng đang hoạt động có tên "${identifier}"`,
        });
        return;
      }
      if (matches.length > 1) {
        addError(errors, {
          row: row.row,
          field: 'Trợ giảng',
          errorCode: 'INVALID_ROW',
          message: `Tên trợ giảng "${identifier}" trùng nhiều tài khoản; hãy nhập tài khoản vào cột Trợ giảng`,
        });
        return;
      }
      resolvedUsernames.push(matches[0].username);
    });
    row.calendar.assistant_teacher = Array.from(new Set(resolvedUsernames)).join(',') || undefined;
  });

  return errors;
};

const validateInternalLessonRows = async (
  rows: CalendarImportRow[],
  ignoredCalendarKeyByRow = new Map<number, string>()
) => {
  const errors: CalendarImportError[] = [];
  const codes = unique(rows.map((row) => row.calendar.code));
  const lessons = codes.length
    ? await prisma.$queryRaw<Array<{
      id: bigint;
      subject_code: string;
      learn_number: number;
      system_type: 'topclass' | 'topuni';
      subject_name: string;
      lesson_name: string;
    }>>(Prisma.sql`
      SELECT id, subject_code, learn_number, system_type, subject_name, lesson_name
      FROM lessons
      WHERE status <> 0
        AND subject_code IN (${Prisma.join(codes)})
    `)
    : [];
  const programCodes = new Set(lessons.map((lesson) => lesson.subject_code));
  const lessonByIdentity = new Map(lessons.map((lesson) => [
    `${lesson.subject_code}::${lesson.learn_number}`,
    lesson,
  ]));
  codes.forEach((code) => {
    if (programCodes.has(code)) return;
    const row = rows.find((item) => item.calendar.code === code)!;
    addError(errors, {
      row: row.row, field: 'code', errorCode: 'INVALID_ROW',
      message: `Chương trình ${code} chưa tồn tại. Vui lòng thêm chương trình trước khi import lịch.`,
    });
  });

  const firstRowsBySchedule = new Map<string, number>();
  rows.forEach((row) => {
    delete row.calendar.skip_teacher_profile_validation;
    const lesson = lessonByIdentity.get(`${row.calendar.code}::${row.calendar.learn_number}`);
    if (programCodes.has(row.calendar.code) && !lesson) {
      addError(errors, {
        row: row.row, field: 'learn_number', errorCode: 'LESSON_NOT_FOUND',
        message: `Chương trình ${row.calendar.code} chưa có Bài ${row.calendar.learn_number}`,
      });
    } else if (lesson) {
      row.calendar.session_id = lesson.id;
      const baseName = String(lesson.lesson_name || '').trim();
      const originalName = String(row.calendar.lesson_name || '').trim() || baseName;
      const importedName = `${row.lessonNamePrefix || ''}${originalName}${row.lessonNameSuffix || ''}`.trim();
      row.calendar.lesson_name = importedName;
      if (importedName.length > 400) addError(errors, {row:row.row,field:'Tên bài giảng',errorCode:'INVALID_ROW',message:'Tên bài sau khi thêm tiền tố/hậu tố không được vượt quá 400 ký tự'});
      if (!baseName || !importedName.includes(baseName)) addError(errors, {
        row: row.row, field: 'Tên bài giảng', errorCode: 'INVALID_ROW',
        message: `Giữ nguyên tên bài gốc "${baseName}"; chỉ được thêm hoặc sửa tiền tố/hậu tố`,
      });
      if (!ignoredCalendarKeyByRow.has(row.row) && String(row.calendar.subject || '').trim() !== String(lesson.subject_name || '').trim()) addError(errors, {
        row: row.row, field: 'Môn', errorCode: 'INVALID_ROW',
        message: `Môn phải giữ nguyên theo chương trình (${lesson.subject_name})`,
      });
      if (lesson.system_type !== row.calendar.system_type) {
        addError(errors, {
          row: row.row, field: 'system_type', errorCode: 'INVALID_ROW',
          message: `system_type không khớp với chương trình ${row.calendar.code} (${lesson.system_type})`,
        });
      }
    }
    const scheduleKey = [row.calendar.code, row.calendar.learn_number,
      new Date(row.calendar.start_time).getTime(), new Date(row.calendar.end_time).getTime()].join('::');
    const firstRow = firstRowsBySchedule.get(scheduleKey);
    if (firstRow !== undefined) {
      addError(errors, {
        row: row.row, field: 'calendar', errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
        duplicateWithRow: firstRow, message: `Lịch bị trùng với dòng ${firstRow}`,
      });
    } else firstRowsBySchedule.set(scheduleKey, row.row);
  });

  if (!errors.length) {
    const minStart = new Date(Math.min(...rows.map((row) => new Date(row.calendar.start_time).getTime())));
    const maxEnd = new Date(Math.max(...rows.map((row) => new Date(row.calendar.end_time).getTime())));
    const existing = await prisma.calendar.findMany({
      where: { code: { in: codes }, start_time: { lte: maxEnd }, end_time: { gte: minStart } },
      select: { id: true, key: true, code: true, learn_number: true, start_time: true, end_time: true },
    });
    const existingKeys = new Map<string, Set<string>>();
    existing.forEach((item) => {
      const identity = [item.code, item.learn_number,
        item.start_time.getTime(), item.end_time.getTime()].join('::');
      const keys = existingKeys.get(identity) ?? new Set<string>();
      keys.add(item.key || `calendar-id:${item.id}`);
      existingKeys.set(identity, keys);
    });
    rows.forEach((row) => {
      const key = [row.calendar.code, row.calendar.learn_number,
        new Date(row.calendar.start_time).getTime(), new Date(row.calendar.end_time).getTime()].join('::');
      const ignoredKey = ignoredCalendarKeyByRow.get(row.row);
      const conflictingKeys = existingKeys.get(key);
      if (conflictingKeys && (
        conflictingKeys.size > (ignoredKey && conflictingKeys.has(ignoredKey) ? 1 : 0)
      )) addError(errors, {
        row: row.row, field: 'calendar', errorCode: 'DUPLICATE_SCHEDULE_IN_DATABASE',
        message: `Lịch Bài ${row.calendar.learn_number} của ${row.calendar.code} đã tồn tại`,
      });
    });
  }

  return errors;
};

const resolveMissingPackages = async (
  rows: CalendarImportRow[]
): Promise<{
  rows: RowWithPackages[];
  errors: CalendarImportError[];
}> => {
  const errors: CalendarImportError[] = [];
  const courseIds = unique(
    rows
      .filter((row) => row.packageIds.length === 0)
      .flatMap((row) => row.courseIds)
  );
  const packagesByCourse = new Map<string, string[]>();

  await Promise.all(courseIds.map(async (courseId) => {
    try {
      const mappings = await resolvePackagesByCourseId(courseId);
      packagesByCourse.set(
        courseId,
        unique(mappings.map((mapping) => mapping.package_id))
      );
    } catch {
      packagesByCourse.set(courseId, []);
    }
  }));

  const resolvedRows = rows.map((row) => {
    if (row.packageIds.length) return row as RowWithPackages;
    const packageCoursePairs = row.courseIds.flatMap((courseId) => (
      (packagesByCourse.get(courseId) ?? []).map((packageId) => ({
        packageId,
        courseId,
      }))
    ));
    const packageIds = unique(packageCoursePairs.map((pair) => pair.packageId));
    if (!packageIds.length) {
      addError(errors, {
        row: row.row,
        field: 'ID package',
        errorCode: 'PACKAGE_NOT_FOUND',
        message: 'Không xác định được Package ID từ các Course ID trong dòng',
      });
    }
    return { ...row, packageIds, packageCoursePairs };
  });

  return { rows: resolvedRows, errors };
};

export const buildUniquePackageCoursePairs = (rows: RowWithPackages[]) => {
  const pairs = new Map<string, PackageCoursePair>();
  rows.forEach((row) => {
    getRowPackageCoursePairs(row).forEach(({ packageId, courseId }) => {
      pairs.set(pairKey(packageId, courseId), { packageId, courseId });
    });
  });
  return Array.from(pairs.values());
};

export const validateCalendarImportOutlines = (
  rows: RowWithPackages[],
  requestedPairs: PackageCoursePair[],
  outlineResults: HmoCourseOutlineResult[]
) => {
  const errors: CalendarImportError[] = [];
  const requestedKeys = new Set(
    requestedPairs.map((pair) => pairKey(pair.packageId, pair.courseId))
  );
  const resultByPair = new Map<string, HmoCourseOutlineResult>();

  outlineResults.forEach((result) => {
    const key = pairKey(result.packageId, result.courseId);
    if (requestedKeys.has(key)) resultByPair.set(key, result);
  });

  const missingPairs = requestedPairs.filter(
    (pair) => !resultByPair.has(pairKey(pair.packageId, pair.courseId))
  );
  missingPairs.forEach((pair) => {
    rows
      .filter((row) => getRowPackageCoursePairs(row).some((rowPair) => (
        rowPair.packageId === pair.packageId
        && rowPair.courseId === pair.courseId
      )))
      .forEach((row) => addError(errors, {
        row: row.row,
        field: 'HMO',
        errorCode: 'HMO_INVALID_RESPONSE',
        packageId: pair.packageId,
        courseId: pair.courseId,
        message: `HMO không trả kết quả cho Package ${pair.packageId} / Course ${pair.courseId}`,
      }));
  });

  const allHmoLessonIds = new Set(
    outlineResults.flatMap((result) => result.lessons.map((lesson) => lesson.lessonId))
  );
  const resolvedRows: ResolvedCalendarImportRow[] = [];

  rows.forEach((row) => {
    const rowResults = getRowPackageCoursePairs(row)
      .map(({ packageId, courseId }) => (
        resultByPair.get(pairKey(packageId, courseId))
      ))
      .filter((result): result is HmoCourseOutlineResult => Boolean(result));
    const validResults = rowResults.filter((result) => result.exists);

    row.packageIds.forEach((packageId) => {
      if (!validResults.some((result) => result.packageId === packageId)) {
        addError(errors, {
          row: row.row,
          field: 'ID package',
          errorCode: 'PACKAGE_NOT_FOUND',
          packageId,
          message: `Package ID ${packageId} không tồn tại trên HMO`,
        });
      }
    });
    row.courseIds.forEach((courseId) => {
      if (!validResults.some((result) => result.courseId === courseId)) {
        addError(errors, {
          row: row.row,
          field: 'ID course',
          errorCode: 'COURSE_NOT_FOUND',
          courseId,
          message: `Course ID ${courseId} không tồn tại trên HMO`,
        });
      }
    });

    const mappings: ResolvedPackageLessonMapping[] = [];
    row.lessonIds.forEach((lessonId) => {
      const matchedResults = validResults.filter((result) =>
        result.lessons.some((lesson) => lesson.lessonId === lessonId)
      );
      if (!matchedResults.length) {
        const belongsToAnotherContext = allHmoLessonIds.has(lessonId);
        addError(errors, {
          row: row.row,
          field: 'ID Bài giảng',
          errorCode: belongsToAnotherContext
            ? 'LESSON_NOT_IN_PACKAGE_COURSE'
            : 'LESSON_NOT_FOUND',
          lessonId,
          message: belongsToAnotherContext
            ? `Lesson ${lessonId} không thuộc Package/Course trong dòng`
            : `Lesson ID ${lessonId} không tồn tại trên HMO`,
        });
        return;
      }

      matchedResults.forEach((result) => {
        mappings.push({
          package_id: result.packageId,
          course_id: result.courseId,
          lesson_id: lessonId,
        });
      });
    });

    resolvedRows.push({
      ...row,
      mappings: Array.from(new Map(
        mappings.map((mapping) => [
          `${mapping.package_id}::${mapping.course_id}::${mapping.lesson_id}`,
          mapping,
        ])
      ).values()),
    });
  });

  const firstRowsBySchedule = new Map<string, number>();
  resolvedRows.forEach((row) => {
    row.mappings.forEach((mapping) => {
      const key = mappingScheduleKey(mapping, row);
      const firstRow = firstRowsBySchedule.get(key);
      if (firstRow !== undefined) {
        addError(errors, {
          row: row.row,
          field: 'calendar',
          errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
          duplicateWithRow: firstRow,
          packageId: mapping.package_id,
          courseId: mapping.course_id,
          lessonId: mapping.lesson_id,
          message: `Dòng ${row.row} bị trùng lịch với dòng ${firstRow}`,
        });
      } else {
        firstRowsBySchedule.set(key, row.row);
      }
    });
  });

  return { resolvedRows, errors };
};

// Resolve only through mappings of the selected internal lesson. Never infer
// arbitrary package/course combinations from a global sheet for this format.
export const validateInternalCalendarImportMappings = async (rows: CalendarImportRow[]) => {
  const errors: CalendarImportError[] = [];
  const suppliedRows = rows.filter(row => row.packageIds.length || row.courseIds.length || row.lessonIds.length);
  const mappingsByRow = new Map<number, ResolvedPackageLessonMapping[]>();
  if (!suppliedRows.length) return { errors, mappingsByRow, pairCount: 0 };
  const sessionIds = [...new Set(suppliedRows.flatMap(row => row.calendar.session_id == null ? [] : [row.calendar.session_id]))];
  const contentMappings = sessionIds.length ? await prisma.lesson_course_mapping.findMany({
    where: { lesson_id: { in: sessionIds } },
    select: { lesson_id: true, package_id: true, course_id: true },
  }) : [];
  const candidates: RowWithPackages[] = [];
  for (const row of suppliedRows) {
    const allowed = contentMappings.filter(mapping => String(mapping.lesson_id) === String(row.calendar.session_id));
    const selected = allowed.filter(mapping => (
      (!row.packageIds.length || row.packageIds.includes(String(mapping.package_id)))
      && (!row.courseIds.length || row.courseIds.includes(String(mapping.course_id)))
    ));
    for (const packageId of row.packageIds) {
      if (!selected.some(mapping => String(mapping.package_id) === packageId)) addError(errors, {
        row: row.row, field: 'ID gói học', errorCode: 'INVALID_PACKAGE_ID', packageId,
        message: `ID gói học ${packageId} không khớp mapping package–course của Bài ${row.calendar.learn_number} trong quản lý nội dung`,
      });
    }
    for (const courseId of row.courseIds) {
      if (!selected.some(mapping => String(mapping.course_id) === courseId)) addError(errors, {
        row: row.row, field: 'ID khóa học', errorCode: 'INVALID_COURSE_ID', courseId,
        message: `ID khóa học ${courseId} không khớp mapping package–course của Bài ${row.calendar.learn_number} trong quản lý nội dung`,
      });
    }
    if (!selected.length && !errors.some(error => error.row === row.row)) addError(errors, {
      row: row.row, field: 'ID khóa học', errorCode: 'INVALID_ROW',
      message: `Bài ${row.calendar.learn_number} chưa có mapping package–course phù hợp trong quản lý nội dung`,
    });
    candidates.push({
      ...row,
      packageIds: unique(selected.map(mapping => String(mapping.package_id))),
      courseIds: unique(selected.map(mapping => String(mapping.course_id))),
      packageCoursePairs: selected.map(mapping => ({packageId: String(mapping.package_id), courseId: String(mapping.course_id)})),
    });
  }
  const pairs = buildUniquePackageCoursePairs(candidates);
  if (errors.length) return { errors, mappingsByRow, pairCount: 0 };
  let outlines: HmoCourseOutlineResult[];
  try {
    outlines = await fetchHocmaiCourseOutlines(pairs);
  } catch (error: any) {
    for (const row of suppliedRows) addError(errors, {
      row: row.row, field: 'HMO', errorCode: error instanceof HmoCourseOutlineError ? error.errorCode : 'HMO_BATCH_ERROR',
      message: error?.message || 'Không thể kiểm tra ID trên HMO; chưa thay đổi dữ liệu',
    });
    return { errors, mappingsByRow, pairCount: pairs.length };
  }
  const validation = validateCalendarImportOutlines(candidates, pairs, outlines);
  errors.push(...validation.errors);
  for (const row of validation.resolvedRows) {
    const byPair = new Map<string, string>();
    for (const mapping of row.mappings) {
      const pair = pairKey(mapping.package_id, mapping.course_id);
      if (byPair.has(pair) && byPair.get(pair) !== mapping.lesson_id) addError(errors, {
        row: row.row, field: 'ID bài giảng', errorCode: 'INVALID_LESSON_ID',
        packageId: mapping.package_id, courseId: mapping.course_id,
        message: `Chỉ được gán một ID bài giảng cho mỗi cặp gói học ${mapping.package_id} / khóa học ${mapping.course_id}`,
      });
      byPair.set(pair, mapping.lesson_id);
    }
    // Package/course alone validates context without clearing assigned lessons.
    if (row.lessonIds.length) mappingsByRow.set(row.row, row.mappings);
  }
  return { errors, mappingsByRow, pairCount: pairs.length };
};

const validateDatabaseDuplicates = async (
  rows: ResolvedCalendarImportRow[]
) => {
  const errors: CalendarImportError[] = [];
  if (!rows.length) return errors;

  const startTimes = rows.map((row) => new Date(row.calendar.start_time));
  const endTimes = rows.map((row) => new Date(row.calendar.end_time));
  const minStart = new Date(Math.min(...startTimes.map((date) => date.getTime())));
  const maxStart = new Date(Math.max(...startTimes.map((date) => date.getTime())));
  const minEnd = new Date(Math.min(...endTimes.map((date) => date.getTime())));
  const maxEnd = new Date(Math.max(...endTimes.map((date) => date.getTime())));
  const identities = unique(rows.flatMap((row) => row.mappings.map(
    (mapping) => `${mapping.package_id}::${mapping.course_id}::${mapping.lesson_id}`
  )));
  if (!identities.length) return errors;

  const conditions = identities.map((identity) => {
    const [packageId, courseId, lessonId] = identity.split('::');
    return Prisma.sql`(
      plm.package_id = ${packageId}
      AND plm.course_id = ${courseId}
      AND plm.lesson_id = ${lessonId}
    )`;
  });

  const existing = await prisma.$queryRaw<Array<{
    package_id: string;
    course_id: string;
    lesson_id: string;
    start_time: Date;
    end_time: Date;
  }>>(Prisma.sql`
    SELECT
      plm.package_id,
      plm.course_id,
      plm.lesson_id,
      c.start_time,
      c.end_time
    FROM package_lesson_mapping plm
    INNER JOIN calendar c ON c.deleted_at IS NULL AND c.\`key\` = plm.\`key\`
    WHERE c.start_time BETWEEN ${minStart} AND ${maxStart}
      AND c.end_time BETWEEN ${minEnd} AND ${maxEnd}
      AND (${Prisma.join(conditions, ' OR ')})
  `);

  const existingKeys = new Set(existing.map((item) => [
    item.package_id,
    item.course_id,
    item.lesson_id,
    item.start_time.getTime(),
    item.end_time.getTime(),
  ].join('::')));

  rows.forEach((row) => {
    row.mappings.forEach((mapping) => {
      if (!existingKeys.has(mappingScheduleKey(mapping, row))) return;
      addError(errors, {
        row: row.row,
        field: 'calendar',
        errorCode: 'DUPLICATE_SCHEDULE_IN_DATABASE',
        packageId: mapping.package_id,
        courseId: mapping.course_id,
        lessonId: mapping.lesson_id,
        message: `Lịch của Lesson ${mapping.lesson_id} đã tồn tại trong hệ thống`,
      });
    });
  });
  return errors;
};

export const importCalendarFromSheet = async (
  inputRows: CalendarImportRow[],
  changeActor?: { userId: number; username: string }
) => {
  const directRows = inputRows.filter((row) => row.sourceFormat === 'direct');
  if (directRows.length && directRows.length !== inputRows.length) {
    const errors: CalendarImportError[] = [{
      row: 1,
      field: 'file',
      errorCode: 'INVALID_ROW',
      message: 'Không thể trộn format lịch trực tiếp và format vận hành trong cùng một file',
    }];
    return {
      status: 'validation_error' as const,
      summary: buildSummary(inputRows, errors, 0, 0),
      errors,
    };
  }

  if (inputRows.some(row => row.sourceKey)) return {
    status: 'validation_error' as const,
    summary: buildSummary(inputRows, [], 0, 0),
    errors: inputRows.filter(row => row.sourceKey).map(row => ({
      row: row.row, field: 'Mã định danh lịch', errorCode: 'INVALID_ROW' as const,
      message: 'File có mã định danh lịch đã export. Hãy chọn Cập nhật lịch; chỉ để trống mã khi tạo lịch mới.',
    })),
  };

  const assistantErrors = [
    ...await resolveCalendarImportTeachers(inputRows),
    ...await resolveCalendarImportAssistants(inputRows),
  ];
  if (assistantErrors.length) {
    return {
      status: 'validation_error' as const,
      summary: buildSummary(inputRows, assistantErrors, 0, 0),
      errors: assistantErrors,
    };
  }

  if (directRows.length === inputRows.length) {
    const errors = await validateInternalLessonRows(inputRows);
    const mappingValidation = errors.length ? undefined : await validateInternalCalendarImportMappings(inputRows);
    errors.push(...(mappingValidation?.errors || []));
    if (errors.length) return {
      status: 'validation_error' as const,
      summary: buildSummary(inputRows, errors, 0, 0),
      errors,
    };
    const resolvedRows = inputRows.map((row) => ({ ...row, mappings: mappingValidation?.mappingsByRow.get(row.row) || [] }));
    const created = await createValidatedInternalCalendarImport(resolvedRows, changeActor);
    return {
      status: 'success' as const,
      summary: { ...buildSummary(inputRows, [], 0, 0), successRows: inputRows.length, failedRows: 0 },
      ...created,
    };
  }
  const packageResolution = await resolveMissingPackages(inputRows);
  const rows = packageResolution.rows;
  const pairs = buildUniquePackageCoursePairs(rows);
  let errors = [...packageResolution.errors];

  if (errors.length) {
    return {
      status: 'validation_error' as const,
      summary: buildSummary(rows, errors, pairs.length, 0),
      errors,
    };
  }

  let outlineResults: HmoCourseOutlineResult[];
  console.log("Fetching HMO course outlines for pairs:", pairs);
  try {
    outlineResults = await fetchHocmaiCourseOutlines(pairs);
    console.log("Fetched HMO course outlines:", outlineResults);
  } catch (error: any) {
    const hmoError = error instanceof HmoCourseOutlineError
      ? error
      : new HmoCourseOutlineError(
          'HMO_BATCH_ERROR',
          error?.message || 'Không thể gọi HMO Course Outline API'
        );
    errors = [{
      row: 1,
      field: 'HMO',
      errorCode: hmoError.errorCode,
      message: hmoError.message,
    }];
    return {
      status: 'validation_error' as const,
      summary: buildSummary(rows, errors, pairs.length, pairs.length),
      errors,
    };
  }

  const validation = validateCalendarImportOutlines(rows, pairs, outlineResults);
  errors.push(...validation.errors);
  if (!errors.length) {
    errors.push(...await validateDatabaseDuplicates(validation.resolvedRows));
  }

  if (errors.length) {
    return {
      status: 'validation_error' as const,
      summary: buildSummary(rows, errors, pairs.length, pairs.length),
      errors,
    };
  }

  const created = await createValidatedCalendarImport(
    validation.resolvedRows,
    changeActor
  );
  return {
    status: 'success' as const,
    summary: {
      ...buildSummary(rows, [], pairs.length, pairs.length),
      successRows: rows.length,
      failedRows: 0,
    },
    ...created,
  };
};

const importCalendarContext = (calendar: any): NonNullable<CalendarImportError['calendar']> => ({
  key: calendar.key || undefined,
  code: calendar.code,
  learnNumber: Number(calendar.learn_number),
  lessonCount: calendar.lesson_count == null ? undefined : Number(calendar.lesson_count),
  lessonName: calendar.lesson_name || undefined,
  startTime: calendar.start_time instanceof Date ? calendar.start_time.toISOString() : undefined,
});

export const updateCalendarsFromSheet = async (
  inputRows: CalendarImportRow[],
  changeActor?: { userId: number; username: string },
  existingDataMode: 'skip' | 'overwrite' = 'skip'
) => {
  const errors: CalendarImportError[] = [];
  const directRows = inputRows.filter((row) => row.sourceFormat === 'direct');
  if (directRows.length !== inputRows.length) {
    errors.push({
      row: 1,
      field: 'file',
      errorCode: 'INVALID_ROW',
      message: 'Cập nhật lịch cần cột Bài và Ngày live, Khung giờ theo mẫu export',
    });
  }

  const firstRowByIdentity = new Map<string, number>();
  inputRows.forEach((row) => {
    const key = String(row.sourceKey || '').trim();
    if (!key) {
      addError(errors, {
        row: row.row,
        field: 'Mã định danh lịch',
        errorCode: 'INVALID_ROW',
        message: 'Thiếu Mã định danh lịch nên không xác định được lịch cần cập nhật.',
        suggestion: 'Dùng file đã export và giữ nguyên Mã định danh lịch. Nếu muốn tạo lịch mới từ file mẫu, chọn tab Tạo lịch mới.',
      });
      return;
    }
    if (row.calendar.lesson_count === undefined) addError(errors, {
      row:row.row, field:'Lần học', errorCode:'INVALID_ROW', message:'Giữ nguyên Lần học trong file đã export; không được để trống',
    });
    const identity = key
      ? `key:${key}`
      : `lesson:${row.calendar.code}:${row.calendar.learn_number}:${row.calendar.lesson_count}`;
    const firstRow = firstRowByIdentity.get(identity);
    if (firstRow !== undefined) {
      addError(errors, {
        row: row.row,
        field: key ? 'key' : 'lesson_count',
        errorCode: 'DUPLICATE_SCHEDULE_IN_FILE',
        duplicateWithRow: firstRow,
        message: key
          ? `Key ${key} bị lặp với dòng ${firstRow}`
          : `Bài ${row.calendar.learn_number}, lần ${row.calendar.lesson_count} bị lặp với dòng ${firstRow}`,
      });
    } else {
      firstRowByIdentity.set(identity, row.row);
    }
  });

  if (errors.length) return {status:'validation_error' as const, summary:buildSummary(inputRows, errors, 0, 0), errors};
  const keys = inputRows.map(row => row.sourceKey!);
  const existing = await prisma.calendar.findMany({where:{OR:[{key:{in:keys}}]}});
  const existingByKey = new Map(existing.filter(calendar => calendar.key).map(calendar => [calendar.key!, calendar]));
  errors.push(...await resolveCalendarImportTeachers(inputRows, existingByKey));
  errors.push(...await resolveCalendarImportAssistants(inputRows));
  const ignoredCalendarKeyByRow = new Map<number, string>();

  inputRows.forEach((row) => {
    const key = String(row.sourceKey || '').trim();
    if (!key) return;
    const current = existingByKey.get(key);
    if (!current) {
      addError(errors, {
        row: row.row,
        field: 'key',
        errorCode: 'INVALID_ROW',
        reasonCode: 'CALENDAR_NOT_FOUND',
        message: 'Không tìm thấy lịch tương ứng với Mã định danh lịch trong dòng này.',
        importedValue: key,
        suggestion: 'Kiểm tra chương trình đang chọn và dùng file export mới nhất. Không tự sửa Mã định danh lịch; chọn Tạo lịch mới nếu đây là dòng cần tạo mới.',
      });
      return;
    }
    ignoredCalendarKeyByRow.set(row.row, key);
    if (String(current.subject || '').trim() !== String(row.calendar.subject || '').trim()) addError(errors, {
      row:row.row, field:'Môn', errorCode:'INVALID_ROW', reasonCode:'IMMUTABLE_FIELD',
      message:'Môn trong file khác với môn của lịch gốc.',
      currentValue:String(current.subject || ''), importedValue:String(row.calendar.subject || ''),
      suggestion:'Khôi phục Môn theo file export gốc. Không đổi môn khi cập nhật lịch.', calendar:importCalendarContext(current),
    });
    if (current.code !== row.calendar.code) {
      addError(errors, {
        row: row.row,
        field: 'code',
        errorCode: 'INVALID_ROW',
        reasonCode: 'IMMUTABLE_FIELD',
        message: 'Mã chương trình trong file khác với giá trị của lịch gốc.',
        currentValue: String(current.code), importedValue: String(row.calendar.code),
        suggestion: 'Khôi phục cột Mã chương trình theo file export gốc. Dùng Tạo lịch mới nếu cần thêm một lịch khác.',
        calendar: importCalendarContext(current),
      });
    }
    if (Number(current.learn_number) !== row.calendar.learn_number) {
      addError(errors, {
        row: row.row,
        field: 'learn_number',
        errorCode: 'INVALID_ROW',
        reasonCode: 'IMMUTABLE_FIELD',
        message: 'Bài trong file khác với giá trị của lịch gốc.',
        currentValue: String(current.learn_number), importedValue: String(row.calendar.learn_number),
        suggestion: 'Khôi phục cột Bài theo file export gốc. Dùng Tạo lịch mới nếu cần thêm một lịch khác.',
        calendar: importCalendarContext(current),
      });
    }
    if (String(current.system_type || 'topclass') !== row.calendar.system_type) {
      addError(errors, {
        row: row.row,
        field: 'system_type',
        errorCode: 'INVALID_ROW',
        reasonCode: 'IMMUTABLE_FIELD',
        message: 'Hệ thống trong file khác với giá trị của lịch gốc.',
        currentValue: String(current.system_type || 'topclass'), importedValue: String(row.calendar.system_type),
        suggestion: 'Khôi phục cột Hệ thống theo file export gốc. Dùng Tạo lịch mới nếu cần thêm một lịch khác.',
        calendar: importCalendarContext(current),
      });
    }
    if (
      row.calendar.lesson_count !== undefined
      && Number(current.lesson_count) !== row.calendar.lesson_count
    ) {
      addError(errors, {
        row: row.row,
        field: 'lesson_count',
        errorCode: 'INVALID_ROW',
        reasonCode: 'IMMUTABLE_FIELD',
        message: 'Lần học trong file khác với giá trị của lịch gốc.',
        currentValue: String(current.lesson_count), importedValue: String(row.calendar.lesson_count),
        suggestion: 'Khôi phục cột Lần học theo file export gốc. Dùng Tạo lịch mới nếu cần thêm một lịch khác.',
        calendar: importCalendarContext(current),
      });
    }
  });

  if (!errors.length) {
    errors.push(...await validateInternalLessonRows(inputRows, ignoredCalendarKeyByRow));
  }
  if (errors.length) return {
    status: 'validation_error' as const,
    summary: buildSummary(inputRows, errors, 0, 0),
    errors,
  };

  const mappingValidation = await validateInternalCalendarImportMappings(inputRows);
  if (mappingValidation.errors.length) return {
    status: 'validation_error' as const,
    summary: buildSummary(inputRows, mappingValidation.errors, mappingValidation.pairCount, mappingValidation.pairCount),
    errors: mappingValidation.errors,
  };
  const mappingKeys = inputRows.filter(row => mappingValidation.mappingsByRow.has(row.row)).map(row => row.sourceKey!);
  const currentMappings = mappingKeys.length ? await prisma.package_lesson_mapping.findMany({where: {key: {in: mappingKeys}}}) : [];
  const mappingSignature = (mappings: {package_id: string; course_id: string | null; lesson_id: string}[]) =>
    mappings.map(mapping => `${mapping.package_id}::${mapping.course_id}::${mapping.lesson_id}`).sort().join('|');

  const normalizedJson = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text;
    }
  };
  const normalizedText = (value: unknown) => String(value ?? '').trim();
  const documentLinks = (value: unknown) => {
    try {
      const documents = JSON.parse(String(value || '[]'));
      return Array.isArray(documents)
        ? documents.map(document => typeof document === 'object' && document ? document.link || '' : document).filter(Boolean).join(', ')
        : String(value || '');
    } catch { return String(value || ''); }
  };
  const preparedUpdates = inputRows.map((row) => {
    const current = existingByKey.get(row.sourceKey!)!;
    const merge = (currentValue: unknown, importedValue: unknown) => (
      resolveCalendarImportFieldValue(currentValue, importedValue, existingDataMode)
    );
    return {
      key: row.sourceKey!,
      current,
      nextMappings: (() => {
        const desired = mappingValidation.mappingsByRow.get(row.row);
        const assigned = currentMappings.filter(mapping => mapping.key === row.sourceKey);
        return desired && !(existingDataMode === 'skip' && assigned.length) && mappingSignature(desired) !== mappingSignature(assigned) ? desired : undefined;
      })(),
      data: {
        session_id: merge(current.session_id, row.calendar.session_id),
        subject: merge(current.subject, row.calendar.subject),
        start_time: merge(current.start_time, new Date(row.calendar.start_time)) as Date,
        end_time: merge(current.end_time, new Date(row.calendar.end_time)) as Date,
        teacher: merge(current.teacher, row.calendar.teacher),
        assistant_teacher: merge(current.assistant_teacher, row.calendar.assistant_teacher),
        lesson_name: merge(current.lesson_name, row.calendar.lesson_name),
        lesson_document: documentLinks(current.lesson_document) === documentLinks(row.calendar.lesson_document)
          ? current.lesson_document
          : merge(current.lesson_document, row.calendar.lesson_document),
        evg_banner: merge(current.evg_banner, row.calendar.evg_banner),
        evg_stream: merge(current.evg_stream, row.calendar.evg_stream),
        lesson_baitap: merge(current.lesson_baitap, row.calendar.lesson_baitap),
        lesson_status: merge(current.lesson_status, row.statusProvided ? row.calendar.lesson_status : undefined),
      },
    };
  });
  const changedRows = preparedUpdates.filter(({ current, data, nextMappings }) => (
    nextMappings !== undefined ||
    String(current.session_id ?? '') !== String(data.session_id ?? '')
      || normalizedText(current.subject) !== normalizedText(data.subject)
      || current.start_time.getTime() !== data.start_time.getTime()
      || current.end_time.getTime() !== data.end_time.getTime()
      || normalizedText(current.teacher) !== normalizedText(data.teacher)
      || normalizedText(current.assistant_teacher) !== normalizedText(data.assistant_teacher)
      || normalizedText(current.lesson_name) !== normalizedText(data.lesson_name)
      || normalizedJson(current.lesson_document) !== normalizedJson(data.lesson_document)
      || normalizedText(current.evg_banner) !== normalizedText(data.evg_banner)
      || normalizedText(current.evg_stream) !== normalizedText(data.evg_stream)
      || normalizedText(current.lesson_baitap) !== normalizedText(data.lesson_baitap)
      || Number(current.lesson_status) !== Number(data.lesson_status)
  ));

  const now = new Date();
  changedRows.forEach(({ key, current }) => {
    if (current.start_time <= now) {
      addError(errors, {
        row: inputRows.find((row) => row.sourceKey === key)?.row ?? 1,
        field: 'start_time',
        errorCode: 'INVALID_ROW',
        reasonCode: 'PAST_SCHEDULE',
        message: 'Lịch gốc đã bắt đầu nên không thể thay đổi thông tin qua import.',
        suggestion: 'Giữ nguyên toàn bộ thông tin của lịch này hoặc bỏ dòng khỏi file cập nhật. Nếu cần thêm buổi học khác, chọn Tạo lịch mới.',
        calendar: importCalendarContext(current),
      });
    }
  });
  if (errors.length) return {
    status: 'validation_error' as const,
    summary: buildSummary(inputRows, errors, 0, 0),
    errors,
  };

  if (changedRows.length) {
    const fields = [
      'session_id', 'subject', 'start_time', 'end_time', 'teacher',
      'assistant_teacher', 'lesson_name', 'lesson_document', 'evg_banner', 'evg_stream',
      'lesson_baitap', 'lesson_status',
    ] as const;
    await prisma.$transaction(async (tx) => {
      const manualQueue = changedRows.some(update => update.nextMappings !== undefined);
      const applyUpdates = async () => {
        const assignments = fields.map((field) => (
          `\`${field}\` = CASE \`key\` ${changedRows
            .map(() => 'WHEN ? THEN ?')
            .join(' ')} ELSE \`${field}\` END`
        )).join(', ');
        const caseValues = fields.flatMap((field) => changedRows.flatMap((update) => [
          update.key,
          update.data[field],
        ]));
        const keyPlaceholders = changedRows.map(() => '?').join(', ');
        await tx.$executeRawUnsafe(
          `UPDATE calendar
           SET ${assignments}, updated_at = CURRENT_TIMESTAMP
           WHERE deleted_at IS NULL AND \`key\` IN (${keyPlaceholders})`,
          ...caseValues,
          ...changedRows.map((update) => update.key)
        );

        const updatedCalendars = await tx.calendar.findMany({
          where: { key: { in: changedRows.map((update) => update.key) } },
        });
        const updatedByKey = new Map(
          updatedCalendars
            .filter((calendar) => calendar.key)
            .map((calendar) => [calendar.key!, calendar])
        );
        for (const update of changedRows) {
          if (update.nextMappings) {
            const after = updatedByKey.get(update.key);
            if (!after) throw new Error(`Không tìm thấy lịch ${update.key} sau cập nhật`);
            await reconcileCalendarMappingsAndEnqueue(tx, after, update.nextMappings);
          } else if (manualQueue) {
            const after = updatedByKey.get(update.key);
            if (!after) throw new Error(`Không tìm thấy lịch ${update.key} sau cập nhật`);
            await enqueueCalendarSync(tx, randomUUID(), 1, 'update', after);
          }
        }
        await enqueueManyCalendarTeamsNotifications(
          tx,
          changedRows.flatMap((update) => {
            const after = updatedByKey.get(update.key);
            return after ? [{
              eventType: 'updated' as const,
              before: update.current,
              after,
              actor: changeActor,
            }] : [];
          })
        );
      };
      return manualQueue ? withManualHocmaiQueue(tx, applyUpdates) : applyUpdates();
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  return {
    status: 'success' as const,
    count: changedRows.length,
    unchangedRows: inputRows.length - changedRows.length,
    summary: {
      ...buildSummary(inputRows, [], 0, 0),
      successRows: changedRows.length,
      failedRows: 0,
      unchangedRows: inputRows.length - changedRows.length,
    },
  };
};
