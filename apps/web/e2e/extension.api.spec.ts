import { test, expect } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { issueExtensionCode, exchangeExtensionCode, extensionSession, readScope, validateAuthorization } from '../src/lib/extension/auth';
import { createScope, createSiteProject, extensionReviewContext, matchingProjects, projectsForSite, siteProjectsLimit } from '../src/lib/extension/review';
import { extensionHandler } from '../src/lib/extension/http';
import { findOrCreateUser } from '../src/lib/app/users';
import { ensureOwnWorkspace, createWorkspace, getMember, getWorkspace } from '../src/lib/app/workspaces';
import { createProject, findProject, listProjects, reserveProjectCreation, updateProject } from '../src/lib/app/projects';
import { deleteProject } from '../src/lib/app/projectDeletion';
import { transferProject } from '../src/lib/app/projectTransfer';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import type { AppContext } from '../src/lib/app/context';
import { assertVerifiedWrite } from '../src/lib/review/verification';
import { signToken } from '../src/lib/app/tokens';
import { memberId, projectRefPk, workspacePk, type AppDoc, type DbMember } from '../src/lib/app/model';
import { joinPublicProject, PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProject';
import { MAX_PROJECT_NAME_LENGTH } from '../src/lib/app/limits';
import { actorAuthorId, assertCanUseComments } from '../src/lib/review/actor';
import { refreshExtensionSession, revokeExtensionSession, extensionAccessSeconds, extensionIdleSeconds, extensionAbsoluteSeconds } from '../src/lib/extension/sessions';
import { extensionClients, extensionFrameAncestors } from '../src/lib/extension/config';
import { latestExtensionVersion } from '../src/lib/extension/release';
import { GET as extensionOperation, POST as extensionWrite } from '../app/api/extension/[operation]/route';
import { readFileSync } from 'node:fs';

const clientId = 'abcdefghijklmnopabcdefghijklmnop';
const redirectUri = `https://${clientId}.chromiumapp.org/uier`;
const original = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_EXTENSION_CLIENT_IDS: process.env.UIER_EXTENSION_CLIENT_IDS, UIER_EXTENSION_CLIENTS: process.env.UIER_EXTENSION_CLIENTS };
test.beforeAll(() => { process.env.UIER_LOCAL = '1'; process.env.UIER_EXTENSION_CLIENT_IDS = clientId; process.env.UIER_EXTENSION_CLIENTS = ''; });
test.afterAll(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const random = () => randomBytes(32).toString('base64url');
async function fixture(renewable = false, registration: { clientId: string; redirectUri: string; extensionOrigin?: string } = { clientId, redirectUri }, capability?: 'create-projects') {
    const user = await findOrCreateUser(`${randomUUID()}@example.test`);
    const member = await ensureOwnWorkspace(user);
    const context = { user, member, workspace: { id: member.workspaceId }, isAdmin: true } as AppContext;
    const project = await createProject(context, { name: 'Extension project', urls: ['https://reviewed.example'] });
    const verifier = random(), state = random();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorization = { ...registration, state, challenge, ...(renewable ? { renewable: 'true' as const } : {}), ...(capability ? { capability } : {}) };
    const callback = new URL(await issueExtensionCode(user.id, authorization));
    const exchange = { clientId: registration.clientId, redirectUri: registration.redirectUri, code: callback.searchParams.get('code'), verifier };
    return { user, project, authorization, callback, exchange };
}
const request = (path: string, token?: string, body?: unknown) => new Request(`https://uier.io/api/extension/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
});
async function renewableFixture(capability?: 'create-projects') {
    const f = await fixture(true, undefined, capability);
    const credentials = await exchangeExtensionCode({ ...f.exchange, renewable: true });
    if (!('refreshToken' in credentials)) throw new Error('Expected renewable extension credentials');
    return { ...f, credentials };
}

test('renewable sessions use short access, recover the same rotation and renew after access expiry', async () => {
    const f = await renewableFixture();
    expect(f.credentials.expiresAt - Date.now()).toBeLessThanOrEqual(extensionAccessSeconds * 1000);
    expect(f.credentials.refreshExpiresAt - Date.now()).toBeGreaterThan((extensionIdleSeconds - 5) * 1000);
    const session = await extensionSession(request('projects', f.credentials.token));
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    await expect(extensionSession(request('projects', f.credentials.refreshToken))).rejects.toMatchObject({ status: 401 });
    await expect(extensionReviewContext(request('review/info', f.credentials.refreshToken))).rejects.toMatchObject({ status: 401 });
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    const [first, concurrent] = await Promise.all([refreshExtensionSession(input), refreshExtensionSession(input)]);
    expect(first.refreshToken).not.toBe(f.credentials.refreshToken);
    expect(concurrent.refreshToken).toBe(first.refreshToken);
    const retained = await getAppStore().query<any>({ type: 'extension-refresh-token', pk: session.pk });
    expect(JSON.stringify(retained)).not.toContain(f.credentials.refreshToken);
    expect(JSON.stringify(retained)).not.toContain(first.refreshToken);
    expect(JSON.stringify(retained)).not.toContain(input.attempt);
    const now = Date.now;
    try {
        const later = now() + 2 * 24 * 3600 * 1000;
        Date.now = () => later;
        await expect(extensionSession(request('projects', first.token))).rejects.toMatchObject({ status: 401 });
        // A delayed/lost response can still recover, without extending the inactivity deadline.
        const recovered = await refreshExtensionSession(input);
        expect(recovered.refreshToken).toBe(first.refreshToken);
        expect(recovered.refreshExpiresAt).toBe(first.refreshExpiresAt);
        const next = await refreshExtensionSession({ clientId, refreshToken: recovered.refreshToken, attempt: random() });
        expect(next.refreshExpiresAt).toBeGreaterThan(first.refreshExpiresAt);
        expect((await extensionSession(request('projects', next.token))).userId).toBe(f.user.id);
        await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 });
        // A delayed receipt from an earlier rotation does not revoke its successor.
        await extensionSession(request('projects', next.token));
        await revokeExtensionSession(request('session', next.refreshToken));
        await expect(extensionSession(request('projects', next.token))).rejects.toMatchObject({ status: 401 });
        await expect(refreshExtensionSession({ clientId, refreshToken: next.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
});

test('refresh replay with a new attempt revokes access and scopes; wrong clients cannot revoke', async () => {
    const f = await renewableFixture();
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    process.env.UIER_EXTENSION_CLIENT_IDS = `${clientId},${'a'.repeat(32)}`;
    try {
        await expect(refreshExtensionSession({ ...input, clientId: 'a'.repeat(32) })).rejects.toMatchObject({ status: 401 });
    } finally { process.env.UIER_EXTENSION_CLIENT_IDS = clientId; }
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const next = await refreshExtensionSession(input);
    await expect(refreshExtensionSession({ ...input, attempt: random() })).rejects.toMatchObject({ status: 401 });
    await expect(extensionSession(request('projects', next.token))).rejects.toMatchObject({ status: 401 });
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
});

test('renewal expires after 30 idle days or one year even with regular use', async () => {
    const idle = await renewableFixture(), active = await renewableFixture();
    const start = Date.now(), now = Date.now;
    let current = active.credentials;
    try {
        let time = start;
        Date.now = () => time;
        time = start + (extensionIdleSeconds + 1) * 1000;
        await expect(refreshExtensionSession({ clientId, refreshToken: idle.credentials.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
        for (let day = 20; day <= 360; day += 20) {
            time = start + day * 24 * 3600 * 1000;
            current = await refreshExtensionSession({ clientId, refreshToken: current.refreshToken, attempt: random() });
        }
        expect(current.refreshExpiresAt).toBeLessThanOrEqual(start + extensionAbsoluteSeconds * 1000);
        time = start + extensionAbsoluteSeconds * 1000 + 1;
        await expect(refreshExtensionSession({ clientId, refreshToken: current.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
});

test('logout after access expiry, removed clients/users and forged refresh credentials fail closed', async () => {
    const f = await renewableFixture();
    const input = { clientId, refreshToken: f.credentials.refreshToken, attempt: random() };
    await expect(refreshExtensionSession({ ...input, refreshToken: input.refreshToken.slice(0, -43) + random() })).rejects.toMatchObject({ status: 401 });
    process.env.UIER_EXTENSION_CLIENT_IDS = '';
    try { await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 }); }
    finally { process.env.UIER_EXTENSION_CLIENT_IDS = clientId; }
    const now = Date.now;
    try {
        const later = now() + 3600 * 1000;
        Date.now = () => later;
        await revokeExtensionSession(request('session', input.refreshToken));
        await expect(refreshExtensionSession(input)).rejects.toMatchObject({ status: 401 });
    } finally { Date.now = now; }
    const removed = await renewableFixture();
    await getAppStore().delete(removed.user.pk, removed.user.id);
    await expect(refreshExtensionSession({ clientId, refreshToken: removed.credentials.refreshToken, attempt: random() })).rejects.toMatchObject({ status: 401 });
});

test('concurrent refresh and logout cannot recreate a revoked session', async () => {
    const f = await renewableFixture();
    const results = await Promise.allSettled([
        refreshExtensionSession({ clientId, refreshToken: f.credentials.refreshToken, attempt: random() }),
        revokeExtensionSession(request('session', f.credentials.refreshToken))
    ]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'fulfilled')
        await expect(extensionSession(request('projects', results[0].value.token))).rejects.toMatchObject({ status: 401 });
    await expect(extensionSession(request('projects', f.credentials.token))).rejects.toMatchObject({ status: 401 });
});

test('exact callback, client registration, state, PKCE and atomic one-use handoff', async () => {
    const f = await fixture();
    expect(f.callback.searchParams.get('state')).toBe(f.authorization.state);
    for (const override of [{ redirectUri: `${redirectUri}/extra` }, { clientId: 'a'.repeat(32) }, { challenge: '' }, { state: 'short' }])
        expect(() => validateAuthorization({ ...f.authorization, ...override })).toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, verifier: random() })).rejects.toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, redirectUri: `${redirectUri}?evil=1` })).rejects.toThrow();
    await expect(exchangeExtensionCode({ ...f.exchange, renewable: true })).rejects.toThrow();
    const results = await Promise.allSettled([exchangeExtensionCode(f.exchange), exchangeExtensionCode(f.exchange)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ token: string }>;
    expect((await extensionSession(request('projects', winner.value.token))).userId).toBe(f.user.id);
    expect(winner.value).not.toHaveProperty('refreshToken');
    // An app/embed/MCP purpose never authenticates the extension API.
    for (const purpose of ['session', 'review', 'mcp-access'])
        await expect(extensionSession(request('projects', signToken(purpose, { uid: f.user.id }, 60)))).rejects.toThrow();
});
test('expired handoff is rejected before session creation', async () => {
    const f = await fixture();
    const hash = createHash('sha256').update(f.exchange.code!).digest('hex');
    const entry = (await getAppStore().get<any>(`extension-code:${hash}`, hash))!;
    await getAppStore().replace({ ...entry.doc, expiresAt: Date.now() - 1 }, entry.etag);
    await expect(exchangeExtensionCode(f.exchange)).rejects.toThrow();
});
test('site discovery distinguishes workspaces and never includes another account or revoked project', async () => {
    const f = await fixture();
    const workspace = await createWorkspace(f.user, 'Client work');
    const member = { workspaceId: workspace.id, userId: f.user.id, role: 'admin', projects: 'all' };
    const second = await createProject({ user: f.user, member, workspace, isAdmin: true } as AppContext,
        { name: f.project.name, urls: ['https://reviewed.example'] });
    const foreign = await fixture();
    const credentials = await exchangeExtensionCode(f.exchange);
    const matches = await (await matchingProjects(request('projects?origin=https://reviewed.example', credentials.token))).json() as Awaited<ReturnType<typeof projectsForSite>> & { account: { name: string; email: string } };
    expect(matches.account).toEqual({ name: f.user.name, email: f.user.email });
    expect(matches.projects).toEqual(expect.arrayContaining([
        expect.objectContaining({ projectId: f.project.id, workspaceId: f.project.workspaceId, workspaceName: 'Personal' }),
        expect.objectContaining({ projectId: second.id, workspaceId: workspace.id, workspaceName: 'Client work' })
    ]));
    expect(matches.projects).toHaveLength(2);
    await expect(createScope(request('scope', credentials.token, { projectId: foreign.project.id, origin: 'https://reviewed.example' }))).rejects.toThrow();
    // Discovery labels grant no authority, and a previously visible selection loses access immediately.
    await getAppStore().delete(workspacePk(workspace.id), memberId(f.user.id));
    expect((await projectsForSite(f.user.id, 'https://reviewed.example')).projects.map(project => project.projectId)).toEqual([f.project.id]);
    await expect(createScope(request('scope', credentials.token, { projectId: second.id, origin: 'https://reviewed.example' }))).rejects.toThrow();
    expect((await projectsForSite(f.user.id, 'https://reviewed.example.evil.test')).projects).toEqual([]);
});

test('an unlisted site gets a project only in a workspace its person administers, by the app\'s creation rules', async () => {
    const f = await renewableFixture('create-projects');
    const token = f.credentials.token;
    const site = `https://new-${randomUUID().slice(0, 8)}.example`;
    const own = f.project.workspaceId;
    // Another person's workspace, where this one only comments, and uier's own workspace, with a stale admin role
    const owner = await fixture();
    const commenter: DbMember = { type: 'member', id: memberId(f.user.id), pk: workspacePk(owner.project.workspaceId), workspaceId: owner.project.workspaceId,
        userId: f.user.id, email: f.user.email, role: 'commenter', projects: 'all', createdAt: new Date().toISOString() };
    expect(await getAppStore().create(commenter)).toBeTruthy();
    const feedback = await joinPublicProject(f.user);
    await updateDoc<DbMember>(feedback.pk, feedback.id, member => ({ ...member, role: 'admin' }));
    const discover = async () => await (await matchingProjects(request(`projects?origin=${site}`, token))).json() as Awaited<ReturnType<typeof projectsForSite>>;
    const before = await discover();
    expect(before.projects).toEqual([]);
    expect(before.workspaces).toEqual([{ id: own, name: 'Personal' }]);
    // Every call is a new submission unless it names its attempt
    const create = (body: object, bearer: string | null = token) => createSiteProject(request('projects', bearer ?? undefined, { attempt: random(), ...body }));

    // Identity: an access token of a live session, never the refresh credential or no credential
    await expect(create({ origin: site, name: 'Site', workspaceId: own }, null)).rejects.toMatchObject({ status: 401 });
    await expect(create({ origin: site, name: 'Site', workspaceId: own }, f.credentials.refreshToken)).rejects.toMatchObject({ status: 401 });
    // Permission: the stored admin membership of the chosen workspace, whatever the popup listed
    for (const workspaceId of [owner.project.workspaceId, PUBLIC_WORKSPACE_ID, `w_${randomUUID()}`])
        await expect(create({ origin: site, name: 'Site', workspaceId })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    // The app's own address and name rules
    for (const origin of [`${site}/path`, 'ftp://files.example', 'https://intranet', 'not an address'])
        await expect(create({ origin, name: 'Site', workspaceId: own })).rejects.toMatchObject({ status: 400 });
    await expect(create({ origin: site, name: 'n'.repeat(MAX_PROJECT_NAME_LENGTH + 1), workspaceId: own })).rejects.toMatchObject({ status: 400, message: `Use at most ${MAX_PROJECT_NAME_LENGTH} characters.` });
    for (const attempt of [undefined, '', 'short', 'a'.repeat(44)])
        await expect(create({ origin: site, name: 'Site', workspaceId: own, attempt })).rejects.toMatchObject({ status: 400 });
    expect((await discover()).projects).toEqual([]);

    // Through the route, as the worker sends it from the extension's origin
    const response = await extensionWrite(new Request('https://uier.io/api/extension/projects', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: `chrome-extension://${clientId}` },
        body: JSON.stringify({ origin: site, name: '  New site  ', workspaceId: own, attempt: random() }) }));
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; projectId: string; name: string; access: string; workspaceId: string; workspaceName: string };
    expect(created).toEqual({ id: expect.stringMatching(/^[\w-]{21}$/), projectId: expect.stringMatching(/^[0-9a-z]{12}$/), name: 'New site', access: 'invited', workspaceId: own, workspaceName: 'Personal' });
    const stored = await findProject(created.projectId);
    expect(stored).toMatchObject({ workspaceId: own, urls: [site], status: 'active', access: 'invited', createdBy: f.user.id, publicId: created.id });
    // The person can review it at once: discovery lists it and a scope for this exact address is issued
    expect((await discover()).projects).toEqual([expect.objectContaining({ id: created.id, projectId: created.projectId, name: 'New site', workspaceId: own })]);
    expect((await createScope(request('scope', token, { projectId: created.projectId, origin: site }))).status).toBe(200);
    // An empty name is the site's host, as in the app's form
    const unnamed = await (await create({ origin: 'https://www.unnamed.example', workspaceId: own })).json() as { name: string };
    expect(unnamed.name).toBe('unnamed.example');

    // A demotion or removal applies to the next request
    await updateDoc<DbMember>(workspacePk(own), memberId(f.user.id), member => ({ ...member, role: 'commenter' }));
    expect((await discover()).workspaces).toEqual([]);
    await expect(create({ origin: site, name: 'Site', workspaceId: own })).rejects.toMatchObject({ status: 403 });
    await getAppStore().delete(workspacePk(own), memberId(f.user.id));
    await expect(create({ origin: site, name: 'Site', workspaceId: own })).rejects.toMatchObject({ status: 403 });
});

