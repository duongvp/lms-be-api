import ApiError from '../../utils/ApiError';
import { serializeBigInt } from '../../lib/serializer';
import {
  bulkUpdateLessons,
  createLesson,
  findLessonByIdentity,
  findLessonById,
  findLessonProgramByCode,
  findLessonSubjectOptions,
  findLessonProgramOptions,
  findLessonCourseMappings,
  findLessons,
  findLessonsForExport,
  findLessonsByGroup,
  findPastScheduledLessonIds,
  importLessons,
  reorderLessonsInGroup,
  deleteLessonIfUnscheduled,
  updateLesson,
  updateLessonCourseMappings,
} from './lesson.repository';
import { normalizeSubject, SUBJECT_OPTIONS } from './lesson.constants';
import { resolvePackagesByCourseId } from '../../integrations/package-course-sheet.service';
import {
  LessonBulkUpdatePayload,
  LessonExportQuery,
  LessonImportMode,
  LessonImportRow,
  LessonImportValidationError,
  LessonListQuery,
  LessonPayload,
  LessonReorderPayload,
  LessonCourseMappingPayload,
} from './lesson.types';
import {
  buildLessonExportBuffer,
  buildLessonTemplateBuffer,
  getLessonExportContentType,
} from './lesson.io';

export const getLessons = async (query: LessonListQuery) => {
  const result = await findLessons(query);
  return serializeBigInt(result);
};

