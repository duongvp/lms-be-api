import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import {
  bulkUpdateExistingLessons,
  createNewLesson,
  createNewProgram,
  deleteExistingLesson,
  exportLessons,
  getLessonImportTemplate,
  getLessonDetail,
  getLessonSubjects,
  getLessonPrograms,
  getCourseMappingsByProgram,
  changeLessonCourseMappings,
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
  validateLessonCourseMappingPayload,
} from './lesson.validation';
import {
  parseLessonImportFile,
} from './lesson.io';
import { LessonImportMode, LessonPayload } from './lesson.types';
import FieldPermissionService from '../roles/field-permission.service';
import { issueLessonSecondaryToken } from './lesson-secondary-auth';
import { findLessonProgramByCode } from './lesson.repository';
import { getProgramScopeFilter } from '../../services/authorization.service';

const reauthenticate = async (req: Request, res: Response) => {
  try {
    return SuccessResponse(
      res,
      'Xác thực cấp 2 thành công',
      issueLessonSecondaryToken(req, req.body?.password)
    );
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const reauthStatus = async (_req: Request, res: Response) => (
  SuccessResponse(res, 'Phiên xác thực cấp 2 còn hiệu lực', { valid: true })
);

const list = async (req: Request, res: Response) => {
  try {
    const query = validateLessonListQuery(req.query);
    if (!query.subject_code) {
      return ErrorResponse(res, 'Vui lòng chọn Chương trình', 400);
    }
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

const subjects = async (_req: Request, res: Response) => {
  try {
    return SuccessResponse(res, 'Success', await getLessonSubjects());
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const programs = async (req: Request, res: Response) => {
  try {
    return SuccessResponse(res, 'Success', await getLessonPrograms(
      getProgramScopeFilter(req.user, 'lessons.view')
    ));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const createProgram = async (req: Request, res: Response) => {
  try {
    const payload = validateLessonPayload({
      ...req.body,
      learn_number: 1,
    }) as LessonPayload;
    const result = await createNewProgram(payload);
    return res.status(201).json({
      success: true,
      message: 'Đã tạo Chương trình và bài học đầu tiên',
      data: result,
    });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const courseMappings = async (req: Request, res: Response) => {
  try {
    const programCode = String(req.query.program_code || '').trim();
    if (!programCode) return ErrorResponse(res, 'Vui lòng chọn Chương trình', 400);
    return SuccessResponse(res, 'Success', await getCourseMappingsByProgram(programCode));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const updateCourseMappings = async (req: Request, res: Response) => {
  try {
    const payload = validateLessonCourseMappingPayload(req.body);
    return SuccessResponse(res, 'Updated', await changeLessonCourseMappings(payload));
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
    const result = await exportLessons(query, (rows) => (
      FieldPermissionService.filterVisibleRecords(req.user?.roleIds || [], 'lessons', rows)
    ));
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
    const programCode = String(req.query.program_code || '').trim();
    if (!programCode) return ErrorResponse(res, 'Vui lòng chọn Chương trình trước khi tải file mẫu', 400);
    const program = await findLessonProgramByCode(programCode);
    if (!program) return ErrorResponse(res, 'Chương trình không tồn tại hoặc chưa có đề cương', 404);
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

    const programCode = String(req.body?.program_code || '').trim();
    if (!programCode) {
      return ErrorResponse(res, 'Vui lòng chọn Chương trình trước khi import', 400);
    }
    const program = await findLessonProgramByCode(programCode);
    if (!program) {
      return ErrorResponse(res, 'Chương trình không tồn tại hoặc chưa có đề cương', 404);
    }

    const mode: LessonImportMode = req.body?.mode === 'skip' ? 'skip' : 'overwrite';
    const rawRows = parseLessonImportFile(file.buffer, file.originalname).map((row) => ({
      ...row,
      grade: program.grade,
      subject_code: program.subject_code,
      subject_name: program.subject_name,
    }));
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
  reauthenticate,
  reauthStatus,
  list,
  subjects,
  programs,
  createProgram,
  courseMappings,
  updateCourseMappings,
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