test('a sign-in that approved reviewing alone keeps reviewing and cannot create a project', async () => {
    const site = `https://new-${randomUUID().slice(0, 8)}.example`;
    // Sessions as they were issued before the extension could create projects: the eight-hour one and the renewable one
    const legacy = await fixture();
    const renewable = await renewableFixture();
    // An exchange cannot add what consent did not name
    const upgraded = await fixture(true);
    const sessions = [
        { f: legacy, credentials: await exchangeExtensionCode(legacy.exchange) },
        { f: renewable, credentials: renewable.credentials },
        { f: upgraded, credentials: await exchangeExtensionCode({ ...upgraded.exchange, renewable: true, capability: 'create-projects' }) }
    ];
    for (const { f, credentials } of sessions) {
        const body = { origin: site, name: 'Site', workspaceId: f.project.workspaceId, attempt: random() };
        await expect(createSiteProject(request('projects', credentials.token, body))).rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'Sign in to the extension again to create projects.' });
        const refused = await extensionWrite(request('projects', credentials.token, body));
        expect(refused.status).toBe(403);
        // Reviewing is unchanged: discovery, a scope for a project's own address and its review context
        const found = await (await matchingProjects(request(`projects?origin=${site}`, credentials.token))).json() as { projects: unknown[]; workspaces: unknown[]; approveCreate?: boolean; canSetUp: boolean };
        expect(found).toMatchObject({ projects: [], workspaces: [], approveCreate: true, canSetUp: true });
        const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
        expect((await extensionReviewContext(request('review/info', scoped.token))).project.id).toBe(f.project.id);
        expect((await listProjects(f.project.workspaceId)).map(project => project.id)).toEqual([f.project.id]);
    }
    // Renewal keeps a session as it was approved: it neither adds the capability nor drops it
    const renewed = await refreshExtensionSession({ clientId, refreshToken: renewable.credentials.refreshToken, attempt: random() });
    await expect(createSiteProject(request('projects', renewed.token, { origin: site, name: 'Site', workspaceId: renewable.project.workspaceId, attempt: random() }))).rejects.toMatchObject({ status: 403 });
    const approved = await renewableFixture('create-projects');
    expect((await extensionSession(request('projects', approved.credentials.token))).capabilities).toEqual(['create-projects']);
    const later = await refreshExtensionSession({ clientId, refreshToken: approved.credentials.refreshToken, attempt: random() });
    const found = await (await matchingProjects(request(`projects?origin=${site}`, later.token))).json() as { workspaces: unknown[]; approveCreate?: boolean };
    expect(found.workspaces).toEqual([{ id: approved.project.workspaceId, name: 'Personal' }]);
    expect(found.approveCreate).toBeUndefined();
    expect((await createSiteProject(request('projects', later.token, { origin: site, name: 'Site', workspaceId: approved.project.workspaceId, attempt: random() }))).status).toBe(201);
    // Consent asks for a capability it knows, and nothing else
    expect(() => validateAuthorization({ ...approved.authorization, capability: 'manage-workspace' })).toThrow();
});

