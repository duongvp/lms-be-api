import { Request, Response } from 'express';
import UserService from './user.service';
import { SuccessResponse, ErrorResponse } from '../../utils/apiResponse';

const getAllUsers = async (req: Request, res: Response) => {
    try {
        const users = await UserService.getAllUsers();
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
    getAllUsers,
    getUserById,
    updateUser,
    // deleteUser,
    // toggleUserStatus,
};