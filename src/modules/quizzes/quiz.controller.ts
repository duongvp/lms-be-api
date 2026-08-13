import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import FieldPermissionService from '../roles/field-permission.service';
import {
  bulkUpdateExistingQuizzes,
  createNewQuiz,
  disableExistingQuiz,
  exportQuizzes,
  getQuizDetail,
  getQuizClassOptions,
  getQuizIndexSuggestion,
  getQuizLessonOptions,
  getQuizImportTemplate,
  getQuizOptions,
  getQuizzes,
  importQuizRows,
  reorderExistingQuizzes,
  restoreExistingQuiz,
  updateExistingQuiz,
} from './quiz.service';
import {
  parseQuizImportMode,
  validateQuizBulkPayload,
  validateQuizExportQuery,
  validateQuizId,
  validateQuizClassCode,
  validateQuizIndexSuggestionQuery,
  validateQuizImportRows,
  validateQuizListQuery,
  validateQuizPayload,
  validateQuizReorderPayload,
} from './quiz.validation';
import { parseQuizImportFile } from './quiz.io';
import { QUIZ_MUTABLE_FIELDS } from './quiz.constants';
import { assertProgramAccess, getProgramScopeFilter } from '../../services/authorization.service';

const visibleRecord = (req: Request, record: any) => (
  FieldPermissionService.filterVisibleRecord(req.user?.roleIds || [], 'quiz', record)
);

const visibleRecords = (req: Request, records: any[]) => (
  FieldPermissionService.filterVisibleRecords(req.user?.roleIds || [], 'quiz', records)
);

const list = async (req: Request, res: Response) => {
  try {
    if (!String(req.query.code || '').trim()) return ErrorResponse(res, 'Vui lòng chọn Chương trình', 400);
    const result = await getQuizzes(
      validateQuizListQuery(req.query),
      getProgramScopeFilter(req.user, 'quiz.view')
    );
    const data = await visibleRecords(req, result.data as any[]);
    return SuccessResponse(res, 'Success', { ...result, data });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const options = async (_req: Request, res: Response) => SuccessResponse(res, 'Success', getQuizOptions());

const classes = async (req: Request, res: Response) => {
  try {
    return SuccessResponse(res, 'Success', await getQuizClassOptions(
      getProgramScopeFilter(req.user, 'quiz.view')
    ));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const lessons = async (req: Request, res: Response) => {
  try {
    return SuccessResponse(
      res,
      'Success',
      await getQuizLessonOptions(validateQuizClassCode(req.query.code))
    );
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const indexSuggestion = async (req: Request, res: Response) => {
  try {
    const result = await getQuizIndexSuggestion(validateQuizIndexSuggestionQuery(req.query));
    return SuccessResponse(res, 'Success', {
      ...result,
      duplicate: result.duplicate ? await visibleRecord(req, result.duplicate) : null,
    });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const detail = async (req: Request, res: Response) => {
  try {
    const result = await getQuizDetail(validateQuizId(req.params.quizId));
    return SuccessResponse(res, 'Success', await visibleRecord(req, result));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const create = async (req: Request, res: Response) => {
  try {
    const payload = validateQuizPayload(req.body) as any;
    const result = await createNewQuiz(payload, String(req.user?.username || req.user?.userId || 'system'));
    return res.status(201).json({ success: true, message: 'Created', data: await visibleRecord(req, result) });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const update = async (req: Request, res: Response) => {
  try {
    const quizId = validateQuizId(req.params.quizId);
    const payload = validateQuizPayload(req.body, true) as any;
    const result = await updateExistingQuiz(quizId, payload);
    return SuccessResponse(res, 'Updated', await visibleRecord(req, result));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const remove = async (req: Request, res: Response) => {
  try {
    const result = await disableExistingQuiz(validateQuizId(req.params.quizId));
    return SuccessResponse(res, 'Disabled', await visibleRecord(req, result));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const restore = async (req: Request, res: Response) => {
  try {
    const result = await restoreExistingQuiz(validateQuizId(req.params.quizId));
    return SuccessResponse(res, 'Restored', await visibleRecord(req, result));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const bulkUpdate = async (req: Request, res: Response) => {
  try {
    const payload = validateQuizBulkPayload(req.body);
    const result = await bulkUpdateExistingQuizzes(payload);
    return SuccessResponse(res, 'Bulk updated', await visibleRecords(req, result as any[]));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const reorder = async (req: Request, res: Response) => {
  try {
    const result = await reorderExistingQuizzes(validateQuizReorderPayload(req.body));
    return SuccessResponse(res, 'Reordered', await visibleRecords(req, result as any[]));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const exportFile = async (req: Request, res: Response) => {
  try {
    const query = validateQuizExportQuery(req.query);
    if (!query.code) return ErrorResponse(res, 'Vui lòng chọn Chương trình', 400);
    const result = await exportQuizzes(
      query,
      (rows) => visibleRecords(req, rows),
      getProgramScopeFilter(req.user, 'quiz.export')
    );
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const template = async (req: Request, res: Response) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    assertProgramAccess(req.user, 'quiz.import', validateQuizClassCode(req.query.code));
    const result = getQuizImportTemplate(format);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const importFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) return ErrorResponse(res, 'Vui lòng chọn file import', 400);
    const extension = req.file.originalname.split('.').pop()?.toLowerCase();
    if (extension !== 'xlsx' && extension !== 'csv') return ErrorResponse(res, 'Chỉ hỗ trợ file .xlsx hoặc .csv', 400);
    await FieldPermissionService.assertEditableFields(
      req.user?.roleIds || [],
      'quiz',
      [...QUIZ_MUTABLE_FIELDS]
    );
    const code = validateQuizClassCode(req.body?.code);
    assertProgramAccess(req.user, 'quiz.import', code);
    const rawRows = parseQuizImportFile(req.file.buffer, req.file.originalname).map((row) => ({ ...row, code }));
    if (!rawRows.length) return ErrorResponse(res, 'File import không có dữ liệu', 400);
    const { validRows, errors } = validateQuizImportRows(rawRows);
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'File import có dữ liệu không hợp lệ', errors });
    }
    const result = await importQuizRows(
      validRows,
      parseQuizImportMode(req.body?.mode),
      String(req.user?.username || req.user?.userId || 'system')
    );
    return SuccessResponse(res, 'Imported', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

export default {
  list, options, classes, lessons, indexSuggestion, detail, create, update, remove, restore, bulkUpdate, reorder,
  exportFile, template, importFile,
};
