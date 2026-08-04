import ApiError from '../../utils/ApiError';
import {
  QUIZ_BULK_MAX_ITEMS,
  QUIZ_BULK_MUTABLE_FIELDS,
  QUIZ_DURATION_MAX_SECONDS,
  QUIZ_DURATION_MIN_SECONDS,
  QUIZ_IMPORT_MAX_ROWS,
  QUIZ_MUTABLE_FIELDS,
  QUIZ_SCORE_TYPES,
  QUIZ_STATUSES,
  QUIZ_TYPES,
} from './quiz.constants';
import {
  QuizAnswerItem,
  QuizBulkUpdatePayload,
  QuizCreatePayload,
  QuizExportQuery,
  QuizImportRow,
  QuizImportValidationError,
  QuizIndexSuggestionQuery,
  QuizListQuery,
  QuizPayload,
  QuizReorderPayload,
  QuizScoreType,
  QuizStatus,
  QuizSubmissionQuery,
  QuizType,
} from './quiz.types';

const SORTABLE_FIELDS = new Set([
  'id', 'quiz_id', 'code', 'learn_number', 'quiz_type', 'quiz_name',
  'score_type', 'ans_duration', 'quiz_status', 'quiz_index', 'created_at', 'updated_at',
]);

const CREATE_FIELDS = new Set([...QUIZ_MUTABLE_FIELDS, 'quiz_id']);
const UPDATE_FIELDS = new Set(QUIZ_MUTABLE_FIELDS);

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const stringValue = (value: unknown) => {
  if (Array.isArray(value) || value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const optionalInteger = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(`${field} không hợp lệ`, 400);
  return parsed;
};

const requiredInteger = (value: unknown, field: string) => {
  const parsed = optionalInteger(value, field);
  if (parsed === undefined) throw new ApiError(`Vui lòng cung cấp ${field}`, 400);
  return parsed;
};

const requiredString = (value: unknown, field: string, maxLength: number) => {
  const parsed = stringValue(value);
  if (!parsed) throw new ApiError(`Vui lòng cung cấp ${field}`, 400);
  if (parsed.length > maxLength) throw new ApiError(`${field} không được vượt quá ${maxLength} ký tự`, 400);
  return parsed;
};

const assertKnownFields = (body: unknown, allowed: Set<string>) => {
  if (!isPlainObject(body)) throw new ApiError('Payload không hợp lệ', 400);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));
  if (unknown.length) throw new ApiError(`Trường không được hỗ trợ: ${unknown.join(', ')}`, 400);
};

const parseEnumNumber = <T extends number>(value: unknown, field: string, allowed: readonly T[]): T => {
  const parsed = requiredInteger(value, field) as T;
  if (!allowed.includes(parsed)) throw new ApiError(`${field} không hợp lệ`, 400);
  return parsed;
};

const parseStatus = (value: unknown, required = true): QuizStatus | undefined => {
  const parsed = stringValue(value);
  if (!parsed) {
    if (required) throw new ApiError('Vui lòng cung cấp quiz_status', 400);
    return undefined;
  }
  if (!QUIZ_STATUSES.includes(parsed as QuizStatus)) throw new ApiError('quiz_status không hợp lệ', 400);
  return parsed as QuizStatus;
};

export const normalizeQuizAnswers = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') throw new ApiError('ans phải là một mảng JSON', 400);
  const text = value.trim();
  if (!text) throw new ApiError('ans không được để trống', 400);
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('not-array');
    return parsed;
  } catch {
    throw new ApiError('ans phải là một mảng JSON hợp lệ', 400);
  }
};

const normalizeBoolean = (value: unknown) => (
  value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
);

