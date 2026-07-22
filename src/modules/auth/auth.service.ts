import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { TOKEN_TYPES } from './constants';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import ApiError from '../../utils/ApiError';

const prisma = new PrismaClient();

const HOCMAI_CHECK_LOGIN_URL = 'https://hocmai.vn/ladipage/check_login.php';
const HOCMAI_CHECK_LOGIN_TOKEN = process.env.HOCMAI_CHECK_LOGIN_TOKEN || '06d06b11-a058-49af-81d4-88e863f3093a';

// Helper function để tạo tokens
export const generateTokens = (userId: number, rememberMe: boolean) => {
    try {
        const accessToken = jwt.sign(
            { userId, type: TOKEN_TYPES.ACCESS },
            process.env.ACCESS_TOKEN_SECRET as string,
            { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as any }
        );

        const refreshToken = jwt.sign(
            { userId, type: TOKEN_TYPES.REFRESH },
            process.env.REFRESH_TOKEN_SECRET as string,
            { expiresIn: (rememberMe ? process.env.REFRESH_TOKEN_EXPIRES_IN : process.env.REFRESH_TOKEN_SHORT_EXPIRES_IN) as any }
        );

        logger.debug(`Tokens generated for user ${userId}`);
        return { accessToken, refreshToken };
    } catch (error: any) {
        logger.error(`Token generation failed: ${error.message}`);
        throw error;
    }
};

export const login = async (username: string, password: string, rememberMe: boolean) => {
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
        }

        const hocmaiUsername = data.data.user_name;
        const hocmaiName = data.data.profile?.name;

        // 2. Tìm user trong DB để lấy quyền
        // Lưu ý: Có thể có nhiều dòng trong bảng users (do enroll nhiều khóa), ta lấy dòng đầu tiên.
        let user = await prisma.users.findFirst({
            where: { username: hocmaiUsername }
        });

        console.log("user", user)

        if (!user) {
            throw new ApiError('Tài khoản không có quyền truy cập hệ thống quản trị', 403);
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
        const tokens = generateTokens(user.id, rememberMe);

        // 5. Trả về userData
        const userData = {
            userId: user.id,
            username: user.username,
            full_name: hocmaiName || user.name,
            roles: roles.map(r => ({ id: r.id.toString(), code: r.code, name: r.name, fieldPolicy: r.fieldPolicy })),
            permissions: permissionCodes,
            ...tokens
        };
        console.log("userData", userData)
        logger.info(`User logged in: ${user.id}`);
        return userData;

    } catch (error: any) {
        logger.error('Login failed', error);
        if (error instanceof ApiError) throw error;
        throw new ApiError('Login failed: ' + error.message, 500);
    }
};

export const getMe = async (userId: number) => {
    try {
        const user = await prisma.users.findUnique({
            where: { id: userId }
        });

        if (!user) {
            throw new ApiError('User not found', 404);
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
    } catch (error: any) {
        throw new ApiError(error.message, error.statusCode || 500);
    }
};

export const refreshToken = async (refreshTokenString: string) => {
    try {
        const decoded: any = jwt.verify(refreshTokenString, process.env.REFRESH_TOKEN_SECRET as string);

        if (decoded.type !== TOKEN_TYPES.REFRESH) {
            throw new Error('Invalid token type');
        }

        const user = await prisma.users.findUnique({
            where: { id: decoded.userId }
        });

        if (!user) {
            throw new Error('Invalid refresh token');
        }

        const accessToken = jwt.sign(
            { userId: user.id, type: TOKEN_TYPES.ACCESS },
            process.env.ACCESS_TOKEN_SECRET as string,
            { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as any }
        );

        return { accessToken };
    } catch (error) {
        logger.error('Refresh token failed', error);
        throw error;
    }
};

export const logout = async (userId: number) => {
    try {
        // Here we could invalidate the refresh token if we were storing it in the DB.
        logger.info(`User logged out: ${userId}`);
        return true;
    } catch (error) {
        logger.error('Logout failed', error);
        throw error;
    }
};

// Dummy exports for unused functions to prevent breaking controller
export const register = async (data: any) => { throw new Error("Not implemented"); };
export const requestPasswordReset = async (email: string) => { throw new Error("Not implemented"); };
export const verifyOTP = async (email: string, otp: string) => { throw new Error("Not implemented"); };
export const resetPassword = async (token: string, pass: string) => { throw new Error("Not implemented"); };