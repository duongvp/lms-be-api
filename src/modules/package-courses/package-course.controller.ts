import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import { listPackageCoursesFromSheet } from '../../integrations/package-course-sheet.service';

export const list = async (_req: Request, res: Response) => {
  try {
    return SuccessResponse(res, 'Success', await listPackageCoursesFromSheet());
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 503);
  }
};
