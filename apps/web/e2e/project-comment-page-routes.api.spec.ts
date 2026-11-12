import { expect, test } from '@playwright/test';
import { createProject, setProjectAccess, signIn, uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

test('project page HTTP route enforces sessions, membership, origin, schema and cursor binding', async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        await signIn(page, uniqueEmail('paging-route-owner'));
        const project = await createProject(page, { urls: [site.origin()] });
        await setProjectAccess(page, project, 'Anyone with the link');
        const url = `/api/projects/${project}/comments/pages`, data = { params: { view: 'board' } };
        const unsigned = await request.post(url, { data });
        expect(unsigned.status()).toBe(401);
        expect(unsigned.headers()['cache-control']).toBe('private, no-store');
        expect(unsigned.headers().vary).toContain('Cookie');
        const foreign = await page.request.post(url, { data, headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' } });
        expect(foreign.status()).toBe(403);
        const originOnly = await page.request.post(url, { data, headers: { Origin: 'https://attacker.example' } });
        expect(originOnly.status()).toBe(403);
        for (let group = 0; group < 3; group++) {
            const headers = await verifiedReviewHeaders(request, project, site.origin());
            for (let index = 0; index < 9; index++) {
                const created = await request.post(`/api/review/${project}/comments`, { headers, data: {
                    path: '/paging', text: `HTTP paging ${group}-${index}`, authorName: 'Route reviewer', position: { type: 'page' }, kind: 'feedback'
                } });
                expect(created.status(), await created.text()).toBe(201);
            }
        }
        const first = await page.request.post(url, { data, headers: { Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' } });
        expect(first.status(), await first.text()).toBe(200);
        expect(first.headers()['cache-control']).toBe('private, no-store');
        const snapshot = await first.json();
        expect(snapshot.comments).toHaveLength(25);
        expect(snapshot.paging.statusCounts.open).toBe(27);
        expect(snapshot.paging.statusUnread.open).toBe(27);
        expect(snapshot.paging.lanes.ready).toBeUndefined();
        const cursor = snapshot.paging.lanes.open.nextCursor as string;
        expect(cursor).toBeTruthy();
        for (const extra of [
            { lane: 'open', cursor: `${cursor}x` },
            { lane: 'done', cursor },
            { lane: 'open', cursor, depths: { open: 2 } },
            { depths: { open: 9 } },
            { depths: { foreign: 2 } },
            { unexpected: true }
        ]) {
            const invalid = await page.request.post(url, { data: { ...data, ...extra } });
            expect(invalid.status(), await invalid.text()).toBe(400);
            expect(invalid.headers()['cache-control']).toBe('private, no-store');
        }
        const refreshed = await page.request.post(url, { data: { ...data, depths: { open: 2 } } });
        expect(refreshed.status(), await refreshed.text()).toBe(200);
        expect((await refreshed.json()).comments).toHaveLength(27);
        await signIn(page, uniqueEmail('paging-route-nonmember'), { from: '/app/sign-in?add=1' });
        const denied = await page.request.post(url, { data });
        expect(denied.status(), await denied.text()).toBe(404);
        expect(denied.headers()['cache-control']).toBe('private, no-store');
    } finally { await site.close(); }
});