export const validateQuizAnswers = (quizType: QuizType, value: unknown): QuizAnswerItem[] => {
  const answers = normalizeQuizAnswers(value);
  if (!answers.length) throw new ApiError('ans phải có ít nhất một đáp án', 400);

  if (quizType === 1) {
    if (answers.length < 2) throw new ApiError('Câu trắc nghiệm cần ít nhất 2 lựa chọn', 400);
    let correctCount = 0;
    const normalized = answers.map((answer, index) => {
      if (!isPlainObject(answer)) throw new ApiError(`ans[${index}] không hợp lệ`, 400);
      const text = requiredString(answer.text, `ans[${index}].text`, 500);
      const answerKeys = Object.keys(answer).filter((key) => key !== 'text');
      const expectedKey = String.fromCharCode(65 + index);
      const key = answerKeys[0] || expectedKey;
      if (answerKeys.length > 1) throw new ApiError(`ans[${index}] chỉ được có một mã lựa chọn`, 400);
      if (key !== expectedKey) throw new ApiError(`Mã lựa chọn ans[${index}] phải là ${expectedKey}`, 400);
      const correct = normalizeBoolean(answer[key]);
      if (correct) correctCount += 1;
      return { [key]: correct, text };
    });
    if (!correctCount) throw new ApiError('Câu trắc nghiệm cần ít nhất một đáp án đúng', 400);
    return normalized;
  }

  if (quizType === 2) {
    return answers.map((answer, index) => {
      if (!isPlainObject(answer)) throw new ApiError(`ans[${index}] không hợp lệ`, 400);
      return {
        placeholder: requiredString(answer.placeholder ?? `Chỗ trống ${index + 1}`, `ans[${index}].placeholder`, 200),
        text: requiredString(answer.text, `ans[${index}].text`, 1000),
        A: true,
      };
    });
  }

  if (answers.length !== 1 || !isPlainObject(answers[0])) {
    throw new ApiError('Câu trả lời ngắn phải có đúng một đáp án mẫu', 400);
  }
  return [{ A: true, text: requiredString(answers[0].text, 'ans[0].text', 2000) }];
};

const parseDuration = (value: unknown) => {
  const duration = requiredInteger(value, 'ans_duration');
  if (duration < QUIZ_DURATION_MIN_SECONDS || duration > QUIZ_DURATION_MAX_SECONDS) {
    throw new ApiError(`ans_duration phải nằm trong khoảng ${QUIZ_DURATION_MIN_SECONDS}-${QUIZ_DURATION_MAX_SECONDS} giây`, 400);
  }
  return duration;
};

const parseIndex = (value: unknown) => {
  const index = requiredInteger(value, 'quiz_index');
  if (index < 0) throw new ApiError('quiz_index không được âm', 400);
  return index;
};

export const validateQuizId = (value: unknown) => requiredString(value, 'quiz_id', 100);

export const validateQuizClassCode = (value: unknown) => requiredString(value, 'code', 50);

export const validateQuizIndexSuggestionQuery = (query: any): QuizIndexSuggestionQuery => {
  const code = validateQuizClassCode(query.code);
  const learnNumber = requiredInteger(query.learn_number, 'learn_number');
  if (learnNumber <= 0) throw new ApiError('learn_number phải lớn hơn 0', 400);
  const quizIndex = optionalInteger(query.quiz_index, 'quiz_index');
  if (quizIndex !== undefined && quizIndex < 0) throw new ApiError('quiz_index không được âm', 400);
  const excludeQuizId = stringValue(query.exclude_quiz_id);
  return {
    code,
    learn_number: learnNumber,
    quiz_index: quizIndex,
    exclude_quiz_id: excludeQuizId,
  };
};

export const validateQuizPayload = (body: unknown, isUpdate = false): QuizCreatePayload | Partial<QuizPayload> => {
  assertKnownFields(body, isUpdate ? UPDATE_FIELDS : CREATE_FIELDS);
  const source = body as Record<string, unknown>;
  const payload: Partial<QuizCreatePayload> = {};

  if (!isUpdate && source.quiz_id !== undefined) payload.quiz_id = validateQuizId(source.quiz_id);
  if (!isUpdate || source.code !== undefined) payload.code = requiredString(source.code, 'code', 50);
  if (!isUpdate || source.learn_number !== undefined) {
    const value = requiredInteger(source.learn_number, 'learn_number');
    if (value <= 0) throw new ApiError('learn_number phải lớn hơn 0', 400);
    payload.learn_number = value;
  }
  if (!isUpdate || source.quiz_type !== undefined) {
    payload.quiz_type = parseEnumNumber(source.quiz_type, 'quiz_type', QUIZ_TYPES);
  }
  if (!isUpdate || source.quiz_name !== undefined) payload.quiz_name = requiredString(source.quiz_name, 'quiz_name', 500);
  if (!isUpdate || source.score_type !== undefined) {
    payload.score_type = parseEnumNumber(source.score_type, 'score_type', QUIZ_SCORE_TYPES);
  }
  if (!isUpdate || source.ans_duration !== undefined) payload.ans_duration = parseDuration(source.ans_duration);
  if (!isUpdate || source.quiz_status !== undefined) payload.quiz_status = parseStatus(source.quiz_status, !isUpdate);
  if (!isUpdate || source.quiz_index !== undefined) payload.quiz_index = parseIndex(source.quiz_index);

  if (!isUpdate) {
    payload.ans = validateQuizAnswers(payload.quiz_type as QuizType, source.ans);
  } else if (source.ans !== undefined || source.quiz_type !== undefined) {
    if (source.ans === undefined) {
      throw new ApiError('Phải gửi ans khi thay đổi quiz_type', 400);
    }
    payload.ans = source.ans as QuizAnswerItem[];
  }

  if (isUpdate && !Object.keys(payload).length) throw new ApiError('Không có dữ liệu cập nhật', 400);
  return payload;
};

