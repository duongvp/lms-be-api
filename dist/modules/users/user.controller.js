"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const user_service_1 = __importDefault(require("./user.service"));
const apiResponse_1 = require("../../utils/apiResponse");
const getAllUsers = async (req, res) => {
    try {
        const users = await user_service_1.default.getAllUsers();
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
// Giữ lại các hàm khác nếu cần, nhưng comment do schema chưa hỗ trợ
// const deleteUser = ...
// const toggleUserStatus = ...
exports.default = {
    getAllUsers,
    getUserById,
    updateUser,
    // deleteUser,
    // toggleUserStatus,
};
