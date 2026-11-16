"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issuedRefreshCookieOptions = exports.refreshCookieOptions = exports.REFRESH_COOKIE_NAME = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
exports.REFRESH_COOKIE_NAME = 'refreshToken';
const refreshCookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
});
exports.refreshCookieOptions = refreshCookieOptions;
// Only pass a newly issued server token here, never a token from the request.
const issuedRefreshCookieOptions = (refreshToken) => {
    const options = (0, exports.refreshCookieOptions)();
    const payload = jsonwebtoken_1.default.decode(refreshToken);
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
exports.issuedRefreshCookieOptions = issuedRefreshCookieOptions;
