"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const authServices = __importStar(require("./auth.service"));
const client_1 = require("@prisma/client");
const apiResponse_1 = require("../../utils/apiResponse");
const logger_1 = require("../../utils/logger");
const prisma = new client_1.PrismaClient();
const register = async (req, res, next) => {
    try {
        console.log('Req', req.body);
        const { accessToken, refreshToken, userId } = await authServices.register(req.body);
        logger_1.logger.info(`User ${userId} registered successfully`);
        (0, apiResponse_1.SuccessResponse)(res, 'Registration successful', {
            userId,
            accessToken,
            refreshToken
        });
    }
    catch (error) {
        logger_1.logger.error(`Registration failed: ${error.message}`);
        next(error);
    }
};
const login = async (req, res, next) => {
    const { username, password, rememberMe } = req.body;
    try {
        const userData = await authServices.login(username, password, rememberMe);
        console.log('🚀 ~ login ~ userData:', userData);
        logger_1.logger.info(`User ${userData.userId} logged in`);
        // Set refreshToken vào HTTP-only cookie (thường là trong controller, không phải service)
        const { refreshToken, ...rest } = userData;
        const roleAndPermission = {
            roles: rest.roles,
            permissions: rest.permissions
        };
        // giải pháp tạm thời
        (0, apiResponse_1.SuccessResponse)(res, 'Login successful', {
            ...rest,
            refreshToken,
            user: encodeURIComponent(JSON.stringify(roleAndPermission))
        });
    }
    catch (error) {
        logger_1.logger.error(`Login failed for ${username}: ${error.message}`);
        (0, apiResponse_1.ErrorResponse)(res, error.message, 401);
    }
};
// Làm mới token
const refreshToken = async (req, res, next) => {
    try {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            throw new Error("Missing refresh token");
        }
        const { accessToken } = await authServices.refreshToken(refreshToken);
        (0, apiResponse_1.SuccessResponse)(res, 'Token refreshed', { accessToken });
    }
    catch (error) {
        console.log('🚀 ~ refreshToken ~ error:', error);
        next(error);
    }
};
// Đăng xuất
const logout = async (req, res, next) => {
    try {
        await authServices.logout(req.user.userId);
        (0, apiResponse_1.SuccessResponse)(res, 'Logout successful');
    }
    catch (error) {
        next(error);
    }
};
const getMe = async (req, res, next) => {
    try {
        console.log('req.user.userId', req.user.userId);
        const data = await authServices.getMe(req.user.userId);
        (0, apiResponse_1.SuccessResponse)(res, 'Get current user successfully', data);
    }
    catch (error) {
        console.log('🚀 ~ getMe ~ error:', error);
        next(error);
    }
};
// Lấy thông tin user
const getProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await prisma.users.findUnique({
            where: { id: userId },
            select: { id: true, username: true, email: true, created_at: true }
        });
        (0, apiResponse_1.SuccessResponse)(res, 'Profile retrieved', user);
    }
    catch (error) {
        next(error);
    }
};
const requestPasswordReset = async (req, res, next) => {
    try {
        const { email } = req.body;
        console.log('🚀 ~ requestPasswordReset ~ email:', email);
        const result = await authServices.requestPasswordReset(email);
        logger_1.logger.info(`Password reset OTP sent to ${email}`);
        (0, apiResponse_1.SuccessResponse)(res, 'OTP đã được gửi đến email của bạn', result);
    }
    catch (error) {
        logger_1.logger.error(`Password reset request failed for ${error.message}`);
        next(error);
    }
};
/**
 * Xác thực OTP để đặt lại mật khẩu
 */
const verifyOTP = async (req, res, next) => {
    try {
        const { email, otp } = req.body;
        const { resetToken } = await authServices.verifyOTP(email, otp);
        logger_1.logger.info(`OTP verified for ${email}`);
        (0, apiResponse_1.SuccessResponse)(res, 'Xác thực OTP thành công', { resetToken });
    }
    catch (error) {
        logger_1.logger.error(`OTP verification failed for: ${error.message}`);
        next(error);
    }
};
/**
 * Đặt lại mật khẩu mới sau khi xác thực OTP
 */
const resetPassword = async (req, res, next) => {
    try {
        const { resetToken, newPassword } = req.body;
        const result = await authServices.resetPassword(resetToken, newPassword);
        logger_1.logger.info('Password reset successfully');
        (0, apiResponse_1.SuccessResponse)(res, 'Đặt lại mật khẩu thành công', result);
    }
    catch (error) {
        logger_1.logger.error(`Password reset failed: ${error.message}`);
        next(error);
    }
};
exports.default = {
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
