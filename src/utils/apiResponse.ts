import { Response } from 'express';

export const SuccessResponse = (res: Response, message: string, data: any = {}) => {
    return res.status(200).json({
        success: true,
        message,
        data
    });
};

export const ErrorResponse = (res: Response, message: string, statusCode: number = 500) => {
    return res.status(statusCode).json({
        success: false,
        message
    });
};