test('a repeated or concurrent create with one attempt gives one project', async () => {
    const f = await renewableFixture('create-projects');
    const token = f.credentials.token, own = f.project.workspaceId;
    const site = `https://new-${randomUUID().slice(0, 8)}.example`;
    const create = async (body: object, bearer = token) => await (await createSiteProject(request('projects', bearer, { origin: site, name: 'Site', workspaceId: own, ...body }))).json() as { id: string; projectId: string };
    const created = async () => (await listProjects(own)).filter(project => project.id !== f.project.id).map(project => project.id).sort();

    // The answer was lost: the worker sends the attempt it saved again
    const attempt = random();
    const first = await create({ attempt });
    expect(await create({ attempt })).toEqual(first);
    expect(await created()).toEqual([first.projectId]);
    // Renamed in the app since: the replay still answers with that project, as it is now
    await updateProject(own, first.projectId, { name: 'Renamed' });
    expect(await (await createSiteProject(request('projects', token, { origin: site, name: 'Site', workspaceId: own, attempt }))).json()).toMatchObject({ projectId: first.projectId, name: 'Renamed' });

    // Two popups, a second press: at once, with one attempt
    const together = random();
    const answers = await Promise.all(Array.from({ length: 6 }, () => create({ attempt: together, name: 'Together' })));
    expect(new Set(answers.map(answer => answer.projectId)).size).toBe(1);
    expect(new Set(answers.map(answer => answer.id)).size).toBe(1);
    expect(await created()).toEqual([first.projectId, answers[0]!.projectId].sort());
    expect((await findProject(answers[0]!.projectId))).toMatchObject({ name: 'Together', urls: [site], createdBy: f.user.id });

    // An attempt belongs to its account, workspace and input: anything else is another submission
    const other = await create({ attempt, name: 'Another name' });
    expect(other.projectId).not.toBe(first.projectId);
    const elsewhere = await create({ attempt, origin: 'https://elsewhere.example' });
    expect([first.projectId, other.projectId]).not.toContain(elsewhere.projectId);
    const stranger = await renewableFixture('create-projects');
    const theirs = await (await createSiteProject(request('projects', stranger.credentials.token, { origin: site, name: 'Site', workspaceId: stranger.project.workspaceId, attempt }))).json() as { projectId: string };
    expect(theirs.projectId).not.toBe(first.projectId);
    await expect(createSiteProject(request('projects', stranger.credentials.token, { origin: site, name: 'Site', workspaceId: own, attempt }))).rejects.toMatchObject({ status: 403 });
    expect(await created()).toHaveLength(4);
});

