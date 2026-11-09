import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { parsePullRequestLink, threadPullRequestLinks } from '../src/lib/comments/pullRequestLinks';
import { cachedPullRequestState, PullRequestReadError } from '../src/lib/integrations/pullRequestCache';
import { loadThreadPullRequests, pullRequestState } from '../src/lib/integrations/pullRequests';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import type { DbComment } from '../src/lib/db/schema';
import { githubInstallationPk, type GitHubConnection, type GitHubInstallation } from '../src/lib/integrations/github/model';
import { GET as readPullRequests } from '../app/api/projects/[projectId]/comments/[id]/pull-requests/route';
import { sessionToken } from '../src/lib/app/sessionIdentity';
import { cookieName, cookieNames } from '../src/lib/cookieNames';

const originalFetch = globalThis.fetch;
const variables = ['UIER_LOCAL', 'UIER_GITHUB_APP_ID', 'UIER_GITHUB_APP_SLUG', 'UIER_GITHUB_CLIENT_ID', 'UIER_GITHUB_CLIENT_SECRET',
    'UIER_GITHUB_PRIVATE_KEY', 'UIER_GITHUB_SETUP_KEY', 'UIER_GITHUB_WEBHOOK_SECRET'];
const previous = new Map(variables.map(key => [key, process.env[key]]));
test.beforeAll(() => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, { UIER_LOCAL: '1', UIER_GITHUB_APP_ID: '987', UIER_GITHUB_APP_SLUG: 'test',
        UIER_GITHUB_CLIENT_ID: 'test', UIER_GITHUB_CLIENT_SECRET: 'test', UIER_GITHUB_SETUP_KEY: Buffer.alloc(32, 48).toString('base64'),
        UIER_GITHUB_WEBHOOK_SECRET: 'test', UIER_GITHUB_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.afterAll(() => { for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('recognizes and deduplicates provider links in current Markdown, bare URLs and replies', () => {
    const links = threadPullRequestLinks([
        { text: 'Fixed in [PR #472](https://github.com/owner/repo/pull/472/files?diff=1#top).' },
        { text: '<https://github.com/owner/repo/pull/472> and https://gitlab.com/team/sub/repo/-/merge_requests/8.' },
        { text: 'https://org.visualstudio.com/My%20Project/_git/Website/pullrequest/17?view=files' },
        { text: 'https://github.com/owner/repo/pull/3', deleted: true },
        { text: 'https://github.com/owner/repo/pull/4', deletedAt: '2026-11-01' }
    ]);
    expect(links.map(link => link.url)).toEqual(['https://github.com/owner/repo/pull/472', 'https://gitlab.com/team/sub/repo/-/merge_requests/8',
        'https://dev.azure.com/org/My%20Project/_git/Website/pullrequest/17']);
    for (const url of ['https://github.com.evil.test/a/b/pull/1', 'https://gitlab.internal/a/b/-/merge_requests/1',
        'http://github.com/a/b/pull/1', 'https://user:pass@github.com/a/b/pull/1', 'https://github.com:444/a/b/pull/1',
        'https://github.com/a/b/issues/1', 'https://dev.azure.com/org/p/_git/%2f..%2f/pullrequest/1',
        'https://gitlab.com/a/%2e%2e/-/merge_requests/1', 'https://gitlab.com/a/b%2fc/-/merge_requests/1',
        'https://github.com/a/b/pull/0', 'https://github.com/a/b/pull/1evil', 'https://127.0.0.1/a/b/pull/1']) {
        expect(parsePullRequestLink(url), url).toBeUndefined();
    }
});

test('maps states without mistaking drafts or closed unmerged PRs for merges', () => {
    for (const provider of ['github', 'gitlab', 'azure-devops'] as const) {
        const bodies = provider === 'github'
            ? [{ number: 1, state: 'open', merged: false }, { number: 1, state: 'open', merged: false, draft: true }, { number: 1, state: 'closed', merged: false }, { number: 1, state: 'closed', merged: true }]
            : provider === 'gitlab' ? [{ iid: 1, state: 'opened' }, { iid: 1, state: 'opened', draft: true }, { iid: 1, state: 'closed' }, { iid: 1, state: 'merged' }]
                : [{ pullRequestId: 1, status: 'active' }, { pullRequestId: 1, status: 'active', isDraft: true }, { pullRequestId: 1, status: 'abandoned' }, { pullRequestId: 1, status: 'completed' }];
        expect(bodies.map(body => pullRequestState(provider, body, 1))).toEqual(['open', 'draft', 'closed', 'merged']);
        expect(pullRequestState(provider, bodies[0], 2)).toBeUndefined();
        expect(pullRequestState(provider, { title: '<script>secret</script>' }, 1)).toBeUndefined();
    }
});

test('durable caching deduplicates concurrent views, expires and isolates authorities', async () => {
    let calls = 0;
    const input = { scope: randomUUID(), url: 'https://github.com/acme/site/pull/1', bucket: randomUUID(), hourlyLimit: 10,
        read: async () => { calls++; return 'open' as const; } };
    const now = Date.now();
    const results = await Promise.all([cachedPullRequestState(input, undefined, now), cachedPullRequestState(input, undefined, now)]);
    expect(results).toEqual(['open', 'open']);
    expect(calls).toBe(1);
    expect(await cachedPullRequestState(input, undefined, now + 60_000)).toBe('open');
    expect(calls).toBe(1);
    await cachedPullRequestState(input, undefined, now + 301_000); expect(calls).toBe(2);
    await cachedPullRequestState({ ...input, scope: randomUUID() }, undefined, now); expect(calls).toBe(3);
});

test('request budgets and provider backoff apply across links, including failed reads', async () => {
    let calls = 0;
    const input = { scope: randomUUID(), url: 'one', bucket: randomUUID(), hourlyLimit: 1, read: async () => { calls++; return 'draft' as const; } };
    const now = Date.now();
    await cachedPullRequestState(input, undefined, now);
    expect(await cachedPullRequestState({ ...input, url: 'two' }, undefined, now)).toBeUndefined();
    expect(calls).toBe(1);
    const limited = { ...input, scope: randomUUID(), bucket: randomUUID(), hourlyLimit: 10,
        read: async () => { calls++; throw new PullRequestReadError(now + 3600_000); } };
    await cachedPullRequestState(limited, undefined, now);
    await cachedPullRequestState({ ...limited, url: 'different' }, undefined, now + 600_000);
    expect(calls).toBe(2);
});

async function fixture(text: string) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = await findOrCreateUser(`pr-${id}@example.com`);
    const project: DbProject = { type: 'project', id, pk: workspacePk(`w_${owner.id}`), workspaceId: `w_${owner.id}`, name: 'PR links',
        urls: ['https://example.test'], status: 'active', access: 'invited', createdBy: owner.id, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    await getAppStore().create(project);
    await getAppStore().create<DbProjectRef>({ type: 'project-ref', pk: projectRefPk(id), id, workspaceId: project.workspaceId });
    await getAppStore().create<DbMember>({ type: 'member', pk: project.pk, id: memberId(owner.id), userId: owner.id,
        email: owner.email, workspaceId: project.workspaceId, role: 'admin', projects: 'all', createdAt: '2026-01-01' });
    const comment: DbComment = { id: `comment_${id}`, domain: `project:${id}`, projectId: id, path: '/', kind: 'feedback', position: { type: 'page' },
        authorId: `user:${owner.id}`, createdAt: '2026-01-01', thread: { items: [{ id: `item_${id}`, text, createdAt: '2026-01-01', authorId: `user:${owner.id}` }] } };
    await getCommentsStore().create(comment);
    const load = (userId = owner.id) => loadThreadPullRequests(project.workspaceId, project.id, userId, comment.id);
    return { owner, project, comment, load };
}

test('HTTP reads require an app session and thread access, reject cross-site requests, and never cache the response', async () => {
    const f = await fixture(`https://github.com/acme/${randomUUID()}/pull/5`);
    const params = Promise.resolve({ projectId: f.project.id, id: f.comment.id });
    const url = `https://uier.io/api/projects/${f.project.id}/comments/${f.comment.id}/pull-requests?url=https://evil.test/`;
    expect((await readPullRequests(new Request(url), { params })).status).toBe(401);
    expect((await readPullRequests(new Request(url, { headers: { Authorization: 'Bearer review-token' } }), { params })).status).toBe(401);
    const cookie = `${cookieName(cookieNames.session)}=${sessionToken(f.owner.id).token}`;
    expect((await readPullRequests(new Request(url, { headers: { cookie, 'sec-fetch-site': 'cross-site' } }), { params })).status).toBe(403);
    let calls = 0;
    globalThis.fetch = async input => { calls++; expect(String(input)).toMatch(/^https:\/\/api.github.com\/repos\//); return json({ number: 5, state: 'closed', merged: true }); };
    const response = await readPullRequests(new Request(url, { headers: { cookie } }), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual([{ url: f.comment.thread.items[0]!.text, state: 'merged' }]);
    expect(calls).toBe(1);
    const bad = await readPullRequests(new Request(url, { headers: { cookie } }), { params: Promise.resolve({ projectId: 'invalid', id: f.comment.id }) });
    expect(bad.status).toBe(400);
});

test('public APIs receive no credentials and provider URLs are constructed rather than followed', async () => {
    const f = await fixture(`https://github.com/acme/${randomUUID()}/pull/1?token=secret https://gitlab.com/a/${randomUUID()}/-/merge_requests/2 https://dev.azure.com/org/p/_git/r/pullrequest/3 https://gitlab.internal/a/b/-/merge_requests/1`);
    const calls: string[] = [];
    globalThis.fetch = async (url, options) => {
        calls.push(String(url));
        expect(options?.headers).not.toHaveProperty('Authorization');
        expect(options?.redirect).toBe('error');
        expect(options?.cache).toBe('no-store');
        expect(String(url)).not.toContain('secret');
        if (String(url).startsWith('https://api.github.com/repos/')) return json({ number: 1, state: 'closed', merged: true, title: 'private title never projected' });
        expect(String(url)).toMatch(/^https:\/\/gitlab.com\/api\/v4\/projects\/a%2F/);
        return json({ iid: 2, state: 'opened', draft: true });
    };
    expect((await f.load()).map(value => value.state)).toEqual(['merged', 'draft', undefined]);
    expect(calls).toHaveLength(2);
    await f.load(); expect(calls).toHaveLength(2);
    const stranger = await findOrCreateUser(`${randomUUID()}@example.com`);
    await expect(f.load(stranger.id)).rejects.toMatchObject({ status: 404 });
    expect(calls).toHaveLength(2);
});

test('private GitHub states require the exact project binding, current admin and installation authority, even from cache', async () => {
    const repo = `r-${randomUUID()}`;
    const f = await fixture(`https://github.com/acme/${repo}/pull/7`);
    const connection: GitHubConnection = { type: 'github-connection', provider: 'github', id: `connection_${f.project.id}`, pk: f.project.pk,
        workspaceId: f.project.workspaceId, projectId: f.project.id, connectedBy: f.owner.id, status: 'connected', enabled: true,
        destinationRevision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01', config: { installationId: '1234', repositoryId: '4567',
            repositoryNodeId: 'R_4567', owner: 'acme', name: repo, private: true, botId: '9', markerSeed: 'test', authorizedGitHubUserId: '8', authorizedAt: '2026-01-01' } };
    await getAppStore().create(connection);
    await updateDoc<DbProject>(f.project.pk, f.project.id, value => ({ ...value, integrations: { github: { connectionId: connection.id, since: '2026-01-01' } } }));
    await getAppStore().create<GitHubInstallation>({ type: 'github-installation', pk: githubInstallationPk('987', '1234'), id: 'installation', appId: '987',
        installationId: '1234', status: 'connected', deniedRepositories: [], updatedAt: '2026-01-01' });
    const calls: { url: string; auth?: string }[] = [];
    globalThis.fetch = async (url, options) => {
        const auth = new Headers(options?.headers).get('authorization') ?? undefined;
        calls.push({ url: String(url), auth });
        if (String(url).endsWith('/access_tokens')) {
            expect(JSON.parse(options!.body as string)).toEqual({ repository_ids: [4567], permissions: { pull_requests: 'read', metadata: 'read' } });
            return json({ token: 'server-only', permissions: { pull_requests: 'read' }, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
        }
        return auth ? json({ number: 7, state: 'open', merged: false }) : json({}, 404);
    };
    expect(await f.load()).toEqual([{ url: `https://github.com/acme/${repo}/pull/7`, state: 'open' }]);
    expect(calls[1]?.auth).toBe('Bearer server-only');
    await f.load(); expect(calls).toHaveLength(2);
    let stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, thread: { items: [{ ...stored.comment.thread.items[0]!, text:
        `${stored.comment.thread.items[0]!.text} https://github.com/elsewhere/${repo}/pull/8` }] } }, stored.etag);
    expect((await f.load()).map(value => value.state)).toEqual(['open', undefined]);
    expect(calls.at(-1)?.auth).toBeUndefined();
    expect(calls).toHaveLength(3);
    await updateDoc<GitHubInstallation>(githubInstallationPk('987', '1234'), 'installation', value => ({ ...value, status: 'suspended' }));
    expect((await f.load())[0]?.state).toBeUndefined();
    expect(calls.at(-1)?.auth).toBeUndefined();
    expect(calls).toHaveLength(4);
    await updateDoc<GitHubInstallation>(githubInstallationPk('987', '1234'), 'installation', value => ({ ...value, status: 'connected' }));
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), value => ({ ...value, role: 'commenter' }));
    expect((await f.load())[0]?.state).toBeUndefined();
    expect(calls).toHaveLength(4);
});

test('private threads do not leak state; lost membership during a read is rejected', async () => {
    const f = await fixture(`https://github.com/acme/${randomUUID()}/pull/3`);
    const stranger = await findOrCreateUser(`${randomUUID()}@example.com`);
    await getAppStore().create<DbMember>({ type: 'member', pk: f.project.pk, id: memberId(stranger.id), userId: stranger.id,
        email: stranger.email, workspaceId: f.project.workspaceId, role: 'commenter', projects: 'all', createdAt: '2026-01-01' });
    const stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, private: true }, stored.etag);
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        await getAppStore().delete(f.project.pk, memberId(f.owner.id));
        return json({ number: 3, state: 'closed', merged: true });
    };
    await expect(f.load(stranger.id)).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(0);
    await expect(f.load()).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
});

test('current edits and deleted messages replace links without retaining earlier state', async () => {
    const repo = randomUUID();
    const f = await fixture(`https://github.com/acme/${repo}/pull/1`);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return json({ number: 1, state: 'open', merged: false }); };
    expect((await f.load())[0]?.state).toBe('open');
    let stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, thread: { items: [{ ...stored.comment.thread.items[0]!, text: 'Link removed' }] } }, stored.etag);
    expect(await f.load()).toEqual([]);
    stored = (await getCommentsStore().get(f.comment.domain, f.comment.id))!;
    await getCommentsStore().replace({ ...stored.comment, thread: { items: [stored.comment.thread.items[0]!,
        { id: 'deleted_reply', text: `https://github.com/acme/${repo}/pull/2`, deletedAt: '2026-01-01', createdAt: '2026-01-01' }] } }, stored.etag);
    expect(await f.load()).toEqual([]);
    expect(calls).toBe(1);
});