export const finalizeQuizUpdateAnswers = (
  payload: Partial<QuizPayload>,
  existingType: QuizType,
  existingAnswers: unknown
) => {
  if (payload.ans === undefined && payload.quiz_type === undefined) return payload;
  payload.ans = validateQuizAnswers(payload.quiz_type ?? existingType, payload.ans ?? existingAnswers);
  return payload;
};

export const validateQuizListQuery = (query: any): QuizListQuery => {
  const page = optionalInteger(query.page, 'page') ?? 1;
  const limit = optionalInteger(query.limit, 'limit') ?? 10;
  if (page < 1) throw new ApiError('page phải lớn hơn 0', 400);
  if (limit < 1 || limit > 100) throw new ApiError('limit phải nằm trong khoảng 1-100', 400);
  const sortBy = stringValue(query.sort_by);
  if (sortBy && !SORTABLE_FIELDS.has(sortBy)) throw new ApiError('sort_by không hợp lệ', 400);
  const sortOrder = stringValue(query.sort_order);
  if (sortOrder && !['asc', 'desc', 'ascend', 'descend'].includes(sortOrder)) {
    throw new ApiError('sort_order không hợp lệ', 400);
  }
  const quizType = query.quiz_type === undefined ? undefined : parseEnumNumber(query.quiz_type, 'quiz_type', QUIZ_TYPES);
  const scoreType = query.score_type === undefined ? undefined : parseEnumNumber(query.score_type, 'score_type', QUIZ_SCORE_TYPES);
  const status = query.quiz_status === undefined ? undefined : parseStatus(query.quiz_status);
  const learnNumber = optionalInteger(query.learn_number, 'learn_number');
  if (learnNumber !== undefined && learnNumber <= 0) throw new ApiError('learn_number phải lớn hơn 0', 400);
  return {
    page,
    limit,
    code: stringValue(query.code),
    learn_number: learnNumber,
    quiz_type: quizType,
    score_type: scoreType,
    quiz_status: status,
    keyword: stringValue(query.keyword),
    sort_by: sortBy,
    sort_order: sortOrder === 'desc' || sortOrder === 'descend' ? 'desc' : 'asc',
  };
};

const parseQuizIds = (value: unknown, field = 'quiz_ids') => {
  if (!Array.isArray(value) || !value.length) throw new ApiError(`Vui lòng cung cấp ${field}`, 400);
  const ids = value.map(validateQuizId);
  if (new Set(ids).size !== ids.length) throw new ApiError(`${field} không được trùng`, 400);
  if (ids.length > QUIZ_BULK_MAX_ITEMS) throw new ApiError(`${field} không được vượt quá ${QUIZ_BULK_MAX_ITEMS} phần tử`, 400);
  return ids;
};

export const validateQuizBulkPayload = (body: any): QuizBulkUpdatePayload => {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['quiz_ids', 'data'].includes(key))) {
    throw new ApiError('Payload bulk không hợp lệ', 400);
  }
  if (!isPlainObject(body.data)) throw new ApiError('data không hợp lệ', 400);
  const unknown = Object.keys(body.data).filter((key) => !QUIZ_BULK_MUTABLE_FIELDS.includes(key as any));
  if (unknown.length) throw new ApiError(`Không hỗ trợ bulk field: ${unknown.join(', ')}`, 400);
  const data: QuizBulkUpdatePayload['data'] = {};
  if (body.data.score_type !== undefined) data.score_type = parseEnumNumber(body.data.score_type, 'score_type', QUIZ_SCORE_TYPES);
  if (body.data.ans_duration !== undefined) data.ans_duration = parseDuration(body.data.ans_duration);
  if (body.data.quiz_status !== undefined) data.quiz_status = parseStatus(body.data.quiz_status);
  if (!Object.keys(data).length) throw new ApiError('Không có dữ liệu bulk update', 400);
  return { quiz_ids: parseQuizIds(body.quiz_ids), data };
};

