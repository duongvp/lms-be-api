import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { TOKEN_TYPES } from './constants';
import { logger } from '../../utils/logger';
import ApiError from '../../utils/ApiError';

const prisma = new PrismaClient();

const getRequiredSecret = (name: 'ACCESS_TOKEN_SECRET' | 'REFRESH_TOKEN_SECRET') => {
    const value = process.env[name];
    if (!value) {
        throw new ApiError(`${name} is not configured`, 503);
    }
    // if (!value || value.length < 32) {
    //     throw new ApiError(`${name} must be configured with at least 32 characters`, 503);
    // }
    return value;
};

const getTokenTtl = (name: string, fallback: string) => {
    const value = process.env[name]?.trim() || fallback;
    if (/^\d+$/.test(value)) {
        return Number(value);
    }
    if (!/^\d+(ms|s|m|h|d|w|y)$/i.test(value)) {
        throw new ApiError(`${name} is invalid`, 503);
    }
    return value;
};

const hashToken = (token: string) =>
    crypto.createHash('sha256').update(token).digest('hex');

const safeEqual = (actual: string, expected: string) => {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const getTokenExpiry = (token: string) => {
    const decoded = jwt.decode(token) as any;
    if (!decoded?.exp) throw new ApiError('Token expiration is missing', 500);
    return new Date(decoded.exp * 1000);
};

const loadUserAccess = async (userId: number) => {
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError('User not found', 404);

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
    // Admin là superuser theo nghiệp vụ. Trả wildcard để quyền admin không bị
    // thiếu khi hệ thống bổ sung permission mới nhưng dữ liệu gán quyền cũ
    // chưa kịp đồng bộ.
    const permissionCodes = roles.some((role) => role.code === 'admin')
        ? ['*']
        : Array.from(new Set(
            roles.flatMap((role) =>
                role.rolePermissions.map((item) => item.permission.code)
            )
        ));

    return { user, roles, permissionCodes };
};

export const generateTokens = (
    userId: number,
    sessionId: string,
    rememberMe: boolean
) => {
    const accessToken = jwt.sign(
        { userId, sessionId, type: TOKEN_TYPES.ACCESS },
        getRequiredSecret('ACCESS_TOKEN_SECRET'),
        { expiresIn: getTokenTtl('ACCESS_TOKEN_EXPIRES_IN', '15m') as any }
    );

    const refreshToken = jwt.sign(
        { userId, sessionId, rememberMe, type: TOKEN_TYPES.REFRESH },
        getRequiredSecret('REFRESH_TOKEN_SECRET'),
        {
            expiresIn: getTokenTtl(
                rememberMe ? 'REFRESH_TOKEN_EXPIRES_IN' : 'REFRESH_TOKEN_SHORT_EXPIRES_IN',
                rememberMe ? '30d' : '1d'
            ) as any,
        }
    );

    return { accessToken, refreshToken };
};

const verifyHocmaiCredentials = async (username: string, password: string) => {
    const apiToken = process.env.HOCMAI_CHECK_LOGIN_TOKEN;
    if (!apiToken) {
        throw new ApiError('Hocmai authentication is not configured', 503);
    }

    let response: Response;
    try {
        response = await fetch(
            process.env.HOCMAI_CHECK_LOGIN_URL
                || 'https://hocmai.vn/ladipage/check_login.php',
            {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user: username, password }),
            signal: AbortSignal.timeout(10_000),
            }
        );
    } catch {
        throw new ApiError('Authentication provider is unavailable', 503);
    }

    const result: any = await response.json().catch(() => null);
    if (!response.ok || !result?.success || !result?.data?.user_name) {
        throw new ApiError('Tên đăng nhập hoặc mật khẩu không đúng', 401);
    }

    return {
        username: String(result.data.user_name),
        fullName: result.data.profile?.name
            ? String(result.data.profile.name)
            : undefined,
    };
};

const verifyCredentials = async (username: string, password: string) => {
    const provider = (process.env.AUTH_PROVIDER || 'hocmai').trim().toLowerCase();

    if (provider === 'mock') {
        const mockUsername = process.env.MOCK_AUTH_USERNAME || 'admin';
        const mockPassword = process.env.MOCK_AUTH_PASSWORD || 'Hocmai@123';
        if (
            !safeEqual(username, mockUsername)
            || !safeEqual(password, mockPassword)
        ) {
            throw new ApiError('Tên đăng nhập hoặc mật khẩu không đúng', 401);
        }

        return { username: mockUsername, fullName: undefined };
    }

    if (provider !== 'hocmai') {
        throw new ApiError('AUTH_PROVIDER is invalid', 503);
    }

    return verifyHocmaiCredentials(username, password);
};

