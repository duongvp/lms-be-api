import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import prisma from '../src/lib/prisma';
import controllers from '../src/modules/auth/auth.controller';
import { invalidateUserAccessCache } from '../src/services/authorization.service';
import { issuedRefreshCookieOptions } from '../src/modules/auth/auth.cookies';

const response = () => ({
    statusCode: 200, body: undefined as any, cookies: [] as any[], cleared: [] as any[],
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    cookie(name: string, value: string, options: any) { this.cookies.push({ name, value, options }); },
    clearCookie(name: string, options: any) { this.cleared.push({ name, options }); },
});

test('login and refresh persist only remembered sessions, follow token TTL and clear cookies on logout', async () => {
    const env = { ...process.env };
    const mocks = [
        [prisma.users, 'findFirst'], [prisma.users, 'findUnique'],
        [prisma.userRoles, 'findMany'], [prisma, '$queryRaw'], [prisma, '$executeRaw'],
    ] as const;
    const originals = mocks.map(([target, key]) => (target as any)[key]);
    const user = { id: 81234, username: 'cookie-test', name: 'Cookie Test' };
    const sessions = new Map<string, any>();
    const next = (error?: any) => { if (error) throw error; };
    try {
        Object.assign(process.env, {
            AUTH_PROVIDER: 'mock', ADMIN_DEFAULT_PASSWORD: 'test-password',
            ACCESS_TOKEN_SECRET: 'test-access-secret', REFRESH_TOKEN_SECRET: 'test-refresh-secret',
            REFRESH_TOKEN_EXPIRES_IN: '2h', REFRESH_TOKEN_SHORT_EXPIRES_IN: '10m',
            NODE_ENV: 'production',
        });
        (prisma.users as any).findFirst = async () => user;
        (prisma.users as any).findUnique = async () => user;
        (prisma.userRoles as any).findMany = async () => [{
            role: { id: 1n, code: 'admin', name: 'Admin', rolePermissions: [] },
        }];
        (prisma as any).$queryRaw = async (sql: any, id: string) => (
            (Array.isArray(sql) ? sql.join('') : sql.sql).includes('FROM auth_sessions')
                ? [sessions.get(id)].filter(Boolean) : []
        );
        (prisma as any).$executeRaw = async (sql: any, ...values: any[]) => {
            if (sql.join('').includes('INSERT INTO auth_sessions')) {
                const [id, user_id, refresh_token_hash, expires_at] = values;
                sessions.set(id, { id, user_id, refresh_token_hash, expires_at, revoked_at: null });
            } else if (sql.join('').includes('refresh_token_hash =')) {
                const [hash, expiry, id] = values;
                Object.assign(sessions.get(id), { refresh_token_hash: hash, expires_at: expiry });
            }
            return 1;
        };

        for (const rememberMe of [true, false]) {
            const login = response();
            await controllers.login({ body: { username: user.username, password: 'test-password', rememberMe } } as any, login as any, next);
            assert.equal(login.statusCode, 200);
            assert.equal(login.body.data.refreshToken, undefined);
            const original = login.cookies[0];
            const payload = jwt.verify(original.value, process.env.REFRESH_TOKEN_SECRET!) as any;
            assert.equal(payload.rememberMe, rememberMe);
            assert.equal(payload.exp - payload.iat, rememberMe ? 7200 : 600);

            const refresh = response();
            // Request-body changes cannot turn a non-remembered session persistent.
            await controllers.refreshToken({
                headers: { cookie: `refreshToken=${encodeURIComponent(original.value)}` },
                body: { rememberMe: !rememberMe },
            } as any, refresh as any, next);
            assert.equal(refresh.statusCode, 200);
            assert.ok(refresh.body.data.accessToken);
            assert.equal(refresh.body.data.refreshToken, undefined);

            for (const cookie of [original, refresh.cookies[0]]) {
                assert.equal(cookie.name, 'refreshToken');
                assert.equal(cookie.options.httpOnly, true);
                assert.equal(cookie.options.secure, true);
                assert.equal(cookie.options.sameSite, 'lax');
                assert.equal(cookie.options.path, '/');
                if (rememberMe) {
                    const decoded = jwt.decode(cookie.value) as any;
                    assert.ok(cookie.options.maxAge > 0);
                    assert.ok(Math.abs(Date.now() + cookie.options.maxAge - decoded.exp * 1000) < 1000);
                } else {
                    assert.equal(cookie.options.maxAge, undefined);
                    assert.equal(cookie.options.expires, undefined);
                }
            }
            const logout = response();
            await controllers.logout({ user: { sessionId: payload.sessionId } } as any, logout as any, next);
            assert.equal(logout.cleared[0].name, 'refreshToken');
            assert.equal(logout.cleared[0].options.path, '/');
            assert.equal(logout.cleared[0].options.maxAge, undefined);
        }
        process.env.NODE_ENV = 'development';
        const token = jwt.sign({ rememberMe: true }, process.env.REFRESH_TOKEN_SECRET!, { expiresIn: '5m' });
        assert.equal(issuedRefreshCookieOptions(token).secure, false);
    } finally {
        mocks.forEach(([target, key], index) => { (target as any)[key] = originals[index]; });
        invalidateUserAccessCache(user.id);
        process.env = env;
    }
});
