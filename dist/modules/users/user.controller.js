"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = __importDefault(require("./user.service"));
const apiResponse_1 = require("../../utils/apiResponse");
const createUser = async (req, res) => {
    try {
        const result = await user_service_1.default.createAdminUser({
            username: req.body?.username,
            name: req.body?.name,
            email: req.body?.email,
            phone: req.body?.phone,
            roleIds: Array.isArray(req.body?.roleIds) ? req.body.roleIds : [],
        });
        return res.status(201).json({ success: true, message: 'Created', data: result });
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 400);
    }
};
const getAllUsers = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
        const keyword = typeof req.query.keyword === 'string'
            ? req.query.keyword.trim().slice(0, 200) || undefined
            : undefined;
        const users = await user_service_1.default.getAllUsers({ page, limit, keyword });
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', users);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await user_service_1.default.getUserById(Number(id));
        return (0, apiResponse_1.SuccessResponse)(res, 'Success', user);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const userData = req.body;
        const updatedUser = await user_service_1.default.updateUser(Number(id), userData);
        return (0, apiResponse_1.SuccessResponse)(res, 'User updated successfully', updatedUser);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
const deleteUser = async (req, res) => {
    try {
        const result = await user_service_1.default.deleteAdminUser(Number(req.params.id), Number(req.user?.userId));
        return (0, apiResponse_1.SuccessResponse)(res, result.message, result);
    }
    catch (error) {
        return (0, apiResponse_1.ErrorResponse)(res, error.message, error.statusCode || 500);
    }
};
exports.default = {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
};
