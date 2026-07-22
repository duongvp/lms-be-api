import { Request, Response, NextFunction } from 'express';
import * as authServices from './auth.service';
import { PrismaClient } from '@prisma/client';
import { SuccessResponse, ErrorResponse } from '../../utils/apiResponse';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        console.log('Req', req.body);
        const { accessToken, refreshToken, userId } = await authServices.register(req.body) as any;

        logger.info(`User ${userId} registered successfully`);
        SuccessResponse(res, 'Registration successful', {
            userId,
            accessToken,
            refreshToken
        });
    } catch (error: any) {
        logger.error(`Registration failed: ${error.message}`);
        next(error);
    }
};

const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { username, password, rememberMe } = req.body;

    try {
        const userData = await authServices.login(username, password, rememberMe);
        console.log('🚀 ~ login ~ userData:', userData);

        logger.info(`User ${userData.userId} logged in`);

        // Set refreshToken vào HTTP-only cookie (thường là trong controller, không phải service)
        const { refreshToken, ...rest } = userData;

        const roleAndPermission = {
            roles: rest.roles,
            permissions: rest.permissions
        };

        // giải pháp tạm thời
        SuccessResponse(res, 'Login successful', {
            ...rest,
            refreshToken,
            user: encodeURIComponent(JSON.stringify(roleAndPermission))
        });

    } catch (error: any) {
        logger.error(`Login failed for ${username}: ${error.message}`);
        ErrorResponse(res, error.message, 401);
    }
};

// Làm mới token
const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const refreshToken = (req as any).cookies?.refreshToken;
        if (!refreshToken) {
            throw new Error("Missing refresh token");
        }
        const { accessToken } = await authServices.refreshToken(refreshToken);

        SuccessResponse(res, 'Token refreshed', { accessToken });
    } catch (error: any) {
        console.log('🚀 ~ refreshToken ~ error:', error);
        next(error);
    }
};

// Đăng xuất
const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        await authServices.logout((req as any).user.userId);
        SuccessResponse(res, 'Logout successful');
    } catch (error: any) {
        next(error);
    }
};

const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        console.log('req.user.userId', (req as any).user.userId);

        const data = await authServices.getMe((req as any).user.userId);

        SuccessResponse(res, 'Get current user successfully', data);
    } catch (error: any) {
        console.log('🚀 ~ getMe ~ error:', error);
        next(error);
    }
};

// Lấy thông tin user
const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = (req as any).user.userId;
        const user = await prisma.users.findUnique({
            where: { id: userId },
            select: { id: true, username: true, email: true, created_at: true }
        });

        SuccessResponse(res, 'Profile retrieved', user);
    } catch (error: any) {
        next(error);
    }
};

const requestPasswordReset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { email } = req.body;
        console.log('🚀 ~ requestPasswordReset ~ email:', email);

        const result = await authServices.requestPasswordReset(email);

        logger.info(`Password reset OTP sent to ${email}`);
        SuccessResponse(res, 'OTP đã được gửi đến email của bạn', result);
    } catch (error: any) {
        logger.error(`Password reset request failed for ${error.message}`);
        next(error);
    }
};

/**
 * Xác thực OTP để đặt lại mật khẩu
 */
const verifyOTP = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { email, otp } = req.body;
        const { resetToken } = await authServices.verifyOTP(email, otp) as any;

        logger.info(`OTP verified for ${email}`);
        SuccessResponse(res, 'Xác thực OTP thành công', { resetToken });
    } catch (error: any) {
        logger.error(`OTP verification failed for: ${error.message}`);
        next(error);
    }
};

/**
 * Đặt lại mật khẩu mới sau khi xác thực OTP
 */
const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { resetToken, newPassword } = req.body;

        const result = await authServices.resetPassword(resetToken, newPassword);

        logger.info('Password reset successfully');
        SuccessResponse(res, 'Đặt lại mật khẩu thành công', result);
    } catch (error: any) {
        logger.error(`Password reset failed: ${error.message}`);
        next(error);
    }
};

export default {
    register,
    login,
    refreshToken,
    logout,
    getProfile,
    getMe,
    requestPasswordReset,
    verifyOTP,
    resetPassword
};