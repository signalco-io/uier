import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { NextRequest } from 'next/server.js';
import { POST } from '../app/api/account/sessions/route';
import { brand } from '@uier/brand';
import { accountDeletedNotice, isAccountDeletedNotice } from '../src/lib/app/accountDeletedNotice';
import type { AccountDeletion } from '../src/lib/app/accountDeletionGuard';
import type { EmailMessage } from '../src/lib/email/send';
import { deleteAccount, sweepAccountDeletions } from '../src/lib/app/accountDeletion';
import { emailPk, memberId, userPk, workspacePk, type DbMember, type DbWorkspace } from '../src/lib/app/model';
import { createProject, findProject, getProject, reserveProjectCreation } from '../src/lib/app/projects';
import { sweepProjectTransfers, transferProject, type ProjectTransfer } from '../src/lib/app/projectTransfer';
import { loadAppContext } from '../src/lib/app/requestContext';
import { cookieName, cookieNames } from '../src/lib/cookieNames';
import { sessionToken, sessionUser } from '../src/lib/app/sessionIdentity';
import { getAppStore, type AppStore } from '../src/lib/app/store';
import { findOrCreateUser, getUser } from '../src/lib/app/users';
import { createWorkspace, getMember, getWorkspace } from '../src/lib/app/workspaces';
import { linkGoogleAccount, findUserByGoogleSubject } from '../src/lib/app/google/identity';
import { linkMicrosoftAccount, findUserByMicrosoftSubject } from '../src/lib/app/microsoft/identity';
import { PUBLIC_WORKSPACE_ID } from '../src/lib/comments/publicProjectPolicy';
import { authenticateMcp, createMcpCredential } from '../src/lib/mcp/credentials';
import { exchangeReviewCode, issueReviewCode, resolveActor } from '../src/lib/review/actor';
import { siteProjectsLimit } from '../src/lib/extension/review';
import { createExtensionSession, extensionSession } from '../src/lib/extension/sessions';
import { uniqueEmail } from './support/app';

const extensionClient = 'abcdefghijklmnopabcdefghijklmnop';
const environment = { UIER_LOCAL: process.env.UIER_LOCAL, UIER_EXTENSION_CLIENT_IDS: process.env.UIER_EXTENSION_CLIENT_IDS,
    UIER_EXTENSION_CLIENTS: process.env.UIER_EXTENSION_CLIENTS };
test.beforeAll(() => { Object.assign(process.env, { UIER_LOCAL: '1', UIER_EXTENSION_CLIENT_IDS: extensionClient, UIER_EXTENSION_CLIENTS: '' }); });
test.afterAll(() => {
    for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});
const session = (userId: string) => ({ userId, signedInAt: Math.floor(Date.now() / 1000) });
const origin = 'http://localhost:4004';
function request(expectedUserId: string, confirmation: string, cookie = '', requestOrigin = origin) {
    return new NextRequest(origin + '/api/account/sessions', { method: 'POST',
        headers: { origin: requestOrigin, host: new URL(origin).host, 'content-type': 'application/json', cookie },
        body: JSON.stringify({ action: 'delete-account', expectedUserId, confirmation }) });
}

test('deletion requires same origin, the active session, a recent sign-in and its own email', async () => {
    const user = await findOrCreateUser(uniqueEmail('delete-auth'));
    const token = sessionToken(user.id).token;
    const cookie = `${cookieName(cookieNames.session)}=${token}`;
    expect((await POST(request(user.id, user.email))).status).toBe(401);
    expect((await POST(request(user.id, user.email, cookie, 'https://elsewhere.example'))).status).toBe(403);
    expect((await POST(request(user.id, 'another@example.com', cookie))).status).toBe(400);
    expect((await POST(request('u_different', user.email, cookie))).status).toBe(401);
    expect((await POST(request(user.id, user.email, `${cookieName(cookieNames.account1)}=${token}`))).status).toBe(401);
    await expect(deleteAccount({ ...session(user.id), signedInAt: session(user.id).signedInAt - 601 }, user.email)).rejects.toThrow('Sign in again');
    expect(await sessionUser(token)).toMatchObject({ id: user.id });
});

