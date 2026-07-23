"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const apiResponse_1 = require("../../utils/apiResponse");
const getModules = async (req, res) => {
    try {
        const modules = await field_permission_service_1.default.getModules();
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', modules);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
const getModuleFields = async (req, res) => {
    try {
        const code = String(req.params.code);
        const module = await field_permission_service_1.default.getModuleFields(code);
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', module);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
exports.default = {
    getModules,
    getModuleFields,
};
