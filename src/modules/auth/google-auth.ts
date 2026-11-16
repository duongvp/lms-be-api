import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { createLoginSession } from './auth.service';
import { REFRESH_COOKIE_NAME, issuedRefreshCookieOptions } from './auth.cookies';

const COOKIE = 'googleLogin';
const cookieOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
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
        || (redirect.protocol !== 'https:' && !(
            redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)
        ))) throw new Error('Invalid Google redirect URI');
    return { clientId, secret, client: new google.auth.OAuth2(clientId, clientSecret, redirectUri) };
};

const random = () => crypto.randomBytes(32).toString('base64url');

export const startGoogleLogin = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const { client, secret } = configuration();
        const state = random();
        const nonce = random();
        const verifier = random();
        const context = jwt.sign({
            type: 'google-login', state, nonce, verifier,
            rememberMe: req.query.rememberMe === 'true',
        }, secret, { algorithm: 'HS256', expiresIn: '10m' });
        res.cookie(COOKIE, context, { ...cookieOptions(), maxAge: 600_000 });
        res.redirect(client.generateAuthUrl({
            scope: ['openid', 'email', 'profile'],
            state, nonce,
            prompt: 'select_account',
            code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256' as any,
        }));
    } catch {
        res.redirect('/auth/login?googleError=unavailable');
    }
};

export const googleLoginCallback = async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.clearCookie(COOKIE, cookieOptions());
    try {
        const { client, clientId, secret } = configuration();
        const rawCookie = req.headers.cookie?.split(';')
            .map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
        if (!rawCookie) throw new Error('Missing login context');
        const context = jwt.verify(decodeURIComponent(rawCookie.slice(COOKIE.length + 1)), secret, {
            algorithms: ['HS256'],
        }) as { type?: string; state?: string; nonce?: string; verifier?: string; rememberMe?: boolean };
        if (context.type !== 'google-login' || typeof context.state !== 'string'
            || typeof context.nonce !== 'string' || typeof context.verifier !== 'string'
            || typeof req.query.state !== 'string' || req.query.state !== context.state
            || req.query.error || typeof req.query.code !== 'string' || !req.query.code) {
            throw new Error('Invalid Google callback');
        }
        const { tokens } = await client.getToken({
            code: req.query.code, codeVerifier: context.verifier,
        });
        if (!tokens.id_token) throw new Error('Missing Google ID token');
        // The Google library checks signature, issuer, audience and expiry.
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
        const profile = ticket.getPayload();
        if (!profile?.sub || !profile.email || profile.email_verified !== true
            || (profile as any).nonce !== context.nonce) {
            throw new Error('Invalid Google identity');
        }
        // Google is authoritative for Gmail and verified Workspace identities.
        // Other email providers need a separate ownership verification before linking.
        if (!profile.email.toLowerCase().endsWith('@gmail.com') && !profile.hd) {
            res.redirect('/auth/login?googleError=email');
            return;
        }
        const users = await prisma.users.findMany({
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
        const session = await createLoginSession(users[0], context.rememberMe === true);
        res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, issuedRefreshCookieOptions(session.refreshToken));
        res.redirect('/auth/google/complete');
    } catch {
        res.redirect('/auth/login?googleError=failed');
    }
};
