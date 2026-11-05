import { Request, Response } from 'express';
import { ErrorResponse, SuccessResponse } from '../../utils/apiResponse';
import { listPackageCoursesFromSheet } from '../../integrations/package-course-sheet.service';

export const list = async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return SuccessResponse(res, 'Success', await listPackageCoursesFromSheet(req.query.refresh === 'true'));
  } catch (error: any) {
    return ErrorResponse(res, error.message, error.statusCode || 503);
  }
};
