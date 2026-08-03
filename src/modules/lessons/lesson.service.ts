import ApiError from '../../utils/ApiError';
import { serializeBigInt } from '../../lib/serializer';
import {
  bulkUpdateLessons,
  createLesson,
  findLessonByIdentity,
  findLessonById,
  findLessonSubjectOptions,
  findLessonProgramOptions,
  findLessons,
  findLessonsForExport,
  findLessonsByGroup,
  importLessons,
  reorderLessonsInGroup,
  softDeleteLesson,
  updateLesson,
} from './lesson.repository';
import { normalizeSubject, SUBJECT_OPTIONS } from './lesson.constants';
import {
  LessonBulkUpdatePayload,
  LessonExportQuery,
  LessonImportMode,
  LessonImportRow,
  LessonImportValidationError,
  LessonListQuery,
  LessonPayload,
  LessonReorderPayload,
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

export const getLessonPrograms = async () => (
  serializeBigInt(await findLessonProgramOptions())
);

export const getLessonDetail = async (id: bigint) => {
  const lesson = await findLessonById(id);
  if (!lesson) throw new ApiError('Lesson not found', 404);
  return serializeBigInt(lesson);
};

export const createNewLesson = async (payload: LessonPayload) => {
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

export const updateExistingLesson = async (id: bigint, payload: Partial<LessonPayload>) => {
  const current = await findLessonById(id);
  if (!current) throw new ApiError('Lesson not found', 404);

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
  const current = await findLessonById(id);
  if (!current) throw new ApiError('Lesson not found', 404);
  return serializeBigInt(await softDeleteLesson(id));
};

export const bulkUpdateExistingLessons = async ({ ids, data }: LessonBulkUpdatePayload) => {
  const lessons = await Promise.all(ids.map((id) => findLessonById(id)));
  if (lessons.some((lesson) => !lesson)) {
    throw new ApiError('Có bài học không tồn tại hoặc đã bị xóa', 404);
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

  return serializeBigInt(await reorderLessonsInGroup(payload.grade, payload.subject_code, payload.ordered_ids));
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
