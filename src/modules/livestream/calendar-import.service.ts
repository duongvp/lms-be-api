import { Prisma, PrismaClient } from '@prisma/client';
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
import { createValidatedCalendarImport } from './livestream.service';

const prisma = new PrismaClient();

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

const addError = (
  errors: CalendarImportError[],
  error: CalendarImportError
) => {
  const identity = [
    error.row,
    error.errorCode,
    error.packageId,
    error.courseId,
    error.lessonId,
    error.duplicateWithRow,
  ].join('::');
  if (!errors.some((item) => [
    item.row,
    item.errorCode,
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
    INNER JOIN calendar c ON c.\`key\` = plm.\`key\`
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