export const validateQuizReorderPayload = (body: any): QuizReorderPayload => {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['code', 'learn_number', 'ordered_quiz_ids'].includes(key))) {
    throw new ApiError('Payload reorder không hợp lệ', 400);
  }
  const learnNumber = requiredInteger(body.learn_number, 'learn_number');
  if (learnNumber <= 0) throw new ApiError('learn_number phải lớn hơn 0', 400);
  return {
    code: requiredString(body.code, 'code', 50),
    learn_number: learnNumber,
    ordered_quiz_ids: parseQuizIds(body.ordered_quiz_ids, 'ordered_quiz_ids'),
  };
};

export const validateQuizExportQuery = (query: any): QuizExportQuery => {
  const list = validateQuizListQuery({ ...query, page: 1, limit: 100 });
  const format = stringValue(query.format) ?? 'xlsx';
  if (format !== 'xlsx' && format !== 'csv') throw new ApiError('format chỉ hỗ trợ xlsx hoặc csv', 400);
  const idsText = stringValue(query.quiz_ids);
  const quizIds = idsText ? idsText.split(',').map((id) => validateQuizId(id.trim())) : undefined;
  return { ...list, format, quiz_ids: quizIds };
};

export const validateQuizSubmissionQuery = (query: any): QuizSubmissionQuery => {
  const page = optionalInteger(query.page, 'page') ?? 1;
  const limit = optionalInteger(query.limit, 'limit') ?? 20;
  if (page < 1) throw new ApiError('page phải lớn hơn 0', 400);
  if (limit < 1 || limit > 100) throw new ApiError('limit phải nằm trong khoảng 1-100', 400);
  const latestText = stringValue(query.latest)?.toLowerCase();
  if (latestText && !['true', 'false', '1', '0'].includes(latestText)) throw new ApiError('latest không hợp lệ', 400);
  const order = stringValue(query.sort_order);
  return {
    page,
    limit,
    username: stringValue(query.username),
    class_id: stringValue(query.class_id),
    latest: latestText === undefined ? true : latestText === 'true' || latestText === '1',
    sort_order: order === 'asc' || order === 'ascend' ? 'asc' : 'desc',
  };
};

export const validateQuizImportRows = (rows: Record<string, unknown>[]) => {
  const errors: QuizImportValidationError[] = [];
  const validRows: QuizImportRow[] = [];
  const seenIds = new Set<string>();
  if (rows.length > QUIZ_IMPORT_MAX_ROWS) {
    return { validRows, errors: [{ row: 0, message: `File không được vượt quá ${QUIZ_IMPORT_MAX_ROWS} dòng` }] };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const payload = validateQuizPayload({
        quiz_id: stringValue(row.quiz_id),
        code: row.code,
        learn_number: row.learn_number,
        quiz_type: row.quiz_type,
        quiz_name: row.quiz_name,
        ans: row.ans,
        score_type: row.score_type ?? 1,
        ans_duration: row.ans_duration ?? 60,
        quiz_status: row.quiz_status ?? 'active',
        quiz_index: row.quiz_index ?? 0,
      }) as QuizCreatePayload;
      if (!payload.quiz_id) delete payload.quiz_id;
      if (payload.quiz_id) {
        if (seenIds.has(payload.quiz_id)) throw new ApiError('Trùng quiz_id trong file import', 400);
        seenIds.add(payload.quiz_id);
      }
      validRows.push({ ...payload, row_number: rowNumber });
    } catch (error: any) {
      errors.push({ row: rowNumber, message: error.message || 'Dữ liệu không hợp lệ' });
    }
  });
  return { validRows, errors };
};

export const parseQuizImportMode = (value: unknown) => {
  const mode = stringValue(value) ?? 'skip';
  if (mode !== 'skip' && mode !== 'overwrite') throw new ApiError('mode chỉ hỗ trợ skip hoặc overwrite', 400);
  return mode;
};

export const getQuizEditableBodyFields = (body: any) => (
  isPlainObject(body) ? Object.keys(body).filter((field) => QUIZ_MUTABLE_FIELDS.includes(field as any)) : []
);