test('project creation from the extension is limited per account and a refusal creates nothing', async () => {
    const f = await renewableFixture('create-projects');
    const own = f.project.workspaceId;
    const limit = siteProjectsLimit(f.user.id);
    const post = (body: object) => extensionWrite(new Request('https://uier.io/api/extension/projects', { method: 'POST',
        headers: { Authorization: `Bearer ${f.credentials.token}`, 'Content-Type': 'application/json', Origin: `chrome-extension://${clientId}` },
        body: JSON.stringify({ name: 'Site', workspaceId: own, attempt: random(), ...body }) }));
    const now = Date.now;
    // One fixed moment: the whole budget and the refusal fall in the same hour
    const moment = now();
    try {
        Date.now = () => moment;
        const attempts: string[] = [];
        for (let index = 0; index < limit.limit; index++) {
            attempts.push(random());
            expect((await post({ origin: `https://site-${index}.example`, attempt: attempts[index] })).status).toBe(201);
        }
        expect(await listProjects(own)).toHaveLength(limit.limit + 1);
        const refused = await post({ origin: 'https://one-too-many.example' });
        expect(refused.status).toBe(429);
        expect(await refused.json()).toMatchObject({ error: 'rate_limited', reason: 'too_fast', message: 'Too many new projects. Try again later.' });
        expect(Number(refused.headers.get('Retry-After'))).toBe(limit.windowSeconds - Math.floor(moment / 1000) % limit.windowSeconds);
        expect(refused.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
        // Nothing was created for the refused attempt
        expect(await listProjects(own)).toHaveLength(limit.limit + 1);
        expect((await projectsForSite(f.user.id, 'https://one-too-many.example')).projects).toEqual([]);
        // An answer lost before the budget ran out is still given: a replay is not a new project
        const replay = await post({ origin: 'https://site-0.example', attempt: attempts[0] });
        expect(replay.status).toBe(201);
        expect(await listProjects(own)).toHaveLength(limit.limit + 1);
        // The budget is the account's own
        const other = await renewableFixture('create-projects');
        expect((await createSiteProject(request('projects', other.credentials.token, { origin: 'https://theirs.example', name: 'Site', workspaceId: other.project.workspaceId, attempt: random() }))).status).toBe(201);
    } finally { Date.now = now; }
});

test('concurrent requests of one attempt take one unit of the budget, with one unit left', async () => {
    const f = await renewableFixture('create-projects');
    const own = f.project.workspaceId;
    const limit = siteProjectsLimit(f.user.id);
    const post = (body: object) => extensionWrite(new Request('https://uier.io/api/extension/projects', { method: 'POST',
        headers: { Authorization: `Bearer ${f.credentials.token}`, 'Content-Type': 'application/json', Origin: `chrome-extension://${clientId}` },
        body: JSON.stringify({ name: 'Site', workspaceId: own, attempt: random(), ...body }) }));
    const created = async () => (await listProjects(own)).length - 1;
    const now = Date.now, moment = now();
    try {
        Date.now = () => moment;
        // A request that stopped after its receipt: the unit is taken, nothing of the project exists
        const stopped = random();
        const owner = { user: f.user, workspace: (await getWorkspace(own))! };
        const reserved = await reserveProjectCreation(owner, { name: 'Site', urls: ['https://stopped.example'] }, stopped, limit);
        expect(await findProject(reserved.projectId)).toBeNull();
        for (let index = 0; index < limit.limit - 2; index++)
            expect((await post({ origin: `https://site-${index}.example` })).status).toBe(201);
        expect(await created()).toBe(limit.limit - 2);

        // One unit left, and one submission arrives six times at once: none is refused, all name the one project
        const attempt = random();
        const answers = await Promise.all(Array.from({ length: 6 }, () => post({ origin: 'https://last.example', attempt })));
        expect(answers.map(answer => answer.status)).toEqual(Array(6).fill(201));
        const projects = await Promise.all(answers.map(async answer => (await answer.json() as { projectId: string }).projectId));
        expect(new Set(projects).size).toBe(1);
        expect(await created()).toBe(limit.limit - 1);
        // That was the last unit: another submission is refused and leaves nothing behind
        const refused = await post({ origin: 'https://one-too-many.example' });
        expect(refused.status).toBe(429);
        expect(Number(refused.headers.get('Retry-After'))).toBe(limit.windowSeconds - Math.floor(moment / 1000) % limit.windowSeconds);
        expect(await created()).toBe(limit.limit - 1);
        // Refused again on its retry, with the same attempt: a refusal reserves nothing
        const again = random();
        expect((await post({ origin: 'https://one-too-many.example', attempt: again })).status).toBe(429);
        expect((await post({ origin: 'https://one-too-many.example', attempt: again })).status).toBe(429);
        // With the budget spent, the six get their answer again and the stopped request finishes: neither takes a unit
        expect(await (await post({ origin: 'https://last.example', attempt })).json()).toMatchObject({ projectId: projects[0] });
        const finished = await post({ origin: 'https://stopped.example', attempt: stopped });
        expect(finished.status).toBe(201);
        expect(await finished.json()).toMatchObject({ projectId: reserved.projectId, name: 'Site' });
        expect(await created()).toBe(limit.limit);
        expect((await post({ origin: 'https://one-too-many.example' })).status).toBe(429);
        // The next hour has a new budget; the receipts of this one still answer
        Date.now = () => moment + 5 * 60 * 1000;
        const sameHour = Math.floor((moment + 5 * 60 * 1000) / 1000 / limit.windowSeconds) === Math.floor(moment / 1000 / limit.windowSeconds);
        expect((await post({ origin: 'https://later.example' })).status).toBe(sameHour ? 429 : 201);
    } finally { Date.now = now; }
});

test('a replay never creates a removed project again and finishes one that was not created', async () => {
    const f = await renewableFixture('create-projects');
    const own = f.project.workspaceId, token = f.credentials.token;
    const workspace = (await getWorkspace(own))!;
    const context = { user: f.user, member: (await getMember(own, f.user.id))!, workspace, isAdmin: true, memberships: [] } as AppContext;
    const submit = (origin: string, attempt: string) => extensionWrite(request('projects', token, { origin, name: 'Site', workspaceId: own, attempt }));
    const create = async (origin: string, attempt: string) => await (await submit(origin, attempt)).json() as { id: string; projectId: string };
    const gone = async (origin: string, attempt: string, projectId: string) => {
        const response = await submit(origin, attempt);
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({ error: 'not_found', message: 'This project no longer exists.' });
        // Not under its old code, and not under a new one
        expect(await getAppStore().get(workspacePk(own), projectId)).toBeNull();
        expect((await projectsForSite(f.user.id, origin)).projects).toEqual([]);
    };

    // Deletion removes the document first and retires the code after: a replay in between sees a live code and no project
    const between = random();
    const first = await create('https://between.example', between);
    expect(await getAppStore().delete(workspacePk(own), first.projectId)).toBe(true);
    expect((await getAppStore().get<AppDoc>(projectRefPk(first.projectId), first.projectId))?.doc.type).toBe('project-ref');
    await gone('https://between.example', between, first.projectId);
    await gone('https://between.example', between, first.projectId);

    // Deleted in the app
    const deleted = random();
    const second = await create('https://deleted.example', deleted);
    await deleteProject(context, second.projectId, 'Site');
    expect((await getAppStore().get<AppDoc>(projectRefPk(second.projectId), second.projectId))?.doc.type).toBe('project-ref-retired');
    await gone('https://deleted.example', deleted, second.projectId);

    // Transferred to another workspace: it lives there, and the old workspace gets no second one
    const moved = random();
    const third = await create('https://moved.example', moved);
    const target = await createWorkspace(f.user, 'Client work');
    await transferProject(context, third.projectId, target.id, 'Site');
    const response = await submit('https://moved.example', moved);
    expect(response.status).toBe(410);
    expect(await getAppStore().get(workspacePk(own), third.projectId)).toBeNull();
    expect((await findProject(third.projectId))?.workspaceId).toBe(target.id);
    expect((await projectsForSite(f.user.id, 'https://moved.example')).projects.map(project => project.projectId)).toEqual([third.projectId]);

    // The same form after a removal is a new submission, with the worker's new attempt
    const fresh = await create('https://deleted.example', random());
    expect(fresh.projectId).not.toBe(second.projectId);
    expect(await findProject(fresh.projectId)).toMatchObject({ urls: ['https://deleted.example'] });

    // A request that stopped after claiming its code, before the project: the retry creates it, once
    const stopped = random();
    const reserved = await reserveProjectCreation({ user: f.user, workspace }, { name: 'Site', urls: ['https://stopped.example'] }, stopped, siteProjectsLimit(f.user.id));
    expect(await getAppStore().create({ type: 'project-ref', id: reserved.projectId, pk: projectRefPk(reserved.projectId), workspaceId: own })).toBe(true);
    const finished = await Promise.all([create('https://stopped.example', stopped), create('https://stopped.example', stopped), create('https://stopped.example', stopped)]);
    expect(finished.map(answer => answer.projectId)).toEqual(Array(3).fill(reserved.projectId));
    expect(new Set(finished.map(answer => answer.id)).size).toBe(1);
    expect((await projectsForSite(f.user.id, 'https://stopped.example')).projects).toHaveLength(1);
    // The receipt belongs to its person and workspace
    const stranger = await renewableFixture('create-projects');
    await expect(createProject({ user: stranger.user, workspace }, { name: 'Site', urls: ['https://stopped.example'] }, { receipt: reserved })).rejects.toThrow();
});

test('scoped access derives the origin and rechecks address removal, comments off and revocation', async () => {
    const f = await fixture();
    const credentials = await exchangeExtensionCode(f.exchange);
    const matches = await (await matchingProjects(request('projects?origin=https://reviewed.example', credentials.token))).json() as { projects: { projectId: string }[] };
    expect(matches.projects.map((p: any) => p.projectId)).toContain(f.project.id);
    const noMatch = await (await matchingProjects(request('projects?origin=https://reviewed.example.evil.test', credentials.token))).json() as { projects: unknown[] };
    expect(noMatch.projects).toEqual([]);
    await expect(createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://evil.test' }))).rejects.toThrow();
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const scopedRequest = request('review/info', scoped.token);
    expect(readScope(scopedRequest).origin).toBe('https://reviewed.example');
    const context = await extensionReviewContext(scopedRequest);
    expect(context.actor.kind).toBe('member');
    await expect(assertVerifiedWrite(context)).rejects.toThrow();
    const proof = signToken('review-verification', { projectId: f.project.id, origin: context.siteOrigin, authorId: actorAuthorId(context.actor) }, 300);
    await assertVerifiedWrite({ ...context, request: new Request(scopedRequest, { headers: { 'X-Uier-Verification': proof } }) });
    await expect(assertVerifiedWrite({ ...context, siteOrigin: 'https://evil.test', request: new Request(scopedRequest, { headers: { 'X-Uier-Verification': proof } }) })).rejects.toThrow();
    await updateProject(f.project.workspaceId, f.project.id, { urls: ['https://elsewhere.example'] });
    await expect(extensionReviewContext(scopedRequest)).rejects.toThrow();
    const session = await extensionSession(request('session', credentials.token));
    await getAppStore().delete(session.pk, session.id);
    await expect(extensionSession(request('projects', credentials.token))).rejects.toThrow();
    await expect(extensionReviewContext(scopedRequest)).rejects.toThrow();
});
test('the public version matches every browser package and needs no credentials', async () => {
    const versions = ['extension', 'extension-firefox'].map(app => (JSON.parse(readFileSync(new URL(`../../${app}/package.json`, import.meta.url), 'utf8')) as { version: string }).version);
    expect(versions).toEqual([latestExtensionVersion, latestExtensionVersion]);
    for (const origin of [undefined, `chrome-extension://${clientId}`]) {
        const response = await extensionOperation(new Request('https://uier.io/api/extension/version', { headers: origin ? { Origin: origin } : {} }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ version: latestExtensionVersion });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin ?? null);
    }
    const foreign = await extensionOperation(new Request('https://uier.io/api/extension/version', { headers: { Origin: 'https://evil.test' } }));
    expect(foreign.status).toBe(403);
});

test('extension CORS cannot grant identity and leaves embed policy separate', async () => {
    const handler = extensionHandler(async request => { await extensionSession(request); return Response.json({ ok: true }); });
    for (const origin of [undefined, `chrome-extension://${clientId}`, 'https://evil.test']) {
        const response = await handler(new Request('https://uier.io/api/extension/projects', { headers: origin ? { Origin: origin } : {} }));
        expect(response.ok).toBe(false);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin?.startsWith('chrome-extension:') ? origin : null);
    }
});

