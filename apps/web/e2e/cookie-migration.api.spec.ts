import { expect, test } from '@playwright/test';
import { cookieMigrationCutoff, cookieName, cookieNames, readMigratingCookie } from '../src/lib/cookieNames';
import { expiredVisitorCookies, resolveVisitor } from '../src/lib/comments/visitor';

test('HTTPS names take precedence and old names expire after each original lifetime', () => {
    for (const cookie of Object.values(cookieNames)) {
        const legacy = new Map<string, { value: string }>([[cookie.legacy, { value: 'old' }]]);
        const deadline = cookieMigrationCutoff + cookie.lifetime * 1000;
        expect(readMigratingCookie(legacy, cookie, true, deadline - 1)).toBe('old');
        expect(readMigratingCookie(legacy, cookie, true, deadline)).toBeUndefined();
        legacy.set(cookie.name, { value: '' });
        expect(readMigratingCookie(legacy, cookie, true, deadline - 1)).toBe('');
        legacy.set(cookie.name, { value: 'new' });
        expect(readMigratingCookie(legacy, cookie, true, deadline + 1)).toBe('new');
        expect(cookieName(cookie, true)).toBe(cookie.name);
        expect(cookieName(cookie, false)).toBe(cookie.legacy);
        expect(readMigratingCookie(legacy, cookie, false, deadline + 1)).toBe('old');
    }
});

test('visitor identity survives migration, only writes upgrade it, and sign-out expires both names', () => {
    const realNow = Date.now;
    Date.now = () => cookieMigrationCutoff;
    try {
        process.env.UIER_LOCAL = '1';
        const token = 'a'.repeat(43);
        const old = new Request('https://uier.io/api/comments', { headers: { cookie: `uier_visitor=${token}` } });
        const read = resolveVisitor(old, false);
        expect(read.hasCookie).toBe(true);
        expect(read.setCookie).toBeUndefined();
        const write = resolveVisitor(old, true);
        expect(write.authorId).toBe(read.authorId);
        expect(write.setCookie).toContain(`__Host-uier_visitor=${token}; Path=/`);
        expect(write.setCookie).toContain('; Secure');
        const fresh = resolveVisitor(new Request('https://uier.io/api/comments'), true);
        expect(fresh.setCookie).toMatch(/^__Host-uier_visitor=[A-Za-z0-9_-]{43};/);
        expect(fresh.setCookie).toContain('HttpOnly; SameSite=Lax; Secure');
        expect(expiredVisitorCookies(old)).toEqual([
            '__Host-uier_visitor=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
            'uier_visitor=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure'
        ]);
        const both = new Request(old, { headers: { cookie: `__Host-uier_visitor=${'b'.repeat(43)}; uier_visitor=${token}` } });
        expect(resolveVisitor(both, false).authorId).not.toBe(read.authorId);
        const local = new Request('http://127.0.0.1/api/comments');
        expect(resolveVisitor(local, true).setCookie).toMatch(/^uier_visitor=/);
        expect(expiredVisitorCookies(local)).toHaveLength(1);
    } finally { Date.now = realNow; }
});
