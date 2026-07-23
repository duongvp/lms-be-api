"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorResponse = exports.SuccessResponse = void 0;
const SuccessResponse = (res, message, data = {}) => {
    return res.status(200).json({
        success: true,
        message,
        data
    });
};
exports.SuccessResponse = SuccessResponse;
const ErrorResponse = (res, message, statusCode = 500) => {
    return res.status(statusCode).json({
        success: false,
        message
    });
};
exports.ErrorResponse = ErrorResponse;
