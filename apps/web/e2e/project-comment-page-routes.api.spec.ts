import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { loadAppCommentsSnapshot } from '../src/lib/app/appCommentsSnapshot';
import { cookieNames } from '../src/lib/cookieNames';
import { uniqueEmail } from './support/app';
import { verifiedReviewHeaders } from './support/reviewVerification';
import { startReviewedSite } from './support/reviewedSite';

// As in account-consent.api.spec.ts, provision the running server's store through HTTP actions.
const manifest = JSON.parse(readFileSync(new URL('../.next/server/server-reference-manifest.json', import.meta.url), 'utf8')) as {
    node: Record<string, { exportedName?: string }>;
};
async function formAction(request: APIRequestContext, origin: string, path: string, name: string, fields: Record<string, string>) {
    const id = Object.entries(manifest.node).find(([, entry]) => entry.exportedName === name)?.[0];
    expect(id, name).toBeTruthy();
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(`_1_${key}`, value);
    form.append('0', '[null,"$K1"]');
    return request.post(path, { headers: { 'Next-Action': id!, Origin: origin }, multipart: form, maxRedirects: 0 });
}
async function signInHttp(request: APIRequestContext, origin: string, label: string) {
    const email = uniqueEmail(label);
    const sent = await formAction(request, origin, '/app/sign-in?add=1', 'requestSignInAction', { email });
    let credentials: { requestId: string; devCode: string } | undefined;
    for (const line of (await sent.text()).split('\n')) {
        try {
            const value = JSON.parse(line.slice(line.indexOf(':') + 1)) as { ok?: boolean; data?: { requestId: string; devCode: string } } | null;
            if (value?.ok && value.data?.devCode) credentials = value.data;
        } catch { /* Other Flight records are not action results. */ }
    }
    expect(credentials).toBeTruthy();
    const confirmed = await formAction(request, origin, '/app/sign-in?add=1', 'confirmSignInCodeAction', {
        requestId: credentials!.requestId, code: credentials!.devCode
    });
    expect(confirmed.headers()['x-action-redirect']).toBeTruthy();
    const { userId } = await (await request.get('/api/account/sessions')).json() as { userId: string };
    expect(userId).toMatch(/^u_/);
    // Use the server-minted credential: other API specs can cache a different worker signing key.
    const session = (await request.storageState()).cookies.find(cookie => cookie.name === cookieNames.session.legacy);
    expect(session?.value).toBeTruthy();
    return { cookie: `${session!.name}=${session!.value}` };
}

test('project page HTTP route enforces sessions, membership, origin, schema and cursor binding', async ({ request, baseURL }) => {
    const site = await startReviewedSite(new URL(baseURL!).origin);
    try {
        const owner = await signInHttp(request, baseURL!, 'paging-route-owner');
        const created = await formAction(request, baseURL!, '/app/projects/new', 'createProjectAction', { name: 'HTTP paging', url: site.origin() });
        const redirect = created.headers()['x-action-redirect'];
        expect(redirect).toBeTruthy();
        const project = redirect!.match(/\/app\/projects\/([^/;?]+)/)?.[1];
        expect(project).toBeTruthy();
        const settings = await formAction(request, baseURL!, `/app/projects/${project}/settings/review`, 'updateProjectReviewAction', { projectId: project!, access: 'guests' });
        expect(await settings.text()).toContain('"ok":true');
        const url = `/api/projects/${project}/comments/pages`, data = { params: { view: 'board' } };
        const post = (input: { data: unknown; headers?: Record<string, string> }, cookie = owner.cookie) =>
            request.post(url, { ...input, headers: { Cookie: cookie, ...input.headers } });
        const unsigned = await post({ data }, '');
        expect(unsigned.status()).toBe(401);
        expect(unsigned.headers()['cache-control']).toBe('private, no-store');
        expect(unsigned.headers().vary).toContain('Cookie');
        const foreign = await post({ data, headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' } });
        expect(foreign.status()).toBe(403);
        const originOnly = await post({ data, headers: { Origin: 'https://attacker.example' } });
        expect(originOnly.status()).toBe(403);
        for (let group = 0; group < 3; group++) {
            const headers = await verifiedReviewHeaders(request, project!, site.origin());
            for (let index = 0; index < 9; index++) {
                const created = await request.post(`/api/review/${project}/comments`, { headers, data: {
                    path: '/paging', text: `HTTP paging ${group}-${index}`, authorName: 'Route reviewer', position: { type: 'page' }, kind: 'feedback'
                } });
                expect(created.status(), await created.text()).toBe(201);
            }
        }
        const first = await post({ data, headers: { Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' } });
        expect(first.status(), await first.text()).toBe(200);
        expect(first.headers()['cache-control']).toBe('private, no-store');
        const snapshot = await first.json() as NonNullable<Awaited<ReturnType<typeof loadAppCommentsSnapshot>>>;
        expect(snapshot.comments).toHaveLength(25);
        expect(snapshot.paging.statusCounts.open).toBe(27);
        expect(snapshot.paging.statusUnread.open).toBe(27);
        expect(snapshot.paging.lanes.ready).toBeUndefined();
        const cursor = snapshot.paging.lanes.open!.nextCursor!;
        expect(cursor).toBeTruthy();
        for (const extra of [
            { lane: 'open', cursor: `${cursor}x` },
            { lane: 'done', cursor },
            { lane: 'open', cursor, depths: { open: 2 } },
            { depths: { open: 9 } },
            { depths: { foreign: 2 } },
            { unexpected: true }
        ]) {
            const invalid = await post({ data: { ...data, ...extra } });
            expect(invalid.status(), await invalid.text()).toBe(400);
            expect(invalid.headers()['cache-control']).toBe('private, no-store');
        }
        const refreshed = await post({ data: { ...data, depths: { open: 2 } } });
        expect(refreshed.status(), await refreshed.text()).toBe(200);
        expect(((await refreshed.json()) as { comments: unknown[] }).comments).toHaveLength(27);
        const nonmember = await signInHttp(request, baseURL!, 'paging-route-nonmember');
        const denied = await post({ data }, nonmember.cookie);
        expect(denied.status()).toBe(404);
        expect(denied.headers()['cache-control']).toBe('private, no-store');
    } finally { await site.close(); }
});
