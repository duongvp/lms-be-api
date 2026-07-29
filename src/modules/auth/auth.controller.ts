import { Request, Response, NextFunction } from 'express';
import * as authServices from './auth.service';
import { PrismaClient } from '@prisma/client';
import { SuccessResponse, ErrorResponse } from '../../utils/apiResponse';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

const REFRESH_COOKIE_NAME = 'refreshToken';
const refreshCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
};

const getCookie = (req: Request, name: string) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return undefined;

    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim();
        if (key === name) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }
    return undefined;
};

const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
        logger.info(`User ${userData.userId} logged in`);
        const { refreshToken, ...rest } = userData;
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
        SuccessResponse(res, 'Login successful', {
            ...rest,
        });

    } catch (error: any) {
        logger.error(`Login failed for ${username}: ${error.message}`);
        ErrorResponse(res, error.message, error.statusCode || 401);
    }
};

// Làm mới token
const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const refreshToken = getCookie(req, REFRESH_COOKIE_NAME);
        if (!refreshToken) {
            res.status(401).json({ success: false, message: 'Missing refresh token' });
            return;
        }
        const tokens = await authServices.refreshToken(refreshToken);
        res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions);

        SuccessResponse(res, 'Token refreshed', { accessToken: tokens.accessToken });
    } catch (error: any) {
        next(error);
    }
};

// Đăng xuất
const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        await authServices.logout((req as any).user.sessionId);
        res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
        SuccessResponse(res, 'Logout successful');
    } catch (error: any) {
        next(error);
    }
};

const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const data = await authServices.getMe((req as any).user.userId);

        SuccessResponse(res, 'Get current user successfully', data);
    } catch (error: any) {
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
