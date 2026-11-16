import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';

export const REFRESH_COOKIE_NAME = 'refreshToken';

export const refreshCookieOptions = (): CookieOptions => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
});

// Only pass a newly issued server token here, never a token from the request.
export const issuedRefreshCookieOptions = (refreshToken: string): CookieOptions => {
    const options = refreshCookieOptions();
    const payload = jwt.decode(refreshToken) as { rememberMe?: boolean; exp?: number } | null;
    if (payload?.rememberMe === true) {
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            throw new Error('Refresh token expiration is missing');
        }
        // Express takes milliseconds. Derive the lifetime from the actual token
        // so custom TTLs and refresh rotation always use the same expiry.
        options.maxAge = Math.max(0, payload.exp * 1000 - Date.now());
    }
    return options;
};