test('a blocked deletion preserves every membership and requires an explicit handoff', async () => {
    const user = await findOrCreateUser(uniqueEmail('handoff'));
    const context = (await loadAppContext(user))!;
    const workspace = await createWorkspace(user, 'Client team');
    const other = await findOrCreateUser(uniqueEmail('teammate'));
    const store = getAppStore();
    const member: DbMember = { ...context.member, pk: workspace.pk, workspaceId: workspace.id,
        id: memberId(other.id), userId: other.id, email: other.email, role: 'commenter' };
    await store.create(member);
    await expect(deleteAccount(session(user.id), user.email)).rejects.toThrow('Make someone else an admin of Client team');
    expect(await getUser(user.id)).toBeTruthy();
    expect(await getWorkspace(context.workspace.id)).toEqual(context.workspace);
    expect(await getMember(workspace.id, user.id)).toBeTruthy();
    const project = await createProject(context, { name: 'Personal project', urls: ['https://example.com'] });
    const empty = await createWorkspace(user, 'Empty');
    // Every workspace that needs a handoff comes back in one answer, one per line
    const blocked = await deleteAccount(session(user.id), user.email).catch((error: Error) => error.message);
    expect(String(blocked).split('\n').sort()).toEqual([
        'Make someone else an admin of Client team before deleting your account.',
        `Transfer or delete the projects in ${context.workspace.name}, or add another admin.`
    ]);
    expect(await findProject(project.id)).toBeTruthy();
    expect(await store.get(user.pk, 'account-deletion')).toBeNull();
    // The workspace that could have closed is released again
    expect(await getWorkspace(empty.id)).toEqual(empty);
});

test('deletion retires credentials and personal records while preserving shared projects and other accounts', async () => {
    const user = await findOrCreateUser(uniqueEmail('departing'));
    const other = await findOrCreateUser(uniqueEmail('staying'));
    const context = (await loadAppContext(user))!;
    const store = getAppStore();
    const shared = context.workspace;
    await store.create<DbMember>({ ...context.member, id: memberId(other.id), userId: other.id, email: other.email });
    const personal = await createWorkspace(user, 'Private');
    const project = await createProject(context, { name: 'Shared', urls: ['https://example.com'] });
    const { token } = await createMcpCredential(context, { name: 'Reader', projectIds: [project.id], scopes: ['feedback:read'], days: 7 });
    const mcpRequest = new Request(origin, { headers: { Authorization: `Bearer ${token}` } });
    expect((await authenticateMcp(mcpRequest)).user.id).toBe(user.id);
    const oldSession = sessionToken(user.id).token;
    const review = await exchangeReviewCode(project, await issueReviewCode(user.id, project.id));
    const reviewRequest = new Request(origin, { headers: { Authorization: `Bearer ${review!.token}` } });
    expect(await resolveActor(reviewRequest, project)).toMatchObject({ kind: 'member', userId: user.id });
    const extension = await createExtensionSession(user.id, extensionClient);
    const extensionRequest = new Request(origin, { headers: { Authorization: `Bearer ${extension.token}` } });
    expect((await extensionSession(extensionRequest)).userId).toBe(user.id);
    const google = user.id, microsoft = 'a'.repeat(64);
    await linkGoogleAccount(user.id, { sub: google, email: user.email });
    await linkMicrosoftAccount(user.id, { subject: microsoft, email: user.email });
    const read = { type: 'review-read', pk: 'reads-' + user.id, id: 'thread', reviewerId: userPk(user.id) };
    const kept = { ...read, pk: 'reads-' + other.id, reviewerId: userPk(other.id) };
    await store.create(read);
    await store.create(kept);
    await store.create({ type: 'passkey-credential', pk: 'passkey:' + user.id, id: 'lookup', userId: user.id });
    await deleteAccount(session(user.id), user.email.toUpperCase());
    expect(await sessionUser(oldSession)).toBeNull();
    await expect(authenticateMcp(mcpRequest)).rejects.toThrow();
    await expect(extensionSession(extensionRequest)).rejects.toThrow();
    expect(await resolveActor(reviewRequest, project)).toEqual({ kind: 'anonymous' });
    expect((await POST(request(user.id, user.email, `${cookieName(cookieNames.session)}=${oldSession}`))).status).toBe(401);
    expect(await getMember(shared.id, user.id)).toBeNull();
    expect(await getMember(PUBLIC_WORKSPACE_ID, user.id)).toBeNull();
    expect(await getMember(shared.id, other.id)).toBeTruthy();
    expect(await findProject(project.id)).toMatchObject({ workspaceId: shared.id });
    expect(await store.partitionIds(personal.pk)).toEqual([]);
    expect(await store.get(read.pk, read.id)).toBeNull();
    expect(await store.get(kept.pk, kept.id)).toBeTruthy();
    expect(await findUserByGoogleSubject(google)).toBeNull();
    expect(await findUserByMicrosoftSubject(microsoft)).toBeNull();
    expect(await store.get('passkey:' + user.id, 'lookup')).toBeNull();
    expect(await store.get(emailPk(user.email), user.email)).toBeNull();
    expect(await store.partitionIds(user.pk)).toEqual(['account-deletion']);
    const replacement = await findOrCreateUser(user.email);
    expect(replacement.id).not.toBe(user.id);
    expect(await getMember(shared.id, replacement.id)).toBeNull();
    await linkGoogleAccount(replacement.id, { sub: google, email: replacement.email });
    await store.create(read); // An acknowledgement that was already in flight at commit.
    const receipt = (await store.get<AccountDeletion>(user.pk, 'account-deletion'))!;
    await store.replace({ ...receipt.doc, requestedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }, receipt.etag);
    expect((await sweepAccountDeletions()).failed).toBe(0);
    expect(await store.get(read.pk, read.id)).toBeNull();
    expect(await store.partitionIds(user.pk)).toEqual([]);
    expect((await findUserByGoogleSubject(google))?.id).toBe(replacement.id);
    expect((await findOrCreateUser(user.email)).id).toBe(replacement.id);
});

