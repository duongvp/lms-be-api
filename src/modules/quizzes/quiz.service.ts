import { randomUUID } from 'crypto';
import ApiError from '../../utils/ApiError';
import { serializeBigInt } from '../../lib/serializer';
import {
  QUIZ_SCORE_TYPE_OPTIONS,
  QUIZ_STATUS_OPTIONS,
  QUIZ_TYPE_OPTIONS,
} from './quiz.constants';
import {
  bulkUpdateQuizzes,
  createQuiz,
  findEnabledQuizzesByGroup,
  findQuizClassOptions,
  findQuizIndexSuggestion,
  findQuizLessonOptions,
  findQuizById,
  findQuizzes,
  findQuizzesByIds,
  findQuizzesForExport,
  importQuizzes,
  reorderQuizzes,
  setQuizStatus,
  updateQuiz,
} from './quiz.repository';
import {
  QuizBulkUpdatePayload,
  QuizCreatePayload,
  QuizExportQuery,
  QuizImportMode,
  QuizImportRow,
  QuizIndexSuggestionQuery,
  QuizListQuery,
  QuizPayload,
  QuizReorderPayload,
  QuizType,
} from './quiz.types';
import { finalizeQuizUpdateAnswers } from './quiz.validation';
import {
  buildQuizExportBuffer,
  buildQuizTemplateBuffer,
  getQuizExportContentType,
} from './quiz.io';

const normalizeStoredAnswers = (value: unknown) => {
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
};

const normalizeQuiz = (quiz: any) => quiz ? {
  ...quiz,
  // `active` tồn tại ở dữ liệu cũ, nhưng nghiệp vụ hiện chỉ còn done/disable.
  quiz_status: quiz.quiz_status === 'active' ? 'done' : quiz.quiz_status,
  ans: normalizeStoredAnswers(quiz.ans),
} : quiz;
const normalizeQuizResult = (value: any) => serializeBigInt(normalizeQuiz(value));

const translatePersistenceError = (error: any): never => {
  if (error?.code === 'P2002' || String(error?.message ?? '').includes('Duplicate entry')) {
    throw new ApiError('quiz_id đã tồn tại', 409);
  }
  throw error;
};

export const getQuizOptions = () => ({
  quiz_types: QUIZ_TYPE_OPTIONS,
  score_types: QUIZ_SCORE_TYPE_OPTIONS,
  statuses: QUIZ_STATUS_OPTIONS,
  duration_unit: 'seconds',
});

export const getQuizClassOptions = async (allowedPrograms: string[] | null = null) => serializeBigInt(await findQuizClassOptions(allowedPrograms));

export const getQuizLessonOptions = async (code: string) => (
  serializeBigInt(await findQuizLessonOptions(code))
);

export const getQuizIndexSuggestion = async (query: QuizIndexSuggestionQuery) => {
  const result = await findQuizIndexSuggestion(query);
  return serializeBigInt({
    next_index: result.next_index,
    duplicate: normalizeQuiz(result.duplicate),
  });
};

export const getQuizzes = async (query: QuizListQuery, allowedPrograms: string[] | null = null) => {
  const result = await findQuizzes(query, allowedPrograms);
  return serializeBigInt({ ...result, data: result.data.map(normalizeQuiz) });
};

export const getQuizDetail = async (quizId: string) => {
  const quiz = await findQuizById(quizId);
  if (!quiz) throw new ApiError('Quiz không tồn tại', 404);
  return normalizeQuizResult(quiz);
};

export const createNewQuiz = async (payload: QuizCreatePayload, creator: string) => {
  const quizId = payload.quiz_id ?? randomUUID();
  try {
    const { next_index } = await findQuizIndexSuggestion({
      code: payload.code,
      learn_number: payload.learn_number,
    });
    return normalizeQuizResult(await createQuiz(quizId, { ...payload, quiz_index: next_index }, creator));
  } catch (error) {
    return translatePersistenceError(error);
  }
};

export const updateExistingQuiz = async (quizId: string, payload: Partial<QuizPayload>) => {
  const current = await findQuizById(quizId);
  if (!current) throw new ApiError('Quiz không tồn tại', 404);
  finalizeQuizUpdateAnswers(payload, Number(current.quiz_type) as QuizType, current.ans);
  try {
    return normalizeQuizResult(await updateQuiz(quizId, payload));
  } catch (error) {
    return translatePersistenceError(error);
  }
};

export const disableExistingQuiz = async (quizId: string) => {
  const current = await findQuizById(quizId);
  if (!current) throw new ApiError('Quiz không tồn tại', 404);
  if (current.quiz_status === 'disable') throw new ApiError('Quiz đã bị vô hiệu hóa', 409);
  return normalizeQuizResult(await setQuizStatus(quizId, 'disable'));
};

export const restoreExistingQuiz = async (quizId: string) => {
  const current = await findQuizById(quizId);
  if (!current) throw new ApiError('Quiz không tồn tại', 404);
  if (current.quiz_status !== 'disable') throw new ApiError('Quiz chưa bị vô hiệu hóa', 409);
  // Giữ tương thích endpoint activate của runtime cũ.
  return normalizeQuizResult(await setQuizStatus(quizId, 'done'));
};

export const bulkUpdateExistingQuizzes = async (payload: QuizBulkUpdatePayload) => {
  const existing = await findQuizzesByIds(payload.quiz_ids);
  if (existing.length !== payload.quiz_ids.length) throw new ApiError('Có quiz không tồn tại', 404);
  const result = await bulkUpdateQuizzes(payload);
  return serializeBigInt(result.map(normalizeQuiz));
};

export const reorderExistingQuizzes = async (payload: QuizReorderPayload) => {
  const existing = await findEnabledQuizzesByGroup(payload.code, payload.learn_number);
  const currentIds = existing.map((quiz) => quiz.quiz_id);
  if (currentIds.length !== payload.ordered_quiz_ids.length) {
    throw new ApiError('Danh sách sắp xếp phải bao gồm toàn bộ câu hỏi đang hoạt động trong Chương trình và bài học', 400);
  }
  const currentSet = new Set(currentIds);
  if (payload.ordered_quiz_ids.some((id) => !currentSet.has(id))) {
    throw new ApiError('Danh sách sắp xếp chứa câu hỏi không thuộc Chương trình hoặc bài học', 400);
  }
  return serializeBigInt((await reorderQuizzes(payload)).map(normalizeQuiz));
};

export const exportQuizzes = async (
  query: QuizExportQuery,
  filterVisible: (rows: any[]) => Promise<any[]> = async (rows) => rows,
  allowedPrograms: string[] | null = null
) => {
  const rows = await findQuizzesForExport(query, query.quiz_ids, allowedPrograms);
  const visibleRows = await filterVisible(rows.map(normalizeQuiz));
  const buffer = buildQuizExportBuffer(visibleRows, query.format);
  return {
    buffer,
    contentType: getQuizExportContentType(query.format),
    filename: `quizzes-export-${Date.now()}.${query.format}`,
  };
};

export const getQuizImportTemplate = (format: 'csv' | 'xlsx') => ({
  buffer: buildQuizTemplateBuffer(format),
  contentType: getQuizExportContentType(format),
  filename: `quizzes-import-template.${format}`,
});

export const importQuizRows = async (rows: QuizImportRow[], mode: QuizImportMode, creator: string) => {
  const normalized = rows.map((row) => ({
    ...row,
    quiz_id: row.quiz_id ?? randomUUID(),
    creator,
  }));
  try {
    return await importQuizzes(normalized, mode);
  } catch (error) {
    return translatePersistenceError(error);
  }
};
