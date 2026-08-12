import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import FieldPermissionService from '../roles/field-permission.service';
import {
  createTeacherProfile,
  deleteTeacherProfile,
  getTeacherProfile,
  getTeacherProfilesForExport,
  importTeacherProfiles,
  listTeacherProfiles,
  updateTeacherProfile,
  updateTeacherProfileStatus,
} from './teacher-profile.service';
import {
  validateTeacherProfileId,
  validateTeacherProfileListQuery,
  validateTeacherProfilePayload,
  validateTeacherProfileStatusPayload,
} from './teacher-profile.validation';
import { serializeBigInt } from '../../lib/serializer';
import {
  buildTeacherProfileFile,
  buildTeacherProfileTemplate,
  getTeacherProfileFileContentType,
  parseTeacherProfileFile,
  validateTeacherProfileImportRows,
} from './teacher-profile.io';
import { TeacherProfileImportMode } from './teacher-profile.types';

const list = async (req: Request, res: Response) => {
  try {
    const result = await listTeacherProfiles(validateTeacherProfileListQuery(req.query));
    const data = await FieldPermissionService.filterVisibleRecords(
      req.user?.roleIds || [],
      'teacher_profile',
      result.data as any[]
    );
    return SuccessResponse(res, 'Lấy danh sách nhân sự thành công', { ...result, data });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const detail = async (req: Request, res: Response) => {
  try {
    const result = await getTeacherProfile(validateTeacherProfileId(req.params.id));
    const data = await FieldPermissionService.filterVisibleRecord(
      req.user?.roleIds || [],
      'teacher_profile',
      result as any
    );
    return SuccessResponse(res, 'Lấy thông tin nhân sự thành công', data);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const create = async (req: Request, res: Response) => {
  try {
    const result = await createTeacherProfile(validateTeacherProfilePayload(req.body));
    return res.status(201).json({
      success: true,
      message: 'Đã thêm nhân sự giảng dạy',
      data: serializeBigInt(result),
    });
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const update = async (req: Request, res: Response) => {
  try {
    const result = await updateTeacherProfile(
      validateTeacherProfileId(req.params.id),
      validateTeacherProfilePayload(req.body, true)
    );
    return SuccessResponse(res, 'Đã cập nhật nhân sự giảng dạy', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const updateStatus = async (req: Request, res: Response) => {
  try {
    const { status } = validateTeacherProfileStatusPayload(req.body);
    const result = await updateTeacherProfileStatus(
      validateTeacherProfileId(req.params.id),
      status
    );
    return SuccessResponse(res, 'Đã cập nhật trạng thái nhân sự', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const remove = async (req: Request, res: Response) => {
  try {
    const result = await deleteTeacherProfile(validateTeacherProfileId(req.params.id));
    return SuccessResponse(res, 'Đã xóa nhân sự giảng dạy', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const exportFile = async (req: Request, res: Response) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const query = validateTeacherProfileListQuery({
      ...req.query,
      page: 1,
      limit: 100,
    });
    const rows = await getTeacherProfilesForExport({
      search: query.search,
      can_view_stream_key: query.can_view_stream_key,
      status: query.status,
    });
    const buffer = buildTeacherProfileFile(rows, format);
    res.setHeader('Content-Type', getTeacherProfileFileContentType(format));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nhan-su-giang-day-${Date.now()}.${format}"`
    );
    return res.send(buffer);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

const template = async (req: Request, res: Response) => {
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  res.setHeader('Content-Type', getTeacherProfileFileContentType(format));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="mau-nhap-nhan-su-giang-day.${format}"`
  );
  return res.send(buildTeacherProfileTemplate(format));
};

const importFile = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return ErrorResponse(res, 'Vui lòng chọn file cần nhập', 400);
    }
    const parsedRows = parseTeacherProfileFile(
      req.file.buffer,
      req.file.originalname
    );

    const { data, errors } = validateTeacherProfileImportRows(parsedRows);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'File có dữ liệu không hợp lệ',
        errors,
      });
    }
    const mode: TeacherProfileImportMode =
      req.body?.mode === 'overwrite' ? 'overwrite' : 'skip';
    const result = await importTeacherProfiles(data, mode);
    return SuccessResponse(res, 'Nhập danh sách nhân sự thành công', result);
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 400);
  }
};

export default {
  list,
  detail,
  create,
  update,
  updateStatus,
  remove,
  exportFile,
  template,
  importFile,
};
