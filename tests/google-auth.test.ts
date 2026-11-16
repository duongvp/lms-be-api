import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import prisma from '../src/lib/prisma';
import { startGoogleLogin, googleLoginCallback } from '../src/modules/auth/google-auth';

const response = () => ({
    location: '', cookies: [] as any[], cleared: [] as string[],
    setHeader() {},
    cookie(name: string, value: string, options: any) { this.cookies.push({ name, value, options }); },
    clearCookie(name: string) { this.cleared.push(name); },
    redirect(location: string) { this.location = location; },
});

test('Google login validates OAuth context and identity before issuing an existing LMS session', async () => {
    const env = { ...process.env };
    const mocks = [
        [google.auth.OAuth2.prototype, 'getToken'],
        [google.auth.OAuth2.prototype, 'verifyIdToken'],
        [prisma.users, 'findMany'], [prisma.users, 'findUnique'],
        [prisma.userRoles, 'findMany'], [prisma, '$queryRaw'], [prisma, '$executeRaw'],
    ] as const;
    const originals = mocks.map(([target, key]) => (target as any)[key]);
    let exchanges = 0, sessions = 0;
    let profile: any;
    let matches: any[] = [];
    let roles: any[] = [];
    const user = { id: 90210, username: 'staff', name: 'Staff', email: 'staff@gmail.com' };
    try {
        process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
        process.env.GOOGLE_REDIRECT_URI = 'https://liveops.hocmai.io.vn/callback';
        process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
        process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
        (google.auth.OAuth2.prototype as any).getToken = async (options: any) => {
            exchanges++;
            assert.ok(options.codeVerifier);
            return { tokens: { id_token: 'signed-google-token' } };
        };
        (google.auth.OAuth2.prototype as any).verifyIdToken = async (options: any) => {
            assert.equal(options.audience, process.env.GOOGLE_CLIENT_ID);
            assert.equal(options.idToken, 'signed-google-token');
            return { getPayload: () => profile };
        };
        (prisma.users as any).findMany = async (query: any) => {
            assert.equal(query.where.email, user.email);
            assert.deepEqual(query.where.userRoles, { some: { role: { isActive: true } } });
            return matches;
        };
        (prisma.users as any).findUnique = async () => user;
        (prisma.userRoles as any).findMany = async () => roles;
        (prisma as any).$queryRaw = async () => [];
        (prisma as any).$executeRaw = async (_sql: any, ...values: any[]) => {
            sessions++;
            assert.ok(values.some(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)));
            return 1;
        };

        const start = response();
        startGoogleLogin({ query: { rememberMe: 'true' } } as any, start as any);
        const url = new URL(start.location);
        const cookie = start.cookies[0];
        assert.equal(url.origin, 'https://accounts.google.com');
        assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_REDIRECT_URI);
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(cookie.options.httpOnly, true);
        assert.equal(cookie.options.sameSite, 'lax');
        assert.equal(cookie.options.path, '/callback');
        const context = jwt.verify(cookie.value, process.env.ACCESS_TOKEN_SECRET) as any;
        profile = { sub: 'google-subject', email: user.email, email_verified: true, nonce: context.nonce };

        const callback = async (query: any = {}, value = cookie.value, includeCookie = true) => {
            const res = response();
            await googleLoginCallback({
                headers: { cookie: includeCookie ? `googleLogin=${encodeURIComponent(value)}` : '' },
                query: { state: context.state, code: 'one-use-code', ...query },
            } as any, res as any);
            assert.deepEqual(res.cleared, ['googleLogin']);
            return res;
        };
        assert.match((await callback({}, '', false)).location, /googleError=failed/);
        assert.match((await callback({ state: 'attacker' })).location, /googleError=failed/);
        assert.match((await callback({ error: 'access_denied' })).location, /googleError=failed/);
        const expired = jwt.sign({ ...context, exp: 1 }, process.env.ACCESS_TOKEN_SECRET);
        assert.match((await callback({}, expired)).location, /googleError=failed/);
        assert.equal(exchanges, 0);

        profile.email_verified = false;
        assert.match((await callback()).location, /googleError=failed/);
        profile.email_verified = true;
        profile.nonce = 'wrong-nonce';
        assert.match((await callback()).location, /googleError=failed/);
        profile.nonce = context.nonce;
        profile.email = 'staff@example.com';
        assert.match((await callback()).location, /googleError=email/);
        profile.email = user.email;
        assert.match((await callback()).location, /googleError=access/);
        matches = [user, { ...user, id: 90211 }];
        assert.match((await callback()).location, /googleError=access/);
        assert.equal(sessions, 0);

        matches = [user];
        roles = [{ role: { id: 1n, code: 'admin', name: 'Admin', isActive: true, rolePermissions: [] } }];
        const success = await callback();
        assert.equal(success.location, '/auth/google/complete');
        assert.equal(sessions, 1);
        const refresh = success.cookies.find(cookie => cookie.name === 'refreshToken');
        assert.equal(refresh.options.httpOnly, true);
        const decoded = jwt.verify(refresh.value, process.env.REFRESH_TOKEN_SECRET) as any;
        assert.equal(decoded.userId, user.id);
        assert.equal(decoded.rememberMe, true);
        assert.ok(decoded.sessionId);
        assert.ok(refresh.options.maxAge > 0);
        assert.ok(Math.abs(Date.now() + refresh.options.maxAge - decoded.exp * 1000) < 1000);

        // The unchecked Google login must keep a browser-session cookie.
        const sessionContext = jwt.sign({ ...context, rememberMe: false }, process.env.ACCESS_TOKEN_SECRET);
        const sessionLogin = await callback({}, sessionContext);
        assert.equal(sessionLogin.location, '/auth/google/complete');
        const sessionRefresh = sessionLogin.cookies.find(cookie => cookie.name === 'refreshToken');
        assert.equal(sessionRefresh.options.maxAge, undefined);
        assert.equal(sessionRefresh.options.expires, undefined);

        delete process.env.GOOGLE_CLIENT_SECRET;
        const unavailable = response();
        startGoogleLogin({ query: {} } as any, unavailable as any);
        assert.equal(unavailable.location, '/auth/login?googleError=unavailable');
    } finally {
        mocks.forEach(([target, key], index) => { (target as any)[key] = originals[index]; });
        process.env = env;
    }
});