test('provider failures, oversized bodies and rate limits leave plain links without following redirects', async () => {
    const f = await fixture([1, 2, 3].map(n => `https://github.com/acme/${randomUUID()}/pull/${n}`).join(' '));
    globalThis.fetch = async (url, options) => {
        expect(options?.redirect).toBe('error');
        if (String(url).endsWith('/1')) return json({}, 302, { Location: 'http://127.0.0.1/private' });
        if (String(url).endsWith('/2')) return json({ large: 'x'.repeat(600_000) });
        return json({}, 429, { 'retry-after': '3600' });
    };
    expect((await f.load()).every(value => value.state === undefined)).toBe(true);
    const other = await fixture(`https://github.com/acme/${randomUUID()}/pull/4`);
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Rate-limited bucket must not fetch another link'); };
    expect((await other.load())[0]?.state).toBeUndefined();
    expect(calls).toBe(0);
});

test('manual links validate, deduplicate, retain ownership and record history only on change', async () => {
    const { setProjectCommentPullRequest } = await import('../src/lib/review/pullRequests');
    const f = await fixture('Fixed in https://github.com/acme/site/pull/7');
    const actor = { kind: 'member' as const, userId: f.owner.id, name: 'Owner', isAdmin: true };
    const url = 'https://github.com/acme/site/pull/7';
    const saved = await setProjectCommentPullRequest(f.project, actor, f.comment.id, `${url}/files?diff=1`);
    expect(saved.pullRequests).toEqual([{ url, addedBy: `user:${f.owner.id}` }]);
    expect(threadPullRequestLinks(saved.thread.items, saved.pullRequests)).toHaveLength(1);
    expect(saved.history?.at(-1)?.action).toBe('pull-request-linked');
    const replay = await setProjectCommentPullRequest(f.project, actor, f.comment.id, url);
    expect(replay.history).toEqual(saved.history);
    await expect(setProjectCommentPullRequest(f.project, actor, f.comment.id, 'https://evil.test/pull/7')).rejects.toThrow();
    await expect(setProjectCommentPullRequest(f.project, { kind: 'guest', visitorId: 'visitor_test' }, f.comment.id, url)).rejects.toThrow();
    const other = await findOrCreateUser(`other-${randomUUID()}@example.com`);
    await getAppStore().create<DbMember>({ type: 'member', pk: f.project.pk, id: memberId(other.id), userId: other.id,
        email: other.email, workspaceId: f.project.workspaceId, role: 'admin', projects: 'all', createdAt: '2026-01-01' });
    await expect(setProjectCommentPullRequest(f.project, { ...actor, userId: other.id }, f.comment.id, url, true)).rejects.toThrow('only remove');
    const removed = await setProjectCommentPullRequest(f.project, actor, f.comment.id, url, true);
    expect(removed.pullRequests).toEqual([]);
    expect(removed.history?.at(-1)?.action).toBe('pull-request-removed');
    expect(threadPullRequestLinks(removed.thread.items, removed.pullRequests)).toHaveLength(1);
    const repeat = await setProjectCommentPullRequest(f.project, actor, f.comment.id, url, true);
    expect(repeat.history).toEqual(removed.history);
});
