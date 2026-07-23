"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyOTP = exports.requestPasswordReset = exports.register = exports.logout = exports.refreshToken = exports.getMe = exports.login = exports.generateTokens = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const constants_1 = require("./constants");
const logger_1 = require("../../utils/logger");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const prisma = new client_1.PrismaClient();
const HOCMAI_CHECK_LOGIN_URL = 'https://hocmai.vn/ladipage/check_login.php';
const HOCMAI_CHECK_LOGIN_TOKEN = process.env.HOCMAI_CHECK_LOGIN_TOKEN || '06d06b11-a058-49af-81d4-88e863f3093a';
// Helper function để tạo tokens
const generateTokens = (userId, rememberMe) => {
    try {
        const accessToken = jsonwebtoken_1.default.sign({ userId, type: constants_1.TOKEN_TYPES.ACCESS }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN });
        const refreshToken = jsonwebtoken_1.default.sign({ userId, type: constants_1.TOKEN_TYPES.REFRESH }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: (rememberMe ? process.env.REFRESH_TOKEN_EXPIRES_IN : process.env.REFRESH_TOKEN_SHORT_EXPIRES_IN) });
        logger_1.logger.debug(`Tokens generated for user ${userId}`);
        return { accessToken, refreshToken };
    }
    catch (error) {
        logger_1.logger.error(`Token generation failed: ${error.message}`);
        throw error;
    }
};
exports.generateTokens = generateTokens;
const login = async (username, password, rememberMe) => {
    try {
        // 1. Authenticate via Hocmai API
        // const externalRes = await fetch(HOCMAI_CHECK_LOGIN_URL, {
        //     method: 'POST',
        //     headers: {
        //         'Authorization': `Bearer ${HOCMAI_CHECK_LOGIN_TOKEN}`,
        //         'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify({ user: username, password }),
        // });
        // const data = await externalRes.json().catch(() => null);
        // if (!externalRes.ok || !data?.success) {
        //     throw new ApiError(data?.message || 'Tài khoản không tồn tại hoặc sai mật khẩu.', 401);
        // }
        const data = {
            "success": true,
            "message": "Đăng nhập thành công",
            "data": {
                "user_name": "admin",
                "profile": {
                    "name": "Admin 283"
                }
            }
        };
        const hocmaiUsername = data.data.user_name;
        const hocmaiName = data.data.profile?.name;
        // 2. Tìm user trong DB để lấy quyền
        // Lưu ý: Có thể có nhiều dòng trong bảng users (do enroll nhiều khóa), ta lấy dòng đầu tiên.
        let user = await prisma.users.findFirst({
            where: { username: hocmaiUsername }
        });
        console.log("user", user);
        if (!user) {
            throw new ApiError_1.default('Tài khoản không có quyền truy cập hệ thống quản trị', 403);
        }
        // 3. Lấy RBAC Roles và Permissions từ Prisma
        const userRoles = await prisma.userRoles.findMany({
            where: { userId: user.id },
            include: {
                role: {
                    include: {
                        rolePermissions: {
                            include: {
                                permission: true
                            }
                        }
                    }
                }
            }
        });
        const roles = userRoles.map(ur => ur.role);
        const permissionsMap = new Map();
        roles.forEach(r => {
            r.rolePermissions.forEach(rp => {
                if (rp.permission) {
                    permissionsMap.set(rp.permission.code, rp.permission);
                }
            });
        });
        const permissions = Array.from(permissionsMap.values());
        const permissionCodes = permissions.map(p => p.code);
        // 4. Tạo tokens
        const tokens = (0, exports.generateTokens)(user.id, rememberMe);
        // 5. Trả về userData
        const userData = {
            userId: user.id,
            username: user.username,
            full_name: hocmaiName || user.name,
            roles: roles.map(r => ({ id: r.id.toString(), code: r.code, name: r.name, fieldPolicy: r.fieldPolicy })),
            permissions: permissionCodes,
            ...tokens
        };
        console.log("userData", userData);
        logger_1.logger.info(`User logged in: ${user.id}`);
        return userData;
    }
    catch (error) {
        logger_1.logger.error('Login failed', error);
        if (error instanceof ApiError_1.default)
            throw error;
        throw new ApiError_1.default('Login failed: ' + error.message, 500);
    }
};
exports.login = login;
const getMe = async (userId) => {
    try {
        const user = await prisma.users.findUnique({
            where: { id: userId }
        });
        if (!user) {
            throw new ApiError_1.default('User not found', 404);
        }
        const userRoles = await prisma.userRoles.findMany({
            where: { userId: user.id },
            include: {
                role: {
                    include: {
                        rolePermissions: {
                            include: {
                                permission: true
                            }
                        }
                    }
                }
            }
        });
        const roles = userRoles.map(ur => ur.role);
        const permissionsMap = new Map();
        roles.forEach(r => {
            r.rolePermissions.forEach(rp => {
                if (rp.permission) {
                    permissionsMap.set(rp.permission.code, rp.permission);
                }
            });
        });
        const permissions = Array.from(permissionsMap.values());
        const permissionCodes = permissions.map(p => p.code);
        return {
            userId: user.id,
            username: user.username,
            full_name: user.name,
            roles: roles.map(r => ({ id: r.id.toString(), code: r.code, name: r.name })),
            permissions: permissionCodes,
        };
    }
    catch (error) {
        throw new ApiError_1.default(error.message, error.statusCode || 500);
    }
};
exports.getMe = getMe;
const refreshToken = async (refreshTokenString) => {
    try {
        const decoded = jsonwebtoken_1.default.verify(refreshTokenString, process.env.REFRESH_TOKEN_SECRET);
        if (decoded.type !== constants_1.TOKEN_TYPES.REFRESH) {
            throw new Error('Invalid token type');
        }
        const user = await prisma.users.findUnique({
            where: { id: decoded.userId }
        });
        if (!user) {
            throw new Error('Invalid refresh token');
        }
        const accessToken = jsonwebtoken_1.default.sign({ userId: user.id, type: constants_1.TOKEN_TYPES.ACCESS }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN });
        return { accessToken };
    }
    catch (error) {
        logger_1.logger.error('Refresh token failed', error);
        throw error;
    }
};
exports.refreshToken = refreshToken;
const logout = async (userId) => {
    try {
        // Here we could invalidate the refresh token if we were storing it in the DB.
        logger_1.logger.info(`User logged out: ${userId}`);
        return true;
    }
    catch (error) {
        logger_1.logger.error('Logout failed', error);
        throw error;
    }
};
exports.logout = logout;
// Dummy exports for unused functions to prevent breaking controller
const register = async (data) => { throw new Error("Not implemented"); };
exports.register = register;
const requestPasswordReset = async (email) => { throw new Error("Not implemented"); };
exports.requestPasswordReset = requestPasswordReset;
const verifyOTP = async (email, otp) => { throw new Error("Not implemented"); };
exports.verifyOTP = verifyOTP;
const resetPassword = async (token, pass) => { throw new Error("Not implemented"); };
exports.resetPassword = resetPassword;
