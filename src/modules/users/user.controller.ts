import { Request, Response } from 'express';
import UserService from './user.service';
import { SuccessResponse, ErrorResponse } from '../../utils/apiResponse';

const createUser = async (req: Request, res: Response) => {
    try {
        const result = await UserService.createAdminUser({
            username: req.body?.username,
            name: req.body?.name,
            email: req.body?.email,
            phone: req.body?.phone,
            roleIds: Array.isArray(req.body?.roleIds) ? req.body.roleIds : [],
        });
        return res.status(201).json({ success: true, message: 'Created', data: result });
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 400);
    }
};

const getAllUsers = async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
        const keyword = typeof req.query.keyword === 'string'
            ? req.query.keyword.trim().slice(0, 200) || undefined
            : undefined;
        const users = await UserService.getAllUsers({ page, limit, keyword });
        return SuccessResponse(res, 'Success', users);
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 500);
    }
};

const getUserById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const user = await UserService.getUserById(Number(id));
        return SuccessResponse(res, 'Success', user);
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 500);
    }
};

const updateUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userData = req.body;
        const updatedUser = await UserService.updateUser(Number(id), userData);
        return SuccessResponse(res, 'User updated successfully', updatedUser);
    } catch (error: any) {
        return ErrorResponse(res, error.message, error.statusCode || 500);
    }
};

// Giữ lại các hàm khác nếu cần, nhưng comment do schema chưa hỗ trợ
// const deleteUser = ...
// const toggleUserStatus = ...

export default {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    // deleteUser,
    // toggleUserStatus,
};