test('a failed cleanup can resume after the user and their session are gone', async () => {
    const user = await findOrCreateUser(uniqueEmail('retry'));
    const context = (await loadAppContext(user))!;
    const store = getAppStore();
    const team = await createWorkspace(user, 'Team');
    const other = await findOrCreateUser(uniqueEmail('retry-admin'));
    await store.create<DbMember>({ ...context.member, pk: team.pk, workspaceId: team.id, id: memberId(other.id), userId: other.id, email: other.email });
    const interrupted: AppStore = { ...store, async partitionIds() { throw new Error('Interrupted cleanup'); } };
    await deleteAccount(session(user.id), user.email, interrupted);
    expect(await getUser(user.id)).toBeNull();
    // The shared workspace is released with the membership, before the cleanup that failed
    expect(await getMember(team.id, user.id)).toBeNull();
    expect((await getWorkspace(team.id))?.accountDeletion).toBeUndefined();
    await expect(findOrCreateUser(user.email)).rejects.toThrow('Account deletion is in progress.');
    expect((await store.get(user.pk, 'account-deletion'))?.doc).toMatchObject({ status: 'committed' });
    expect((await sweepAccountDeletions()).failed).toBe(0);
    expect(await store.get(emailPk(user.email), user.email)).toBeNull();
    expect(await store.get(workspacePk(context.workspace.id), context.workspace.id)).toBeNull();
    expect((await store.get(user.pk, 'account-deletion'))?.doc).toMatchObject({ status: 'complete' });
});

test('concurrent deletions cannot leave a project without an admin', async () => {
    const first = await findOrCreateUser(uniqueEmail('first-admin'));
    const second = await findOrCreateUser(uniqueEmail('second-admin'));
    const context = (await loadAppContext(first))!;
    const project = await createProject(context, { name: 'Shared project', urls: ['https://shared.example'] });
    await getAppStore().create<DbMember>({ ...context.member, id: memberId(second.id), userId: second.id, email: second.email });
    const outcomes = await Promise.allSettled([first, second].map(user => deleteAccount(session(user.id), user.email)));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [survivor] = await getAppStore().query<DbMember>({ type: 'member', pk: context.workspace.pk, where: { role: 'admin' } });
    expect(await getUser(survivor!.userId)).toBeTruthy();
    expect(await findProject(project.id)).toBeTruthy();
});

