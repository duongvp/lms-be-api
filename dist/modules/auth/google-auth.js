"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleLoginCallback = exports.startGoogleLogin = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const googleapis_1 = require("googleapis");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const auth_service_1 = require("./auth.service");
const auth_cookies_1 = require("./auth.cookies");
const COOKIE = 'googleLogin';
const cookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/callback',
});
const configuration = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!clientId || !clientSecret || !redirectUri || !secret) {
        throw new Error('Google login is not configured');
    }
    const redirect = new URL(redirectUri);
    if (redirect.pathname !== '/callback'
        || redirect.search || redirect.hash
        || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname))))
        throw new Error('Invalid Google redirect URI');
    return { clientId, secret, client: new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri) };
};
const random = () => crypto_1.default.randomBytes(32).toString('base64url');
const startGoogleLogin = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const { client, secret } = configuration();
        const state = random();
        const nonce = random();
        const verifier = random();
        const context = jsonwebtoken_1.default.sign({
            type: 'google-login', state, nonce, verifier,
            rememberMe: req.query.rememberMe === 'true',
        }, secret, { algorithm: 'HS256', expiresIn: '10m' });
        res.cookie(COOKIE, context, { ...cookieOptions(), maxAge: 600_000 });
        res.redirect(client.generateAuthUrl({
            scope: ['openid', 'email', 'profile'],
            state, nonce,
            prompt: 'select_account',
            code_challenge: crypto_1.default.createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
        }));
    }
    catch {
        res.redirect('/auth/login?googleError=unavailable');
    }
};
exports.startGoogleLogin = startGoogleLogin;
const googleLoginCallback = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.clearCookie(COOKIE, cookieOptions());
    try {
        const { client, clientId, secret } = configuration();
        const rawCookie = req.headers.cookie?.split(';')
            .map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
        if (!rawCookie)
            throw new Error('Missing login context');
        const context = jsonwebtoken_1.default.verify(decodeURIComponent(rawCookie.slice(COOKIE.length + 1)), secret, {
            algorithms: ['HS256'],
        });
        if (context.type !== 'google-login' || typeof context.state !== 'string'
            || typeof context.nonce !== 'string' || typeof context.verifier !== 'string'
            || typeof req.query.state !== 'string' || req.query.state !== context.state
            || req.query.error || typeof req.query.code !== 'string' || !req.query.code) {
            throw new Error('Invalid Google callback');
        }
        const { tokens } = await client.getToken({
            code: req.query.code, codeVerifier: context.verifier,
        });
        if (!tokens.id_token)
            throw new Error('Missing Google ID token');
        // The Google library checks signature, issuer, audience and expiry.
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const profile = ticket.getPayload();
        if (!profile?.sub || !profile.email || profile.email_verified !== true
            || profile.nonce !== context.nonce) {
            throw new Error('Invalid Google identity');
        }
        // Google is authoritative for Gmail and verified Workspace identities.
        // Other email providers need a separate ownership verification before linking.
        if (!profile.email.toLowerCase().endsWith('@gmail.com') && !profile.hd) {
            res.redirect('/auth/login?googleError=email');
            return;
        }
        const users = await prisma_1.default.users.findMany({
            where: {
                email: profile.email.trim().toLowerCase(),
                userRoles: { some: { role: { isActive: true } } },
            },
            take: 2,
        });
        if (users.length !== 1) {
            res.redirect('/auth/login?googleError=access');
            return;
        }
        const session = await (0, auth_service_1.createLoginSession)(users[0], context.rememberMe === true);
        res.cookie(auth_cookies_1.REFRESH_COOKIE_NAME, session.refreshToken, (0, auth_cookies_1.issuedRefreshCookieOptions)(session.refreshToken));
        res.redirect('/auth/google/complete');
    }
    catch {
        res.redirect('/auth/login?googleError=failed');
    }
};
exports.googleLoginCallback = googleLoginCallback;
