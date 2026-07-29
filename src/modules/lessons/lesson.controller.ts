import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import {
  bulkUpdateExistingLessons,
  createNewLesson,
  deleteExistingLesson,
  exportLessons,
  getLessonImportTemplate,
  getLessonDetail,
  getLessons,
  importLessonRows,
  reorderExistingLessons,
  updateExistingLesson,
  validateLessonImportSequence,
} from './lesson.service';
import {
  validateLessonBulkUpdatePayload,
  validateLessonExportQuery,
  validateLessonId,
  validateLessonImportRows,
  validateLessonListQuery,
  validateLessonPayload,
  validateLessonReorderPayload,
} from './lesson.validation';
import {
  parseLessonImportFile,
} from './lesson.io';
import { LessonImportMode, LessonPayload } from './lesson.types';
import FieldPermissionService from '../roles/field-permission.service';

const list = async (req: Request, res: Response) => {
  try {
    const query = validateLessonListQuery(req.query);
    const result = await getLessons(query);
    const data = await FieldPermissionService.filterVisibleRecords(
      req.user?.roleIds || [],
      'lessons',
      result.data as any[]
    );
    return SuccessResponse(res, 'Success', { ...result, data });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const detail = async (req: Request, res: Response) => {
  try {
    const id = validateLessonId(req.params.id);
    const result = await getLessonDetail(id);
    const visibleResult = await FieldPermissionService.filterVisibleRecord(
      req.user?.roleIds || [],
      'lessons',
      result as any
    );
    return SuccessResponse(res, 'Success', visibleResult);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const create = async (req: Request, res: Response) => {
  try {
    const payload = validateLessonPayload(req.body) as LessonPayload;
    const result = await createNewLesson(payload);
    return res.status(201).json({ success: true, message: 'Created', data: result });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const update = async (req: Request, res: Response) => {
  try {
    const id = validateLessonId(req.params.id);
    const payload = validateLessonPayload(req.body, true);
    const result = await updateExistingLesson(id, payload);
    return SuccessResponse(res, 'Updated', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const bulkUpdate = async (req: Request, res: Response) => {
  try {
    const payload = validateLessonBulkUpdatePayload(req.body);
    const result = await bulkUpdateExistingLessons(payload);
    return SuccessResponse(res, 'Bulk updated', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const reorder = async (req: Request, res: Response) => {
  try {
    const payload = validateLessonReorderPayload(req.body);
    const result = await reorderExistingLessons(payload);
    return SuccessResponse(res, 'Reordered', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const exportFile = async (req: Request, res: Response) => {
  try {
    const query = validateLessonExportQuery(req.query);
    const result = await exportLessons(query);
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
    const result = getLessonImportTemplate(format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.buffer);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const importFile = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return ErrorResponse(res, 'Vui lòng chọn file import', 400);
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase();
    if (extension !== 'xlsx' && extension !== 'csv') {
      return ErrorResponse(res, 'Chỉ hỗ trợ file .xlsx hoặc .csv', 400);
    }

    const mode: LessonImportMode = req.body?.mode === 'skip' ? 'skip' : 'overwrite';
    const rawRows = parseLessonImportFile(file.buffer, file.originalname);
    const { validRows, errors } = validateLessonImportRows(rawRows);
    const sequenceErrors = errors.length ? [] : await validateLessonImportSequence(validRows, mode);
    const allErrors = [...errors, ...sequenceErrors];

    if (allErrors.length) {
      return res.status(400).json({
        success: false,
        message: 'File import có dữ liệu không hợp lệ',
        errors: allErrors,
      });
    }

    const result = await importLessonRows(validRows, mode);
    return SuccessResponse(res, 'Imported', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const remove = async (req: Request, res: Response) => {
  try {
    const id = validateLessonId(req.params.id);
    const result = await deleteExistingLesson(id);
    return SuccessResponse(res, 'Deleted', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

export default {
  list,
  detail,
  create,
  update,
  bulkUpdate,
  reorder,
  exportFile,
  template,
  importFile,
  remove,
};