test('a workspace held by an account deletion takes no new project, from the app or the extension', async () => {
    const user = await findOrCreateUser(uniqueEmail('held-workspace'));
    const context = (await loadAppContext(user))!;
    const store = getAppStore(), pk = context.workspace.pk;
    // A deletion that reserved the workspace and has not committed yet
    const job: AccountDeletion = { type: 'account-deletion', id: 'account-deletion', pk: userPk(user.id), userId: user.id, attempt: 'held',
        requestedAt: new Date().toISOString(), status: 'preparing', workspaceIds: [context.workspace.id], closedWorkspaceIds: [], ttl: -1 };
    expect(await store.create(job)).toBe(true);
    const workspace = (await store.get<DbWorkspace>(pk, context.workspace.id))!;
    expect(await store.replace({ ...workspace.doc, accountDeletion: { userId: user.id, attempt: job.attempt } }, workspace.etag)).toBe('ok');

    const site = { name: 'Held site', urls: ['https://held.example'] };
    const projects = async () => (await store.query({ type: 'project', pk })).map(project => project.id);
    const before = await projects();
    await expect(createProject(context, site)).rejects.toThrow('Workspace access is changing. Try again shortly.');
    // The extension's popup creates through a receipt, so the same request can be sent again
    const receipt = await reserveProjectCreation(context, site, randomBytes(32).toString('base64url'), siteProjectsLimit(user.id));
    await expect(createProject(context, site, { receipt })).rejects.toThrow('Workspace access is changing. Try again shortly.');
    expect(await projects()).toEqual(before);
    expect(await store.query({ type: 'project-created', pk })).toHaveLength(0);

    // The deletion did not go through: the same request creates its one project
    const current = (await store.get<AccountDeletion>(job.pk, job.id))!;
    expect(await store.replace({ ...current.doc, status: 'cancelled' }, current.etag)).toBe('ok');
    expect(await createProject(context, site, { receipt })).toMatchObject({ id: receipt.projectId, name: 'Held site' });
    expect(await createProject(context, site, { receipt })).toMatchObject({ id: receipt.projectId });
    expect((await projects()).filter(id => !before.includes(id))).toEqual([receipt.projectId]);

    // A workspace that closed meanwhile takes none either
    const closing = await createWorkspace(user, 'Closing');
    const late = await reserveProjectCreation({ user, workspace: closing }, site, randomBytes(32).toString('base64url'), siteProjectsLimit(user.id));
    await store.delete(closing.pk, closing.id);
    await expect(createProject({ user, workspace: closing }, site, { receipt: late })).rejects.toThrow('This workspace is unavailable or your access changed.');
    expect(await store.query({ type: 'project', pk: closing.pk })).toHaveLength(0);
});

test('a transfer that was finishing when its old workspace closed settles without it', async () => {
    const user = await findOrCreateUser(uniqueEmail('transfer-then-delete'));
    const other = await findOrCreateUser(uniqueEmail('agency-admin'));
    const context = (await loadAppContext(user))!;
    const store = getAppStore();
    const target = await createWorkspace(user, 'Agency');
    await store.create<DbMember>({ ...context.member, pk: target.pk, workspaceId: target.id, id: memberId(other.id), userId: other.id, email: other.email });
    const project = await createProject(context, { name: 'Moving site', urls: ['https://moving.example'] });
    // Interrupted after the old copy went, before the transfer was marked complete
    const interrupted: AppStore = { ...store, async replace(doc, etag) {
        if (doc.type === 'project-transfer' && 'complete' in doc && doc.complete) throw new Error('Store unavailable');
        return store.replace(doc, etag);
    } };
    await expect(transferProject(context, project.id, target.id, project.name, interrupted)).rejects.toThrow('Store unavailable');
    expect(await store.get(context.workspace.pk, project.id)).toBeNull();
    await deleteAccount(session(user.id), user.email);
    expect(await getWorkspace(context.workspace.id)).toBeNull();
    expect(await sweepProjectTransfers()).toEqual({ failed: 0 });
    expect((await store.get<ProjectTransfer>('project-transfer', project.id))?.doc.complete).toBe(true);
    expect((await getProject(target.id, project.id))?.transfer).toBeUndefined();
});