test('Firefox uses exact registered callbacks and binds renewable scopes to its current extension origin', async () => {
    const id = 'uier@signalco.io';
    const callback = 'https://1234567890abcdef.extensions.allizom.org/';
    const scheme = 'moz-extension';
    const extensionOrigin = `${scheme}://12345678-1234-1234-1234-123456789abc`;
    const nextOrigin = `${scheme}://abcdefab-1234-1234-1234-123456789abc`;
    process.env.UIER_EXTENSION_CLIENTS = JSON.stringify([{ id, browser: 'firefox', redirectUri: callback }]);
    try {
        const f = await fixture(true, { clientId: id, redirectUri: callback, extensionOrigin });
        expect(f.callback.href.startsWith(callback)).toBe(true);
        for (const override of [
            { extensionOrigin: undefined }, { extensionOrigin: 'https://evil.test' },
            { extensionOrigin: `${extensionOrigin}/` }, { extensionOrigin: `chrome-extension://${clientId}` },
            { redirectUri: `${callback}?redirect=https://evil.test` }, { clientId: `${id}.unknown` }
        ]) expect(() => validateAuthorization({ ...f.authorization, ...override })).toThrow();
        const credentials = await exchangeExtensionCode({ ...f.exchange, renewable: true });
        if (!('refreshToken' in credentials)) throw new Error('Expected renewable session');
        expect((await extensionSession(request('projects', credentials.token))).extensionOrigin).toBe(extensionOrigin);
        const scope = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
        expect(readScope(request('review/info', scope.token)).extensionOrigin).toBe(extensionOrigin);
        const refresh = { clientId: id, refreshToken: credentials.refreshToken, attempt: random() };
        await expect(refreshExtensionSession(refresh)).rejects.toMatchObject({ status: 401 });
        await expect(refreshExtensionSession({ ...refresh, extensionOrigin: 'https://evil.test' })).rejects.toMatchObject({ status: 401 });
        const renewed = await refreshExtensionSession({ ...refresh, extensionOrigin: nextOrigin });
        expect((await extensionSession(request('projects', renewed.token))).extensionOrigin).toBe(nextOrigin);
        await expect(extensionSession(request('projects', credentials.token))).rejects.toMatchObject({ status: 401 });
        await expect(extensionReviewContext(request('review/info', scope.token))).rejects.toMatchObject({ status: 401 });
        // A lost refresh response recovers the same successor while rebinding the origin.
        const recovered = await refreshExtensionSession({ ...refresh, extensionOrigin });
        expect(recovered.refreshToken).toBe(renewed.refreshToken);
        expect(recovered.refreshExpiresAt).toBe(renewed.refreshExpiresAt);
        expect((await extensionSession(request('projects', recovered.token))).extensionOrigin).toBe(extensionOrigin);
        const handler = extensionHandler(async request => { await extensionSession(request); return Response.json({ ok: true }); });
        const unauthenticated = await handler(new Request('https://uier.io/api/extension/projects', { headers: { Origin: extensionOrigin } }));
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe(extensionOrigin);
        const helper = new URL('https://uier.io/extension-verification');
        helper.searchParams.set('clientId', id); helper.searchParams.set('extensionOrigin', extensionOrigin);
        expect(extensionFrameAncestors(helper)).toEqual([extensionOrigin]);
        helper.searchParams.set('extensionOrigin', 'https://evil.test');
        expect(extensionFrameAncestors(helper)).toEqual([]);
        expect(extensionFrameAncestors(new URL('https://uier.io/extension-verification'))).toEqual([`chrome-extension://${clientId}`]);
        process.env.UIER_EXTENSION_CLIENTS = '[]';
        await expect(extensionSession(request('projects', recovered.token))).rejects.toMatchObject({ status: 401 });
    } finally { process.env.UIER_EXTENSION_CLIENTS = ''; }
});