export const login = async (
    username: string,
    password: string,
    rememberMe = false
) => {
    const findAuthorizedUser = (authorizedUsername: string) => prisma.users.findFirst({
        where: {
            username: authorizedUsername,
            userRoles: {
                some: { role: { isActive: true } },
            },
        },
        orderBy: { id: 'asc' },
    });

    const provider = (process.env.AUTH_PROVIDER || 'hocmai').trim().toLowerCase();
    let user = await findAuthorizedUser(username);
    let authenticatedUser: { username: string; fullName?: string };

    if (provider === 'hocmai') {
        authenticatedUser = await verifyCredentials(username, password);
        user = await findAuthorizedUser(authenticatedUser.username);
    } else {
        const temporaryPassword = process.env.ADMIN_DEFAULT_PASSWORD || '1';
        if (!user || !safeEqual(password, temporaryPassword)) {
            throw new ApiError('Tên đăng nhập hoặc mật khẩu không đúng', 401);
        }
        authenticatedUser = {
            username: user.username,
            fullName: user.name,
        };
    }

    if (!user) {
        throw new ApiError('Tài khoản không có quyền truy cập hệ thống quản trị', 403);
    }

    const { roles, permissionCodes } = await loadUserAccess(user.id);
    if (roles.length === 0) {
        throw new ApiError('Tài khoản không có vai trò đang hoạt động', 403);
    }

    const sessionId = crypto.randomUUID();
    const tokens = generateTokens(user.id, sessionId, Boolean(rememberMe));
    await prisma.$executeRaw`
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

    logger.info(`User ${user.id} logged in`);
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

export const getMe = async (userId: number) => {
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

export const refreshToken = async (refreshTokenString: string) => {
    let decoded: any;
    try {
        decoded = jwt.verify(
            refreshTokenString,
            getRequiredSecret('REFRESH_TOKEN_SECRET')
        );
    } catch {
        throw new ApiError('Invalid or expired refresh token', 401);
    }

    if (
        decoded.type !== TOKEN_TYPES.REFRESH
        || !decoded.sessionId
        || !decoded.userId
    ) {
        throw new ApiError('Invalid refresh token', 401);
    }

    const sessions = await prisma.$queryRaw<Array<{
        id: string;
        user_id: bigint;
        refresh_token_hash: string;
        expires_at: Date;
        revoked_at: Date | null;
    }>>`
        SELECT id, user_id, refresh_token_hash, expires_at, revoked_at
        FROM auth_sessions
        WHERE id = ${String(decoded.sessionId)}
        LIMIT 1
    `;
    const session = sessions[0];
    const presentedHash = hashToken(refreshTokenString);
    if (
        !session
        || Number(session.user_id) !== Number(decoded.userId)
        || session.revoked_at
        || session.expires_at <= new Date()
        || session.refresh_token_hash !== presentedHash
    ) {
        throw new ApiError('Invalid or revoked refresh token', 401);
    }

    const sessionUserId = Number(session.user_id);
    await loadUserAccess(sessionUserId);
    const tokens = generateTokens(
        sessionUserId,
        session.id,
        Boolean(decoded.rememberMe)
    );
    const updated = await prisma.$executeRaw`
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
        throw new ApiError('Refresh token has already been used', 401);
    }

    return tokens;
};

export const logout = async (sessionId: string) => {
    await prisma.$executeRaw`
        UPDATE auth_sessions
        SET revoked_at = NOW(), updated_at = NOW(3)
        WHERE id = ${sessionId} AND revoked_at IS NULL
    `;
    return true;
};

export const register = async (_data?: any) => {
    throw new ApiError('Registration is not available', 501);
};

export const requestPasswordReset = async (_email?: string) => {
    throw new ApiError('Password reset is not available', 501);
};

export const verifyOTP = async (_email?: string, _otp?: string) => {
    throw new ApiError('Password reset is not available', 501);
};

export const resetPassword = async (_token?: string, _pass?: string) => {
    throw new ApiError('Password reset is not available', 501);
};