export const getLessonSubjects = async () => {
  const databaseSubjects = await findLessonSubjectOptions();
  const seen = new Set<string>();

  return [...SUBJECT_OPTIONS, ...databaseSubjects]
    .filter((subject) => {
      const key = normalizeSubject(subject.subject_name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((subject) => ({
      subject_name: String(subject.subject_name).trim(),
      subject_code: String(subject.subject_code).trim(),
    }));
};

export const getLessonPrograms = async (allowedPrograms: string[] | null = null) => (
  serializeBigInt(await findLessonProgramOptions(allowedPrograms))
);

export const getCourseMappingsByProgram = async (programCode: string) => (
  serializeBigInt(await findLessonCourseMappings(programCode))
);

export const changeLessonCourseMappings = async (payload: LessonCourseMappingPayload) => {
  if (payload.action === 'add') {
    const sheetRows = await resolvePackagesByCourseId(payload.course_id);
    if (!sheetRows.some((row) => row.package_id === payload.package_id)) {
      throw new ApiError(
        `Package ID ${payload.package_id} không thuộc Course ID ${payload.course_id} trong PACKAGE_COURSE_SHEET_URL`,
        400
      );
    }
  }
  return updateLessonCourseMappings({
    programCode: payload.program_code,
    action: payload.action,
    packageId: payload.package_id,
    courseId: payload.course_id,
    lessonIds: payload.lesson_ids,
  });
};

export const getLessonDetail = async (id: bigint) => {
  const lesson = await findLessonById(id);
  if (!lesson) throw new ApiError('Lesson not found', 404);
  return serializeBigInt(lesson);
};

export const createNewLesson = async (payload: LessonPayload) => {
  // Bài mới thuộc một Chương trình có sẵn phải luôn dùng tên môn chuẩn của
  // Chương trình đó. Client tạo nhanh chỉ cần gửi mã Chương trình; không thể
  // làm subject_name bị ghi nhầm thành chính mã chương trình.
  const existingProgram = await findLessonProgramByCode(payload.subject_code);
  if (existingProgram?.subject_name) {
    payload = {
      ...payload,
      grade: Number(existingProgram.grade ?? payload.grade),
      subject_name: String(existingProgram.subject_name).trim(),
    };
  }
  if (payload.learn_number !== undefined) {
    const existing = await findLessonByIdentity(payload.grade, payload.subject_code, payload.learn_number);
    if (existing) {
      throw new ApiError('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
    }
  }

  try {
    return serializeBigInt(await createLesson(payload));
  } catch (error: any) {
    if (String(error?.message ?? '').includes('Duplicate entry') || error?.code === 'P2010') {
      throw new ApiError('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
    }
    throw error;
  }
};

export const createNewProgram = async (payload: LessonPayload) => {
  if (!/^[A-Za-z0-9_-]+$/.test(payload.subject_code)) {
    throw new ApiError(
      'Mã Chương trình chỉ được dùng chữ không dấu, số, dấu gạch ngang hoặc gạch dưới',
      400
    );
  }
  const existingProgram = await findLessonProgramByCode(payload.subject_code);
  if (existingProgram) {
    throw new ApiError(`Chương trình ${payload.subject_code} đã tồn tại`, 409);
  }

  const firstLesson = await createNewLesson({
    ...payload,
    learn_number: 1,
  });
  return {
    grade: payload.grade,
    subject_code: payload.subject_code,
    subject_name: payload.subject_name,
    first_lesson: firstLesson,
  };
};

export const updateExistingLesson = async (id: bigint, payload: Partial<LessonPayload>) => {
  const current = await findLessonById(id);
  if (!current) throw new ApiError('Lesson not found', 404);

  const lockedIds = await findPastScheduledLessonIds([id]);
  if (lockedIds.has(String(id))) {
    throw new ApiError('Không thể chỉnh sửa bài học đã được dạy', 409);
  }

  if (payload.grade !== undefined && Number(payload.grade) !== Number(current.grade)) {
    throw new ApiError('Không thể thay đổi khối khi cập nhật bài học', 400);
  }
  if (
    payload.subject_name !== undefined
    && String(payload.subject_name).trim() !== String(current.subject_name).trim()
  ) {
    throw new ApiError('Không thể thay đổi môn học khi cập nhật bài học', 400);
  }
  if (
    payload.subject_code !== undefined
    && String(payload.subject_code).trim() !== String(current.subject_code).trim()
  ) {
    throw new ApiError('Không thể thay đổi mã môn học hoặc năm học khi cập nhật bài học', 400);
  }

  const grade = payload.grade ?? current.grade;
  const subjectCode = payload.subject_code ?? current.subject_code;
  const learnNumber = payload.learn_number ?? current.learn_number;
  const existing = await findLessonByIdentity(grade, subjectCode, learnNumber, id);
  if (existing) {
    throw new ApiError('Bài học với khối, môn học và learn_number này đã tồn tại', 400);
  }

  return serializeBigInt(await updateLesson(id, payload));
};

export const deleteExistingLesson = async (id: bigint) => {
  const result = await deleteLessonIfUnscheduled(id);
  if (!result.lesson) throw new ApiError('Bài học không tồn tại hoặc đã bị xóa', 404);
  if (result.scheduledCount > 0) {
    throw new ApiError(
      `Không thể xóa bài học vì đang được gán cho ${result.scheduledCount} lịch học`,
      409
    );
  }
  return serializeBigInt(result.lesson);
};

export const bulkUpdateExistingLessons = async ({ ids, data }: LessonBulkUpdatePayload) => {
  const lessons = await Promise.all(ids.map((id) => findLessonById(id)));
  if (lessons.some((lesson) => !lesson)) {
    throw new ApiError('Có bài học không tồn tại hoặc đã bị xóa', 404);
  }
  const lockedIds = await findPastScheduledLessonIds(ids);
  if (lockedIds.size) {
    throw new ApiError('Không thể chỉnh sửa hàng loạt khi có bài học đã được dạy', 409);
  }
  
  return serializeBigInt(await bulkUpdateLessons(ids, data));
};

export const reorderExistingLessons = async (payload: LessonReorderPayload) => {
  const lessons = await findLessonsByGroup(payload.grade, payload.subject_code);
  const activeIds = lessons.map((lesson) => String(lesson.id));
  const orderedIds = payload.ordered_ids.map((id) => String(id));

  if (activeIds.length !== orderedIds.length) {
    throw new ApiError('Danh sách sắp xếp phải bao gồm toàn bộ bài học trong khối và môn học đã chọn', 400);
  }

  const activeIdSet = new Set(activeIds);
  const orderedIdSet = new Set(orderedIds);
  if (activeIdSet.size !== orderedIdSet.size || orderedIds.some((id) => !activeIdSet.has(id))) {
    throw new ApiError('Danh sách sắp xếp không hợp lệ', 400);
  }

  const learnNumbers = lessons.map((lesson) => Number(lesson.learn_number));
  const lockedIds = await findPastScheduledLessonIds(payload.ordered_ids);
  const lessonById = new Map(lessons.map((lesson) => [String(lesson.id), lesson]));
  const movedLockedLesson = orderedIds.some((id, index) => (
    lockedIds.has(id)
    && Number(lessonById.get(id)?.learn_number) !== learnNumbers[index]
  ));
  if (movedLockedLesson) {
    throw new ApiError('Không thể sắp xếp lại bài học đã diễn ra trong quá khứ', 409);
  }

  return serializeBigInt(await reorderLessonsInGroup(
    payload.grade,
    payload.subject_code,
    payload.ordered_ids,
    learnNumbers
  ));
};

export const exportLessons = async (query: LessonExportQuery) => {
  const rows = await findLessonsForExport(query);
  const buffer = buildLessonExportBuffer(serializeBigInt(rows) as any[], query.format);
  const extension = query.format;

  return {
    buffer,
    contentType: getLessonExportContentType(query.format),
    filename: `lessons-export-${Date.now()}.${extension}`,
  };
};

export const getLessonImportTemplate = (format: 'csv' | 'xlsx') => ({
  buffer: buildLessonTemplateBuffer(format),
  contentType: getLessonExportContentType(format),
  filename: `lessons-import-template.${format}`,
});

const findFirstMissingLearnNumber = (learnNumbers: Set<number>) => {
  let expected = 1;
  while (learnNumbers.has(expected)) expected += 1;
  return expected;
};

export const validateLessonImportSequence = async (rows: LessonImportRow[], mode: LessonImportMode) => {
  const errors: LessonImportValidationError[] = [];
  const rowsByGroup = new Map<string, LessonImportRow[]>();

  rows.forEach((row) => {
    const key = `${row.grade}|${row.subject_code}`;
    rowsByGroup.set(key, [...(rowsByGroup.get(key) ?? []), row]);
  });

  for (const groupRows of rowsByGroup.values()) {
    const firstRow = groupRows[0];
    const existingLessons = await findLessonsByGroup(firstRow.grade, firstRow.subject_code);
    const activeLearnNumbers = new Set<number>(
      existingLessons.map((lesson) => Number(lesson.learn_number))
    );
    const simulatedLearnNumbers = new Set(activeLearnNumbers);

    for (const row of groupRows) {
      const groupLabel = `${row.subject_name} lớp ${row.grade}`;

      if (row.learn_number === undefined) {
        const nextNumber = findFirstMissingLearnNumber(simulatedLearnNumbers);
        if (row.status !== 0) simulatedLearnNumbers.add(nextNumber);
        continue;
      }

      if (activeLearnNumbers.has(row.learn_number)) {
        if (mode === 'overwrite' && row.status === 0) {
          simulatedLearnNumbers.delete(row.learn_number);
        }
        continue;
      }

      const expectedNumber = findFirstMissingLearnNumber(simulatedLearnNumbers);
      if (row.learn_number !== expectedNumber) {
        errors.push({
          row: row.row_number,
          field: 'learn_number',
          message: `${groupLabel} đang thiếu Bài ${expectedNumber}; không thể import trực tiếp Bài ${row.learn_number}. Hãy để trống Learn Number để hệ thống tự đánh số hoặc import đủ thứ tự.`,
        });
        continue;
      }

      if (row.status !== 0) simulatedLearnNumbers.add(row.learn_number);
    }
  }

  return errors;
};

export const importLessonRows = async (rows: LessonImportRow[], mode: LessonImportMode) => {
  if (!rows.length) {
    throw new ApiError('File import không có dữ liệu', 400);
  }

  return serializeBigInt(await importLessons(rows, mode));
};