test('additional browser registrations fail closed on malformed or duplicate configuration', async () => {
    for (const value of ['{', '{}', JSON.stringify([{ id: 'uier@signalco.io', browser: 'firefox', redirectUri: 'https://evil.test/' }]),
        JSON.stringify([{ id: clientId, browser: 'firefox', redirectUri: 'https://1234567890abcdef.extensions.allizom.org/' }]),
        JSON.stringify([{ id: 'uier@signalco.io', browser: 'unsupported', redirectUri: 'https://1234567890abcdef.extensions.allizom.org/' }])]) {
        process.env.UIER_EXTENSION_CLIENTS = value;
        expect(extensionClients().map(client => client.id)).toEqual([clientId]);
    }
    process.env.UIER_EXTENSION_CLIENTS = '';
});

test('live membership and comments-off checks apply to extension review contexts', async () => {
    const f = await fixture();
    const credentials = await exchangeExtensionCode(f.exchange);
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    await updateProject(f.project.workspaceId, f.project.id, { access: 'disabled' });
    const disabled = await extensionReviewContext(request('review/comments', scoped.token));
    expect(() => assertCanUseComments(disabled.project, disabled.actor)).toThrow('Comments are turned off');
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    await expect(extensionReviewContext(request('review/info', scoped.token))).rejects.toMatchObject({ status: 401 });
    // A forged/expired scoped token cannot fall back to anonymous access on a guest project.
    const expired = signToken('extension-review-v1', { projectId: f.project.id, origin: 'https://reviewed.example' }, -1);
    await expect(extensionReviewContext(request('review/info', expired))).rejects.toMatchObject({ status: 401 });
});

