"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyOTP = exports.requestPasswordReset = exports.register = exports.logout = exports.refreshToken = exports.getMe = exports.login = exports.generateTokens = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const constants_1 = require("./constants");
const logger_1 = require("../../utils/logger");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const prisma = new client_1.PrismaClient();
const getRequiredSecret = (name) => {
    const value = process.env[name];
    if (!value || value.length < 32) {
        throw new ApiError_1.default(`${name} must be configured with at least 32 characters`, 503);
    }
    return value;
};
const getTokenTtl = (name, fallback) => {
    const value = process.env[name]?.trim() || fallback;
    if (/^\d+$/.test(value)) {
        return Number(value);
    }
    if (!/^\d+(ms|s|m|h|d|w|y)$/i.test(value)) {
        throw new ApiError_1.default(`${name} is invalid`, 503);
    }
    return value;
};
const hashToken = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
const safeEqual = (actual, expected) => {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
        && crypto_1.default.timingSafeEqual(actualBuffer, expectedBuffer);
};
const getTokenExpiry = (token) => {
    const decoded = jsonwebtoken_1.default.decode(token);
    if (!decoded?.exp)
        throw new ApiError_1.default('Token expiration is missing', 500);
    return new Date(decoded.exp * 1000);
};
const loadUserAccess = async (userId) => {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user)
        throw new ApiError_1.default('User not found', 404);
    const userRoles = await prisma.userRoles.findMany({
        where: {
            userId: user.id,
            role: { isActive: true },
        },
        include: {
            role: {
                include: {
                    rolePermissions: {
                        include: { permission: true },
                    },
                },
            },
        },
    });
    const roles = userRoles.map((item) => item.role);
    const permissionCodes = Array.from(new Set(roles.flatMap((role) => role.rolePermissions.map((item) => item.permission.code))));
    return { user, roles, permissionCodes };
};
const generateTokens = (userId, sessionId, rememberMe) => {
    const accessToken = jsonwebtoken_1.default.sign({ userId, sessionId, type: constants_1.TOKEN_TYPES.ACCESS }, getRequiredSecret('ACCESS_TOKEN_SECRET'), { expiresIn: getTokenTtl('ACCESS_TOKEN_EXPIRES_IN', '15m') });
    const refreshToken = jsonwebtoken_1.default.sign({ userId, sessionId, rememberMe, type: constants_1.TOKEN_TYPES.REFRESH }, getRequiredSecret('REFRESH_TOKEN_SECRET'), {
        expiresIn: getTokenTtl(rememberMe ? 'REFRESH_TOKEN_EXPIRES_IN' : 'REFRESH_TOKEN_SHORT_EXPIRES_IN', rememberMe ? '30d' : '1d'),
    });
    return { accessToken, refreshToken };
};
exports.generateTokens = generateTokens;
const verifyHocmaiCredentials = async (username, password) => {
    const apiToken = process.env.HOCMAI_CHECK_LOGIN_TOKEN;
    if (!apiToken) {
        throw new ApiError_1.default('Hocmai authentication is not configured', 503);
    }
    let response;
    try {
        response = await fetch(process.env.HOCMAI_CHECK_LOGIN_URL
            || 'https://hocmai.vn/ladipage/check_login.php', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user: username, password }),
            signal: AbortSignal.timeout(10_000),
        });
    }
    catch {
        throw new ApiError_1.default('Authentication provider is unavailable', 503);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success || !result?.data?.user_name) {
        throw new ApiError_1.default('Tên đăng nhập hoặc mật khẩu không đúng', 401);
    }
    return {
        username: String(result.data.user_name),
        fullName: result.data.profile?.name
            ? String(result.data.profile.name)
            : undefined,
    };
};
const verifyCredentials = async (username, password) => {
    const provider = (process.env.AUTH_PROVIDER || 'hocmai').trim().toLowerCase();
    if (provider === 'mock') {
        const mockUsername = process.env.MOCK_AUTH_USERNAME || 'admin';
        const mockPassword = process.env.MOCK_AUTH_PASSWORD || '1';
        if (!safeEqual(username, mockUsername)
            || !safeEqual(password, mockPassword)) {
            throw new ApiError_1.default('Tên đăng nhập hoặc mật khẩu không đúng', 401);
        }
        return { username: mockUsername, fullName: undefined };
    }
    if (provider !== 'hocmai') {
        throw new ApiError_1.default('AUTH_PROVIDER is invalid', 503);
    }
    return verifyHocmaiCredentials(username, password);
};
const login = async (username, password, rememberMe = false) => {
    const authenticatedUser = await verifyCredentials(username, password);
    const user = await prisma.users.findFirst({
        where: { username: authenticatedUser.username },
    });
    if (!user) {
        throw new ApiError_1.default('Tài khoản không có quyền truy cập hệ thống quản trị', 403);
    }
    const { roles, permissionCodes } = await loadUserAccess(user.id);
    if (roles.length === 0) {
        throw new ApiError_1.default('Tài khoản không có vai trò đang hoạt động', 403);
    }
    const sessionId = crypto_1.default.randomUUID();
    const tokens = (0, exports.generateTokens)(user.id, sessionId, Boolean(rememberMe));
    await prisma.$executeRaw `
        INSERT INTO auth_sessions (
            id, user_id, refresh_token_hash, expires_at, created_at, updated_at
        ) VALUES (
            ${sessionId},
            ${user.id},
            ${hashToken(tokens.refreshToken)},
            ${getTokenExpiry(tokens.refreshToken)},
            NOW(),
            NOW(3)
        )
    `;
    logger_1.logger.info(`User ${user.id} logged in`);
    return {
        userId: user.id,
        username: user.username,
        full_name: authenticatedUser.fullName || user.name,
        roles: roles.map((role) => ({
            id: role.id.toString(),
            code: role.code,
            name: role.name,
            fieldPolicy: role.fieldPolicy,
        })),
        permissions: permissionCodes,
        ...tokens,
    };
};
exports.login = login;
const getMe = async (userId) => {
    const { user, roles, permissionCodes } = await loadUserAccess(userId);
    return {
        userId: user.id,
        username: user.username,
        full_name: user.name,
        roles: roles.map((role) => ({
            id: role.id.toString(),
            code: role.code,
            name: role.name,
            fieldPolicy: role.fieldPolicy,
        })),
        permissions: permissionCodes,
    };
};
exports.getMe = getMe;
const refreshToken = async (refreshTokenString) => {
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(refreshTokenString, getRequiredSecret('REFRESH_TOKEN_SECRET'));
    }
    catch {
        throw new ApiError_1.default('Invalid or expired refresh token', 401);
    }
    if (decoded.type !== constants_1.TOKEN_TYPES.REFRESH
        || !decoded.sessionId
        || !decoded.userId) {
        throw new ApiError_1.default('Invalid refresh token', 401);
    }
    const sessions = await prisma.$queryRaw `
        SELECT id, user_id, refresh_token_hash, expires_at, revoked_at
        FROM auth_sessions
        WHERE id = ${String(decoded.sessionId)}
        LIMIT 1
    `;
    const session = sessions[0];
    const presentedHash = hashToken(refreshTokenString);
    if (!session
        || Number(session.user_id) !== Number(decoded.userId)
        || session.revoked_at
        || session.expires_at <= new Date()
        || session.refresh_token_hash !== presentedHash) {
        throw new ApiError_1.default('Invalid or revoked refresh token', 401);
    }
    const sessionUserId = Number(session.user_id);
    await loadUserAccess(sessionUserId);
    const tokens = (0, exports.generateTokens)(sessionUserId, session.id, Boolean(decoded.rememberMe));
    const updated = await prisma.$executeRaw `
        UPDATE auth_sessions
        SET
            refresh_token_hash = ${hashToken(tokens.refreshToken)},
            expires_at = ${getTokenExpiry(tokens.refreshToken)},
            updated_at = NOW(3)
        WHERE id = ${session.id}
          AND refresh_token_hash = ${presentedHash}
          AND revoked_at IS NULL
    `;
    if (updated !== 1) {
        throw new ApiError_1.default('Refresh token has already been used', 401);
    }
    return tokens;
};
exports.refreshToken = refreshToken;
const logout = async (sessionId) => {
    await prisma.$executeRaw `
        UPDATE auth_sessions
        SET revoked_at = NOW(), updated_at = NOW(3)
        WHERE id = ${sessionId} AND revoked_at IS NULL
    `;
    return true;
};
exports.logout = logout;
const register = async (_data) => {
    throw new ApiError_1.default('Registration is not available', 501);
};
exports.register = register;
const requestPasswordReset = async (_email) => {
    throw new ApiError_1.default('Password reset is not available', 501);
};
exports.requestPasswordReset = requestPasswordReset;
const verifyOTP = async (_email, _otp) => {
    throw new ApiError_1.default('Password reset is not available', 501);
};
exports.verifyOTP = verifyOTP;
const resetPassword = async (_token, _pass) => {
    throw new ApiError_1.default('Password reset is not available', 501);
};
exports.resetPassword = resetPassword;