test('one notice goes to the deleted address, and the next run sends one that failed', async () => {
    const store = getAppStore();
    const sent: EmailMessage[] = [];
    const notify = async (message: EmailMessage) => { sent.push(message); };
    const unavailable = async () => { throw new Error('Provider unavailable'); };
    const user = await findOrCreateUser(uniqueEmail('noticed'));
    await loadAppContext(user);
    await deleteAccount(session(user.id), user.email, store, notify);
    const notice = sent.find(message => message.to === user.email)!;
    expect(notice.subject).toBe('Your uier account was deleted');
    for (const body of [notice.text, notice.html]) {
        expect(body).toContain(`The uier account for ${user.email} was deleted on `);
        expect(body).toContain(`If you did not delete your account, write to ${brand.contact.privacy}.`);
        expect(body).not.toContain('If the button does not work');
    }
    const receipt = (await store.get<AccountDeletion>(user.pk, 'account-deletion'))!.doc;
    expect(receipt.status).toBe('complete');
    expect(receipt.email).toBeUndefined();

    // The provider fails: the account is gone and its address is free, and the request keeps the address
    const later = await findOrCreateUser(uniqueEmail('notice-later'));
    await loadAppContext(later);
    await deleteAccount(session(later.id), later.email, store, unavailable);
    expect(await getUser(later.id)).toBeNull();
    expect(await store.get(emailPk(later.email), later.email)).toBeNull();
    const pending = (await store.get<AccountDeletion>(later.pk, 'account-deletion'))!.doc;
    expect(pending).toMatchObject({ status: 'committed', email: later.email });
    expect(pending.noticeAt).toBeUndefined();
    expect((await sweepAccountDeletions(store, notify)).failed).toBe(0);
    expect((await sweepAccountDeletions(store, notify)).failed).toBe(0);
    expect(sent.filter(message => message.to === later.email)).toHaveLength(1);
    expect(sent.filter(message => message.to === user.email)).toHaveLength(1);
    expect((await store.get<AccountDeletion>(later.pk, 'account-deletion'))!.doc.status).toBe('complete');

    // A notice that cannot be sent for an hour is given up, with its address
    const never = await findOrCreateUser(uniqueEmail('notice-never'));
    await loadAppContext(never);
    await deleteAccount(session(never.id), never.email, store, unavailable);
    const waiting = (await store.get<AccountDeletion>(never.pk, 'account-deletion'))!;
    await store.replace({ ...waiting.doc, requestedAt: new Date(Date.now() - 61 * 60_000).toISOString() }, waiting.etag);
    expect((await sweepAccountDeletions(store, unavailable)).failed).toBe(0);
    const given = (await store.get<AccountDeletion>(never.pk, 'account-deletion'))!.doc;
    expect(given.status).toBe('complete');
    expect(given.email).toBeUndefined();
});

test('the notice of a deletion is signed for the account the browser continues as', async () => {
    const user = await findOrCreateUser(uniqueEmail('notice-link'));
    const kept = await findOrCreateUser(uniqueEmail('notice-kept'));
    const cookies = `${cookieName(cookieNames.session)}=${sessionToken(user.id).token}; ${cookieName(cookieNames.account1)}=${sessionToken(kept.id).token}`;
    const response = await POST(request(user.id, user.email, cookies));
    const next = new URL((await response.json() as { next: string }).next, origin);
    expect(next.pathname).toBe('/app/account');
    const notice = next.searchParams.get('deleted');
    expect(isAccountDeletedNotice(notice, kept.id)).toBe(true);
    // Not for another account, a signed-out browser or a link someone wrote
    for (const [value, continuesAs] of [[notice, user.id], [notice, null], ['1', kept.id], [`${notice}x`, kept.id], [accountDeletedNotice(null), kept.id]] as const)
        expect(isAccountDeletedNotice(value, continuesAs)).toBe(false);
    expect(isAccountDeletedNotice(accountDeletedNotice(null), null)).toBe(true);
});