test('priority uses scoped extension identity and the shared proof and member authority', async () => {
    const { prioritizeReviewComment } = await import('../src/lib/review/routes');
    const { createProjectComment } = await import('../src/lib/review/comments');
    const { memberActor } = await import('../src/lib/review/actor');
    const f = await fixture();
    const actor = (await memberActor(f.project, f.user.id))!;
    const comment = await createProjectComment(new Request('https://uier.io'), f.project, actor, {
        origin: 'https://reviewed.example', path: '/', position: { type: 'page' }, kind: 'feedback', text: 'Extension priority'
    });
    const credentials = await exchangeExtensionCode(f.exchange);
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const url = `https://uier.io/api/extension/review/comments/${comment.id}/priority`;
    const headers = { Authorization: `Bearer ${scoped.token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ priority: 'urgent', idempotencyKey: randomUUID() });
    const unverified = await extensionReviewContext(new Request(url, { method: 'PATCH', headers, body }));
    await expect(assertVerifiedWrite(unverified)).rejects.toMatchObject({ status: 403 });
    const proof = signToken('review-verification', { projectId: f.project.id, origin: 'https://reviewed.example', authorId: actorAuthorId(actor) }, 300);
    const verified = new Request(url, { method: 'PATCH', headers: { ...headers, 'X-Uier-Verification': proof }, body });
    const context = await extensionReviewContext(verified);
    await assertVerifiedWrite(context);
    const response = await prioritizeReviewComment(context, { id: comment.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ priority: 'urgent', permissions: { priority: true } });
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    await expect(extensionReviewContext(verified)).rejects.toMatchObject({ status: 401 });
});

test('extension reply image reads use the closed broker route and current thread authority', async () => {
    const { getReviewScreenshot } = await import('../src/lib/review/routes');
    const { allowedExtensionOperation, extensionOperation } = await import('@uier/toolbar/extension-contract');
    const { getMemoryCommentsStore } = await import('../src/lib/repo/memoryCommentsStore');
    const { screenshotSchema } = await import('../src/lib/comments/validation');
    const { screenshotDocument, screenshotInfo } = await import('../src/lib/comments/service');
    const { pngImage } = await import('./support/images');
    const f = await renewableFixture();
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const screenshot = await screenshotSchema.parseAsync(pngImage);
    const id = `comment_${randomUUID()}`, itemId = `item_${randomUUID()}`;
    const comment = { id, domain: `project:${f.project.id}`, path: '/', position: { type: 'page' as const }, authorId: `user:${f.user.id}`,
        private: true, thread: { items: [{ id: 'first', text: 'Original' }, { id: itemId, text: 'Reply evidence', screenshot: screenshotInfo(screenshot) }] } };
    const store = getMemoryCommentsStore();
    await store.create(comment);
    await store.createScreenshot(screenshotDocument(comment, screenshot, itemId));
    const path = `comments/${id}/replies/${itemId}/screenshot`;
    const GET = extensionHandler(async request => getReviewScreenshot(await extensionReviewContext(request), { id, itemId }));
    expect(extensionOperation(`https://uier.io/api/review/${f.project.id}/${path}`, 'https://uier.io', f.project.id, 'GET').path).toBe(path);
    for (const method of ['POST', 'PATCH', 'DELETE']) expect(allowedExtensionOperation(path, method)).toBe(false);
    const response = await GET(request(`review/${path}`, scoped.token));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(screenshot.data);
    expect((await store.get(comment.domain, id))!.comment.thread.items).toHaveLength(2);
    expect((await GET(request(`review/${path}`))).status).toBe(401);
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    expect((await GET(request(`review/${path}`, scoped.token))).status).toBe(401);
});


test('extension comment lists forward archive filters and paging while unknown query keys stay closed', async () => {
    const { extensionOperation } = await import('@uier/toolbar/extension-contract');
    const base = 'https://uier.io/api/review/project123/comments';
    for (const archive of ['exclude', 'only', 'all']) {
        for (const scope of ['path=%2F', 'scope=site&unread=true']) {
            const query = `?${scope}&archive=${archive}`;
            expect(extensionOperation(`${base}${query}`, 'https://uier.io', 'project123', 'GET'))
                .toEqual({ path: 'comments', query });
        }
    }
    // The inbox's pages: a limit and the cursor of the page before
    const paged = '?scope=site&archive=exclude&limit=200&before=2026-01-01T00%3A00%3A00.000Z%7Ccomment_x';
    expect(extensionOperation(`${base}${paged}`, 'https://uier.io', 'project123', 'GET')).toEqual({ path: 'comments', query: paged });
    expect(() => extensionOperation(`${base}?arbitrary=true`, 'https://uier.io', 'project123', 'GET'))
        .toThrow('Unsupported review query');
});

test('extension site lists page through the broker: the second page continues after the first', async () => {
    const { extensionOperation } = await import('@uier/toolbar/extension-contract');
    const { getMemoryCommentsStore } = await import('../src/lib/repo/memoryCommentsStore');
    const { listReviewComments } = await import('../src/lib/review/readRoutes');
    // The broker's list operation (`app/api/extension/review/[...path]/route.ts`)
    const brokered = extensionHandler(async request => listReviewComments(await extensionReviewContext(request)));
    const f = await renewableFixture();
    const scoped = await (await createScope(request('scope', f.credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    const store = getMemoryCommentsStore();
    const ids = [1, 2, 3].map(index => `comment_page${index}_${randomUUID()}`);
    for (const [index, id] of ids.entries()) await store.create({ id, domain: `project:${f.project.id}`, projectId: f.project.id, origin: 'https://reviewed.example',
        path: `/page-${index}`, position: { type: 'page' }, authorId: `user:${f.user.id}`, number: index + 1,
        thread: { items: [{ id: 'first', text: `Paged ${index}`, authorId: `user:${f.user.id}` }] }, createdAt: `2026-02-0${index + 1}T00:00:00.000Z` });
    // The toolbar's request, as the worker checks it and forwards it to the broker
    const page = async (query: string) => {
        const url = `https://uier.io/api/review/${f.project.id}/comments?${query}`;
        const operation = extensionOperation(url, 'https://uier.io', f.project.id, 'GET');
        const response = await brokered(request(`review/${operation.path}${operation.query}`, scoped.token));
        expect(response.status).toBe(200);
        return await response.json() as { comments: { id: string }[]; next: string | null };
    };
    const first = await page('scope=site&archive=exclude&limit=2');
    expect(first.comments.map(comment => comment.id)).toEqual([ids[2], ids[1]]);
    expect(first.next).toEqual(expect.any(String));
    const second = await page(`scope=site&archive=exclude&limit=2&before=${encodeURIComponent(first.next!)}`);
    expect(second).toEqual({ comments: [expect.objectContaining({ id: ids[0] })], next: null });
});

test('extension workflow discovery uses the allowed GET operation and current member authority', async () => {
    const { getReviewStatuses } = await import('../src/lib/review/routes');
    const GET = extensionHandler(async request => getReviewStatuses(await extensionReviewContext(request)));
    const { defaultStatusWorkflow, orderedStatuses } = await import('../src/lib/app/statusWorkflow');
    const { allowedExtensionOperation, extensionOperation } = await import('@uier/toolbar/extension-contract');
    const f = await fixture();
    const workflow = { ...structuredClone(defaultStatusWorkflow), statuses: [...defaultStatusWorkflow.statuses,
        { id: 'approved', category: 'open' as const, label: 'Approved', description: 'Internal workflow hint' }] };
    await updateProject(f.project.workspaceId, f.project.id, { statusWorkflow: { mode: 'replace', value: workflow } });
    const credentials = await exchangeExtensionCode(f.exchange);
    const scoped = await (await createScope(request('scope', credentials.token, { projectId: f.project.id, origin: 'https://reviewed.example' }))).json() as { token: string };
    expect(extensionOperation(`https://uier.io/api/review/${f.project.id}/statuses`, 'https://uier.io', f.project.id, 'GET')).toEqual({ path: 'statuses', query: '' });
    for (const method of ['POST', 'PATCH', 'DELETE']) expect(allowedExtensionOperation('statuses', method)).toBe(false);
    const response = await GET(request('review/statuses', scoped.token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...workflow, verificationEnabled: false, statuses: orderedStatuses({ ...workflow, verificationEnabled: false }) });
    await getAppStore().delete(workspacePk(f.project.workspaceId), memberId(f.user.id));
    expect((await GET(request('review/statuses', scoped.token))).status).toBe(401);
});
