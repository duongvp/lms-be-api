import { Request, Response } from 'express';
import FieldPermissionService from '../roles/field-permission.service';
import { SuccessResponse, ErrorResponse } from '../../utils/apiResponse';

const getModules = async (req: Request, res: Response) => {
    try {
        const modules = await FieldPermissionService.getModules();
        return SuccessResponse(res, 'Success', modules);
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 500);
    }
};

const getModuleFields = async (req: Request, res: Response) => {
    try {
        const code = String(req.params.code);
        const module = await FieldPermissionService.getModuleFields(code);
        return SuccessResponse(res, 'Success', module);
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 500);
    }
};

export default {
    getModules,
    getModuleFields,
};
