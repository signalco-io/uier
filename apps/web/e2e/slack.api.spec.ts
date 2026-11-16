import type { FeedbackContext } from '@uier/toolbar/feedback-context';
import { setIntegrationReplySync } from '../src/lib/integrations/connection';
import { createHmac, randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { memberId, projectRefPk, userPk, workspacePk, type DbMember, type DbProject, type DbProjectRef, type DbUser, type DbWorkspace } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import { recordingUploadDocumentId, screenshotDocumentId, type DbComment, type DbCommentRecording, type DbScreenshot } from '../src/lib/db/schema';
import { getRecordingBlobs, recordingNames } from '../src/lib/recordings/blobStore';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import { discoverThreadIntegrationSync, enqueueIntegrationSync, integrationPk, integrationSyncId } from '../src/lib/integrations/discovery';
import { startIntegrationBackfill, queueIntegrationBackfills } from '../src/lib/integrations/backfill';
import { syncPendingKey } from '../src/lib/integrations/syncSignal';
import type { IntegrationSync } from '../src/lib/integrations/model';
import { slackAdapter, beginSlackConnect, finishSlackConnect, getSlackSettings, loadSlackChannels, saveSlackDestination,
    disconnectSlack, setSlackEnabled, setSlackFiles, resumeSlackNotification, resolveSlackUncertainPost, sendSlackTestNotification,
    clearSlackRateReview, listSlackRateReviews } from '../src/lib/integrations/slack';
import { currentSlackGrant, rawSlackConnection, recoverSlackSetups, slackAccessToken, invalidateSlackGrant } from '../src/lib/integrations/slack/connection';
import { SlackApiError, slackRequest } from '../src/lib/integrations/slack/client';
import { slackRatePk, type SlackRateBucket } from '../src/lib/integrations/slack/rate';
import { slackChangeSummary, slackReplyMessage, slackRootMessage } from '../src/lib/integrations/slack/message';
import { loadSlackI18n } from '../src/lib/integrations/slack/i18n';
import { loadAppCatalog } from '../src/lib/i18n/catalog';
import { createAppI18n } from '../src/lib/i18n/translate';
import { toolbarLanguages } from '@uier/toolbar/languages';
import type { SlackConnection, SlackGrant, SlackInstallationOwner, SlackState } from '../src/lib/integrations/slack/model';
import { receiveSlackEvent } from '../src/lib/integrations/slack/events';
import { findSlackThread } from '../src/lib/integrations/slack/threads';
import { deliverThreadNow } from '../src/lib/integrations/deliverNow';
import { startSlackStub, type SlackStub } from './support/slackStub';

const test = base.extend<{ slack: SlackStub }>({ slack: async ({}, use) => {
    process.env.UIER_LOCAL = '1'; const stub = await startSlackStub();
    Object.assign(process.env, { SLACK_CLIENT_ID: 'slack-test-client', SLACK_CLIENT_SECRET: 'slack-test-secret', SLACK_APP_ID: stub.appId,
        SLACK_TOKEN_KEY: Buffer.alloc(32, 23).toString('base64'), SLACK_TOKEN_KEY_ID: 'k1',
        SLACK_API_BASE_URL: `${stub.url}/api/`, SLACK_OAUTH_AUTHORIZE_URL: `${stub.url}/oauth/authorize` });
    try { await use(stub); } finally { await stub.close(); }
} });
const old = '2026-01-01T00:00:00.000Z'; const baseUrl = 'https://uier.io';
async function fixture(workspace?: { id: string; owner: Awaited<ReturnType<typeof findOrCreateUser>> }) {
    const id = randomUUID().replaceAll('-', '').slice(0, 12);
    const owner = workspace?.owner ?? await findOrCreateUser(`slack-${id}@example.com`); const workspaceId = workspace?.id ?? `w_${owner.id}`;
    const store = getAppStore(); const comments = getCommentsStore();
    const project: DbProject = { type: 'project', id, pk: workspacePk(workspaceId), workspaceId, name: `Slack project ${id}`,
        urls: ['https://reviewed.example'], status: 'active', access: 'invited', createdBy: owner.id, createdAt: old, updatedAt: old };
    await store.create(project); await store.create<DbProjectRef>({ type: 'project-ref', id, pk: projectRefPk(id), workspaceId });
    await store.create<DbMember>({ type: 'member', id: memberId(owner.id), pk: project.pk, workspaceId, userId: owner.id, email: owner.email, role: 'admin', projects: 'all', createdAt: old });
    const source: DbComment = { id: `comment_${id}`, domain: `project:${id}`, projectId: id, syncVersion: 1, syncPending: true,
        syncKey: syncPendingKey(`project:${id}`, `comment_${id}`), path: '/pricing', origin: 'https://reviewed.example', kind: 'bug', position: { type: 'page' },
        createdAt: old, updatedAt: old, authorId: `user:${owner.id}`, thread: { items: [{ id: `item_${id}`, text: 'Save does not respond', authorId: `user:${owner.id}`, createdAt: old }] } };
    await comments.create(source); return { store, comments, project, owner, source };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fresh(f: Fixture) { f.project = (await f.store.get<DbProject>(f.project.pk, f.project.id))!.doc; return f.project; }
async function source(f: Fixture) { return (await f.comments.get(f.source.domain, f.source.id))!.comment; }
async function change(f: Fixture, patch: Partial<DbComment>) {
    const stored = (await f.comments.get(f.source.domain, f.source.id))!;
    const next = { ...stored.comment, ...patch, syncVersion: stored.comment.syncVersion! + 1, syncPending: true };
    expect(await f.comments.replace(next, stored.etag)).toBe('ok'); return next;
}
async function authorize(f: Fixture, slack: SlackStub, options: Parameters<SlackStub['code']>[0] = {}) {
    const url = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    if (url.pathname.includes('/oauth/')) return finishSlackConnect({ userId: f.owner.id, state: url.searchParams.get('state'), code: slack.code(options), baseUrl }, f.store);
    return { status: 'connected' as const };
}
async function connect(f: Fixture, slack: SlackStub, summaries = false) {
    expect((await authorize(f, slack)).status).toBe('connected');
    await saveSlackDestination(await fresh(f), f.owner.id, { channelId: slack.channelId, statusSummaries: summaries, replySummaries: summaries });
    await fresh(f); return (await rawSlackConnection(f.project))!;
}
async function newThread(f: Fixture) {
    const value = await source(f); const createdAt = new Date(Date.now() + 10).toISOString();
    await change(f, { createdAt, thread: { items: [{ ...value.thread.items[0]!, createdAt }] } });
}
async function ledger(f: Fixture) {
    const connection = (await rawSlackConnection(await fresh(f)))!;
    return (await f.store.get<IntegrationSync>(integrationPk('slack', f.project.id), integrationSyncId('slack', connection.id, f.project.id, f.source.id)))!.doc;
}
async function dispatch(f: Fixture, options: Parameters<typeof processIntegrationDelivery>[3] = {}) {
    await discoverThreadIntegrationSync(await fresh(f), await source(f), { adapters: [slackAdapter] });
    await processIntegrationDelivery(await ledger(f), baseUrl, slackAdapter, options); return ledger(f);
}
async function retry(f: Fixture, options: Parameters<typeof processIntegrationDelivery>[3] = {}) {
    const value = await ledger(f);
    await updateDoc<IntegrationSync>(value.pk, value.id, row => ({ ...row, active: true, status: 'queued', nextAttemptAt: old }));
    await processIntegrationDelivery(value, baseUrl, slackAdapter, options); return ledger(f);
}
function state(value: IntegrationSync) { return value.state as SlackState; }
const fileScopes = 'chat:write,channels:read,groups:read,files:write';
/** The explicit reconnect for file uploads, then the setting itself */
async function allowFiles(f: Fixture, slack: SlackStub, scopes = fileScopes, options: { requestReplies?: boolean } = {}) {
    const upgrade = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl, requestFiles: true, ...options }));
    expect(upgrade.searchParams.get('scope')).toBe(scopes); expect(upgrade.searchParams.has('user_scope')).toBe(false);
    expect((await finishSlackConnect({ userId: f.owner.id, state: upgrade.searchParams.get('state'), baseUrl, code: slack.code({ scopes }) })).status).toBe('connected');
    await setSlackFiles(await fresh(f), f.owner.id, true); await fresh(f);
}
/** A stored image for the thread or one of its replies; returns what the comment records about it */
async function saveScreenshot(f: Fixture, bytes: Buffer, revision: string, itemId?: string) {
    const metadata = { contentType: 'image/webp' as const, width: 2, height: 1, bytes: bytes.length, revision };
    const image: DbScreenshot = { type: 'screenshot', id: screenshotDocumentId(f.source.id, itemId), domain: f.source.domain, commentId: f.source.id,
        ...(itemId ? { itemId } : {}), ...metadata, data: bytes.toString('base64'), createdAt: old };
    await f.comments.deleteScreenshot(f.source.domain, f.source.id, undefined, itemId); await f.comments.createScreenshot(image);
    return metadata;
}
async function saveRecording(f: Fixture, bytes: Buffer, itemId?: string): Promise<DbCommentRecording> {
    const id = `recording_${randomUUID()}`;
    const metadata: DbCommentRecording = { id, contentType: 'video/mp4', size: bytes.length, duration: 3, width: 640, height: 360 };
    await f.comments.createRecordingUpload({ id: recordingUploadDocumentId(id), domain: f.source.domain, type: 'recording-upload', recordingId: id,
        authorId: `user:${f.owner.id}`, createdAt: old, expiresAt: old, ttl: -1, expectedSize: bytes.length, contentType: 'video/mp4', metadata,
        attached: { commentId: f.source.id, ...(itemId ? { itemId } : {}) } });
    await getRecordingBlobs().put(recordingNames(f.source.domain, id).video, bytes, 'video/mp4');
    return metadata;
}
/** Files people can see in Slack. An upload that was never completed is discarded there. */
const liveFiles = (slack: SlackStub) => [...slack.files.values()].filter(file => file.completed && !file.deleted);

test('Slack OAuth is single-use, bot-only, rotating, encrypted and off until a channel is explicitly selected', async ({ slack }) => {
    const f = await fixture();
    const url = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    expect(url.searchParams.get('scope')).toBe('chat:write,channels:read,groups:read'); expect(url.searchParams.has('user_scope')).toBe(false);
    expect(url.searchParams.get('state')).not.toContain(f.owner.id);
    const input = { userId: f.owner.id, state: url.searchParams.get('state'), code: slack.code(), baseUrl };
    expect((await finishSlackConnect(input)).status).toBe('connected'); await expect(finishSlackConnect(input)).rejects.toThrow();
    expect((await fresh(f)).integrations?.slack).toBeUndefined();
    const connection = (await rawSlackConnection(f.project))!; expect(connection.enabled).toBe(false);
    const grant = await currentSlackGrant(connection); expect(JSON.stringify(grant)).not.toMatch(/xoxb-test|xoxe-test/);
    expect((await getSlackSettings(f.project, f.owner.id)).connection).not.toHaveProperty('grantId');
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(0);
});

test('OAuth rejects foreign users, denied replays, wrong apps, missing scopes, user tokens, Enterprise and non-rotating installs', async ({ slack }) => {
    for (const options of [{ appId: 'AOTHER' }, { scopes: 'chat:write' }, { enterprise: true }, { rotation: false }, { userToken: true }]) {
        const f = await fixture(); expect((await authorize(f, slack, options)).status).toBe('failed');
        expect(await rawSlackConnection(await fresh(f))).toBeNull();
    }
    const f = await fixture();
    const url = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl }));
    await expect(finishSlackConnect({ userId: 'foreign-user', state: url.searchParams.get('state'), error: 'access_denied', baseUrl })).rejects.toThrow();
    expect((await finishSlackConnect({ userId: f.owner.id, state: url.searchParams.get('state'), error: 'access_denied', baseUrl })).status).toBe('denied');
    await expect(finishSlackConnect({ userId: f.owner.id, state: url.searchParams.get('state'), code: slack.code(), baseUrl })).rejects.toThrow();
});

test('installation ownership rejects a different uier workspace without revoking the active installation', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack);
    const other = await fixture(); expect((await authorize(other, slack)).status).toBe('failed');
    expect(await rawSlackConnection(await fresh(other))).toBeNull();
    expect(await slackAccessToken(connection)).toMatch(/^xoxb-test-/);
    expect(slack.calls.some(call => /revoke|uninstall/.test(call.method))).toBe(false);
});

test('OAuth storage failures release only never-committed reservations and finalize or wipe the exact partial generation', async ({ slack }) => {
    for (const phase of ['claim_before', 'claim_after', 'grant_before', 'grant_after', 'attach_before', 'attach_after'] as const) {
        const f = await fixture(); const teamId = `T${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        const original = f.store.create.bind(f.store); let failed = false;
        f.store.create = async doc => {
            const target = phase.startsWith('claim') ? 'slack-installation-owner' : phase.startsWith('grant') ? 'slack-grant' : 'slack-connection';
            if (!failed && doc.type === target) {
                failed = true;
                if (phase.endsWith('after')) await original(doc);
                throw new Error('Injected storage response loss');
            }
            return original(doc);
        };
        const before = slack.oauthCalls;
        try { expect((await authorize(f, slack, { teamId })).status, phase).toBe('failed'); }
        finally { f.store.create = original; }
        expect(failed).toBe(true); expect(slack.oauthCalls).toBe(before + 1);
        const owners = await f.store.query<SlackInstallationOwner>({ type: 'slack-installation-owner', where: { teamId } });
        const grants = await f.store.query<SlackGrant>({ type: 'slack-grant', pk: f.project.pk });
        if (phase === 'claim_before') { expect(owners).toHaveLength(0); expect(grants).toHaveLength(0); }
        else if (phase === 'claim_after' || phase === 'grant_before') {
            expect(owners[0]?.status).toBe('released'); expect(owners[0]?.generation).toBe(0); expect(grants).toHaveLength(0);
            const other = await fixture(); expect((await authorize(other, slack, { teamId })).status).toBe('connected');
        } else if (phase === 'attach_after') {
            expect(owners[0]?.status).toBe('active'); expect(grants[0]?.tokens).toBeDefined(); expect(grants[0]?.setupPending).toBeUndefined();
            expect((await rawSlackConnection(await fresh(f)))?.status).toBe('connected');
        } else {
            expect(owners[0]?.status).toBe('disconnected'); expect(owners[0]?.everCommitted).toBe(true);
            expect(grants[0]?.tokens).toBeUndefined(); expect(grants[0]?.setupPending).toBeUndefined();
            const other = await fixture(); expect((await authorize(other, slack, { teamId })).status).toBe('failed');
        }
    }
});

test('admin removal after grant persistence erases the new setup pair and retains the committed ownership receipt', async ({ slack }) => {
    const f = await fixture(); const original = f.store.create.bind(f.store); let removed = false;
    f.store.create = async doc => {
        const created = await original(doc);
        if (created && doc.type === 'slack-grant' && !removed) {
            removed = true; await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), current => ({ ...current, role: 'commenter' }));
        }
        return created;
    };
    try { expect((await authorize(f, slack)).status).toBe('failed'); } finally { f.store.create = original; }
    const grants = await f.store.query<SlackGrant>({ type: 'slack-grant', pk: f.project.pk });
    expect(grants[0]?.tokens).toBeUndefined(); expect(await rawSlackConnection(await fresh(f))).toBeNull();
    const owners = await f.store.query<SlackInstallationOwner>({ type: 'slack-installation-owner', where: { teamId: slack.teamId } });
    expect(owners[0]?.status).toBe('disconnected'); expect(owners[0]?.everCommitted).toBe(true);
});

test('a failed new project attachment preserves the replacement grant used by an authorized sibling', async ({ slack }) => {
    const f = await fixture(); const working = await connect(f, slack); const prior = await currentSlackGrant(working);
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner });
    await sibling.store.create<SlackConnection>({ ...working, id: `slack_${sibling.project.id}`, projectId: sibling.project.id,
        enabled: false, status: 'needs_reconnect', createdAt: old, updatedAt: old });
    const original = sibling.store.replace.bind(sibling.store); let failed = false;
    sibling.store.replace = async (doc, etag) => {
        if (!failed && doc.type === 'slack-connection' && doc.id === `slack_${sibling.project.id}`) { failed = true; throw new Error('Attach failed'); }
        return original(doc, etag);
    };
    try { expect((await authorize(sibling, slack)).status).toBe('failed'); } finally { sibling.store.replace = original; }
    const retained = await currentSlackGrant(working); expect(retained.generation).toBe(prior.generation + 1);
    expect(retained.tokens).toBeDefined(); expect(retained.setupPending).toBeUndefined();
    expect(await slackAccessToken(working)).toMatch(/^xoxb-test-/);
    await newThread(f); expect((await dispatch(f)).status).toBe('accepted');
});

test('an interrupted rollback is recovered from pending metadata without another OAuth or provider call', async ({ slack }) => {
    const f = await fixture(); const create = f.store.create.bind(f.store); const replace = f.store.replace.bind(f.store);
    f.store.create = async doc => { if (doc.type === 'slack-connection') throw new Error('Attach storage unavailable'); return create(doc); };
    f.store.replace = async (doc, etag) => {
        if (doc.type === 'slack-grant' && (doc as unknown as SlackGrant).status === 'needs_reconnect') throw new Error('Rollback storage unavailable');
        return replace(doc, etag);
    };
    try { await expect(authorize(f, slack)).rejects.toThrow(); }
    finally { f.store.create = create; f.store.replace = replace; }
    let grant = (await f.store.query<SlackGrant>({ type: 'slack-grant', pk: f.project.pk }))[0]!;
    expect(grant.setupPending).toBe(true); expect(grant.tokens).toBeDefined();
    const calls = slack.calls.length; const exchanges = slack.oauthCalls;
    await recoverSlackSetups({ workspaceId: f.project.workspaceId });
    grant = (await f.store.get<SlackGrant>(grant.pk, grant.id))!.doc;
    expect(grant.tokens).toBeUndefined(); expect(grant.setupPending).toBeUndefined();
    expect(slack.calls).toHaveLength(calls); expect(slack.oauthCalls).toBe(exchanges);
});

test('a failed reconnect never releases the historical disconnected ownership receipt', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await disconnectSlack(await fresh(f), f.owner.id);
    const original = f.store.replace.bind(f.store); let failed = false;
    f.store.replace = async (doc, etag) => {
        if (!failed && doc.type === 'slack-grant') { failed = true; throw new Error('Reconnect persistence unavailable'); }
        return original(doc, etag);
    };
    try { expect((await authorize(f, slack)).status).toBe('failed'); } finally { f.store.replace = original; }
    const owners = await f.store.query<SlackInstallationOwner>({ type: 'slack-installation-owner', where: { teamId: slack.teamId } });
    expect(owners[0]?.status).toBe('disconnected'); expect(owners[0]?.generation).toBeGreaterThan(0);
    const other = await fixture(); expect((await authorize(other, slack)).status).toBe('failed');
});

test('late setup failure cannot wipe a newer generation or release another setup operation lease', async ({ slack }) => {
    const f = await fixture(); const create = f.store.create.bind(f.store); let replaced = false;
    f.store.create = async doc => {
        if (doc.type === 'slack-connection' && !replaced) {
            replaced = true;
            const grant = (await f.store.query<SlackGrant>({ type: 'slack-grant', pk: f.project.pk }))[0]!;
            await updateDoc<SlackGrant>(grant.pk, grant.id, current => ({ ...current, generation: current.generation + 1, setupNonce: 'newer-setup', setupPending: true }));
            const owner = (await f.store.query<SlackInstallationOwner>({ type: 'slack-installation-owner', where: { teamId: slack.teamId } }))[0]!;
            await updateDoc<SlackInstallationOwner>(owner.pk, owner.id, current => ({ ...current, generation: grant.generation + 1,
                operationLease: { id: 'newer-setup-lease', until: new Date(Date.now() + 60_000).toISOString() } }));
            throw new Error('Late failed attach response');
        }
        return create(doc);
    };
    try { expect((await authorize(f, slack)).status).toBe('failed'); } finally { f.store.create = create; }
    const grant = (await f.store.query<SlackGrant>({ type: 'slack-grant', pk: f.project.pk }))[0]!;
    const owner = (await f.store.query<SlackInstallationOwner>({ type: 'slack-installation-owner', where: { teamId: slack.teamId } }))[0]!;
    expect(grant.generation).toBe(2); expect(grant.tokens).toBeDefined(); expect(grant.setupNonce).toBe('newer-setup');
    expect(owner.generation).toBe(2); expect(owner.operationLease?.id).toBe('newer-setup-lease');
});

test('two projects share one rotating grant and a disconnect preserves the sibling binding', async ({ slack }) => {
    const f = await fixture(); const first = await connect(f, slack);
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); const second = await connect(sibling, slack);
    expect(first.grantId).toBe(second.grantId);
    const grant = await currentSlackGrant(first);
    await updateDoc<SlackGrant>(grant.pk, grant.id, row => ({ ...row, tokens: { ...row.tokens!, expiresAt: old } }));
    const results = await Promise.allSettled([slackAccessToken(first), slackAccessToken(second)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true); expect(slack.refreshCalls).toBe(1);
    expect((await currentSlackGrant(second)).generation).toBe(grant.generation + 1);
    await disconnectSlack(await fresh(f), f.owner.id);
    expect(await slackAccessToken(second)).toMatch(/^xoxb-test-/);
    await disconnectSlack(await fresh(sibling), sibling.owner.id);
    expect((await currentSlackGrant(second)).tokens).toBeUndefined();
});

test('channel discovery uses GET, paginates, filters membership and rejects shared or archived channels', async ({ slack }) => {
    const f = await fixture(); await authorize(f, slack);
    const channels = await loadSlackChannels(await fresh(f), f.owner.id);
    expect(channels.items.map(item => item.id).sort()).toEqual([slack.channelId, slack.secondChannelId, slack.privateChannelId].sort());
    expect(slack.calls.filter(call => call.method === 'conversations.list')).toHaveLength(3);
    expect(slack.calls.filter(call => /conversations/.test(call.method)).every(call => call.verb === 'GET')).toBe(true);
    for (const channelId of ['CUNINVITED', 'CSHARED', 'CARCHIVED']) await expect(saveSlackDestination(await fresh(f), f.owner.id, { channelId })).rejects.toThrow();
    await saveSlackDestination(await fresh(f), f.owner.id, { channelId: slack.privateChannelId });
    expect((await getSlackSettings(await fresh(f), f.owner.id)).connection?.channelName).toBe('private-feedback');
    expect(slack.messages.size).toBe(0);
});

test('a saved channel that becomes shared blocks new feedback and generic test sends before a post body leaves', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f);
    slack.channels.get(slack.channelId)!.is_shared = true;
    const row = await dispatch(f);
    expect(row.status).toBe('ambiguous'); expect(row.lastCode).toBe('channel_ineligible'); expect(row.attempt).toBeUndefined();
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(0); expect(slack.messages.size).toBe(0);
    await expect(sendSlackTestNotification(await fresh(f), f.owner.id)).rejects.toThrow();
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(0);
    expect(await f.store.query({ type: 'slack-test', pk: f.project.pk, where: { status: 'blocked' } })).toHaveLength(1);
});

test('a newly shared channel blocks edits while privacy cleanup still deletes its previously known message', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); const prior = await dispatch(f);
    const root = state(prior).root!; slack.channels.get(slack.channelId)!.is_ext_shared = true;
    const current = await source(f);
    await change(f, { thread: { items: [{ ...current.thread.items[0]!, text: 'This edit must stay in uier' }] } });
    const blocked = await dispatch(f);
    expect(blocked.status).toBe('ambiguous'); expect(blocked.lastCode).toBe('channel_ineligible');
    expect(slack.calls.filter(call => call.method === 'chat.update')).toHaveLength(0);
    expect(slack.messages.get(`${root.channelId}:${root.ts}`)!.payload.text).not.toContain('This edit must stay in uier');
    await change(f, { private: true }); const infoBefore = slack.calls.filter(call => call.method === 'conversations.info').length;
    const cleaned = await dispatch(f, { exportFeedback: async () => { throw new Error('No private packet'); } });
    expect(cleaned.status).toBe('suppressed'); expect(slack.messages.size).toBe(0);
    expect(slack.calls.filter(call => call.method === 'conversations.info')).toHaveLength(infoBefore);
});

test('channel eligibility is read after pacing and shares the conversations.info cooldown and core request budget', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    const grant = await currentSlackGrant(connection);
    await f.store.create<SlackRateBucket>({ type: 'slack-rate', pk: slackRatePk(grant), id: `channel_${slack.channelId}`, nextAt: Date.now() + 250, pausedUntil: 0 });
    const changed = new Promise<void>(resolve => setTimeout(() => { slack.channels.get(slack.channelId)!.is_org_shared = true; resolve(); }, 40));
    const blocked = await dispatch(f); await changed;
    expect(blocked.lastCode).toBe('channel_ineligible'); expect(slack.messages.size).toBe(0);
    slack.channels.get(slack.channelId)!.is_org_shared = false;
    const other = await fixture({ id: f.project.workspaceId, owner: f.owner }); await connect(other, slack); await newThread(other);
    slack.fault('conversations.info', 'rate', '172800');
    // The next worker information request is rejected before any feedback can be sent.
    const reads = slack.calls.filter(call => call.method === 'conversations.info').length;
    expect((await retry(f)).lastCode).toBe('ratelimited');
    expect(slack.calls.filter(call => call.method === 'conversations.info')).toHaveLength(reads + 1);
    expect((await f.store.get<SlackRateBucket>(slackRatePk(grant), 'method_chat_postMessage'))?.doc.pausedUntil ?? 0).toBe(0);
    expect((await dispatch(other)).lastCode).toBe('rate_wait');
    expect(slack.calls.filter(call => call.method === 'conversations.info')).toHaveLength(reads + 1); expect(slack.messages.size).toBe(0);
});

test('the fresh channel check consumes the shared delivery budget before any feedback operation', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f);
    const reads = slack.calls.filter(call => call.method === 'conversations.info').length;
    const row = await dispatch(f, { maxCalls: 1 });
    expect(row.lastCode).toBe('budget_exhausted'); expect(row.attempt).toBeUndefined();
    expect(slack.calls.filter(call => call.method === 'conversations.info')).toHaveLength(reads + 1);
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(0);
});

test('new shared feedback posts once, edits update the known root and optional summaries coalesce current changes', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack, true); await newThread(f);
    let row = await dispatch(f); expect(row.status).toBe('accepted'); const root = state(row).root!;
    expect(slack.messages.size).toBe(1); expect(root.permalink).toContain('uier-test.slack.com');
    let current = await source(f); await change(f, { thread: { items: [{ ...current.thread.items[0]!, text: 'An edited excerpt' }] } });
    row = await dispatch(f); expect(state(row).root?.ts).toBe(root.ts); expect(slack.messages.size).toBe(1);
    current = await source(f); await change(f, { resolved: true, thread: { items: [...current.thread.items, { id: 'reply-one', text: 'First reply', authorId: `user:${f.owner.id}`, createdAt: new Date().toISOString() }] } });
    row = await dispatch(f); expect(row.status).toBe('accepted'); expect(state(row).notifications).toHaveLength(1);
    expect([...slack.messages.values()].find(message => message.threadTs)?.payload.text).toBe('Status: Done. 1 new reply in uier.');
    await change(f, { resolved: false }); await change(f, { resolved: true }); row = await dispatch(f);
    expect(state(row).notifications).toHaveLength(1);
    current = await source(f); await change(f, { thread: { items: [current.thread.items[0]!, { id: 'reply-two', text: 'Replacement reply', authorId: `user:${f.owner.id}`, createdAt: new Date().toISOString() }] } });
    row = await dispatch(f); expect(state(row).notifications).toHaveLength(2);
});

test('old and undated threads stay silent after edits and channel switches; explicit backfill targets only Slack', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack);
    let row = await dispatch(f); expect(row.lastCode).toBe('historical_baseline'); expect(slack.messages.size).toBe(0);
    await change(f, { resolved: true }); row = await dispatch(f); expect(slack.messages.size).toBe(0);
    await startIntegrationBackfill(await fresh(f), 'slack', f.owner.id);
    await queueIntegrationBackfills('slack', { deadline: Date.now() + 10_000 }); row = await retry(f);
    expect(slack.messages.size).toBe(1); expect(row.status).toBe('accepted');
    await saveSlackDestination(await fresh(f), f.owner.id, { channelId: slack.secondChannelId });
    await change(f, { resolved: false }); row = await dispatch(f);
    expect(state(row).root).toBeUndefined(); expect(state(row).retired).toHaveLength(1); expect(slack.messages.size).toBe(1);
    await startIntegrationBackfill(await fresh(f), 'slack', f.owner.id); await queueIntegrationBackfills('slack', { deadline: Date.now() + 10_000 }); row = await retry(f);
    expect(state(row).root?.channelId).toBe(slack.secondChannelId); expect(slack.messages.size).toBe(2);
    expect((await f.store.query<IntegrationSync>({ type: 'linear-sync', pk: integrationPk('linear', f.project.id) }))).toHaveLength(0);
});

test('privacy deletes every known bot root and summary, preserves human replies and requires explicit single-use resume', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack, true); await newThread(f);
    let row = await dispatch(f); const root = state(row).root!;
    await change(f, { resolved: true }); row = await dispatch(f); expect(state(row).notifications).toHaveLength(1);
    slack.human(slack.channelId, '1700000000.999999');
    await change(f, { private: true });
    row = await dispatch(f, { exportFeedback: async () => { throw new Error('Private feedback must never be exported'); } });
    expect(row.status).toBe('suppressed'); expect(state(row).root).toBeUndefined(); expect(slack.messages.size).toBe(1);
    expect([...slack.messages.values()][0]!.owner).toBe('UHUMAN');
    await expect(resumeSlackNotification(await fresh(f), f.owner.id, f.source.id)).rejects.toThrow();
    await change(f, { private: false }); row = await dispatch(f); expect(state(row).root).toBeUndefined();
    await resumeSlackNotification(await fresh(f), f.owner.id, f.source.id); row = await retry(f);
    expect(state(row).root?.ts).not.toBe(root.ts); expect(state(row).resume?.completed).toBe(true);
    await retry(f); expect(slack.messages.size).toBe(2);
});

test('a lost accepted post stops without history reads or blind replay, and operator adoption keeps the same message', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); slack.fault('chat.postMessage', 'lost');
    let row = await dispatch(f); expect(row.status).toBe('ambiguous'); expect(row.attempt?.step).toBe('post_root'); expect(slack.messages.size).toBe(1);
    const operationId = row.attempt!.operationId; await retry(f); expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
    const remote = [...slack.messages.values()][0]!;
    await resolveSlackUncertainPost(await fresh(f), f.owner.id, f.source.id, { operationId, decision: 'adopt', ts: remote.ts, confirmed: true });
    row = await retry(f); expect(row.status).toBe('accepted'); expect(state(row).root?.ts).toBe(remote.ts); expect(slack.messages.size).toBe(1);
    expect(slack.calls.some(call => /history|replies/.test(call.method))).toBe(false);
});

test('an unreachable retired workspace never blocks privacy cleanup of the reachable current root', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); const row = await dispatch(f);
    await updateDoc<IntegrationSync>(row.pk, row.id, current => ({ ...current, state: { ...current.state,
        retired: [{ ts: '1700000000.777777', channelId: 'COLDCHANNEL', teamId: 'TOLDWORKSPACE' }] } }));
    await change(f, { private: true }); const cleaned = await dispatch(f, { exportFeedback: async () => { throw new Error('No private export'); } });
    expect(cleaned.lastCode).toBe('cleanup_old_workspace'); expect(state(cleaned).root).toBeUndefined();
    expect(cleaned.status).toBe('ambiguous'); expect(state(cleaned).retired).toHaveLength(1); expect(slack.messages.size).toBe(0);
    expect((await rawSlackConnection(await fresh(f)))?.status).toBe('connected');
    const second = { ...await source(f), id: `comment_${randomUUID()}`, private: false, syncVersion: 1 };
    second.syncKey = syncPendingKey(second.domain, second.id); await f.comments.create(second); f.source = second;
    await newThread(f); expect((await dispatch(f)).status).toBe('accepted'); expect(slack.messages.size).toBe(1);
});

test('only explicit confirmed absence can authorize a replacement for an uncertain post', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); slack.fault('chat.postMessage', 'internal');
    let row = await dispatch(f); expect(row.status).toBe('ambiguous'); const operationId = row.attempt!.operationId;
    await expect(resolveSlackUncertainPost(await fresh(f), f.owner.id, f.source.id, { operationId, decision: 'absent', confirmed: false })).rejects.toThrow();
    await resolveSlackUncertainPost(await fresh(f), f.owner.id, f.source.id, { operationId, decision: 'absent', confirmed: true });
    row = await retry(f); expect(row.status).toBe('accepted'); expect(slack.messages.size).toBe(1);
    await resolveSlackUncertainPost(await fresh(f), f.owner.id, f.source.id, { operationId, decision: 'absent', confirmed: true });
    await retry(f); expect(slack.messages.size).toBe(1);
});

test('privacy retains an unknown summary receipt before cleaning the known root, then cleans an explicitly adopted orphan', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack, true); await newThread(f); await dispatch(f);
    await change(f, { resolved: true }); slack.fault('chat.postMessage', 'lost'); let row = await dispatch(f);
    expect(row.status).toBe('ambiguous'); const operationId = row.attempt!.operationId;
    const orphan = [...slack.messages.values()].find(message => message.threadTs)!;
    await change(f, { private: true }); row = await dispatch(f, { exportFeedback: async () => { throw new Error('No private packet'); } });
    expect(row.lastCode).toBe('unknown_copy_cleanup'); expect(row.attempt).toBeUndefined();
    expect(state(row).uncertainPosts?.[0]?.operationId).toBe(operationId); expect(slack.messages.size).toBe(1);
    await resolveSlackUncertainPost(await fresh(f), f.owner.id, f.source.id, { operationId, decision: 'adopt', ts: orphan.ts, confirmed: true });
    row = await retry(f, { exportFeedback: async () => { throw new Error('No private packet'); } });
    expect(row.status).toBe('suppressed'); expect(slack.messages.size).toBe(0);
});

test('lost known-target updates retry the same target; a manually deleted root is never automatically recreated', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); let row = await dispatch(f); const root = state(row).root!;
    await change(f, { resolved: true }); slack.fault('chat.update', 'lost'); row = await dispatch(f); expect(row.attempt?.repeatable).toBe(true);
    row = await retry(f); expect(row.status).toBe('accepted'); expect(state(row).root?.ts).toBe(root.ts); expect(slack.messages.size).toBe(1);
    slack.messages.delete(`${root.channelId}:${root.ts}`); await change(f, { resolved: false }); row = await dispatch(f);
    expect(row.lastCode).toBe('message_missing'); expect(state(row).root).toBeUndefined();
    await change(f, { resolved: true }); await dispatch(f); expect(slack.messages.size).toBe(0);
});

test('a permalink failure retries only the link lookup after a definitive post', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f); slack.fault('chat.getPermalink', 'lost');
    let row = await dispatch(f); expect(state(row).root?.ts).toBeDefined(); expect(row.attempt).toBeUndefined();
    row = await retry(f); expect(row.status).toBe('accepted'); expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
    expect(slack.calls.filter(call => call.method === 'chat.getPermalink')).toHaveLength(2);
});

test('durable method cooldowns stop sibling projects and channel reservations pace posts at least 1.1 seconds apart', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); await connect(sibling, slack); await newThread(sibling);
    slack.fault('chat.postMessage', 'rate'); let row = await dispatch(f); expect(row.status).toBe('waiting'); expect(row.attempt).toBeUndefined();
    await dispatch(sibling); expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
    const grant = await currentSlackGrant(connection);
    await updateDoc<SlackRateBucket>(slackRatePk(grant), 'method_chat_postMessage', value => ({ ...value, pausedUntil: 0 }));
    await retry(f); await retry(sibling);
    const posts = slack.calls.filter(call => call.method === 'chat.postMessage'); expect(posts).toHaveLength(3);
    expect(posts[2]!.at - posts[1]!.at).toBeGreaterThanOrEqual(1090);
});

test('Slack honors a two-day Retry-After without clamping or another HTTP request', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    slack.fault('chat.postMessage', 'rate', '172800'); const before = Date.now(); const row = await dispatch(f);
    const grant = await currentSlackGrant(connection);
    const bucket = (await f.store.get<SlackRateBucket>(slackRatePk(grant), 'method_chat_postMessage'))!.doc;
    expect(bucket.pausedUntil).toBeGreaterThanOrEqual(before + 172800000);
    expect(Date.parse(row.nextAttemptAt)).toBeGreaterThanOrEqual(before + 172800000);
    await retry(f); expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
});

test('unrepresentable Slack retry delays durably block the method for review instead of retrying early', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    slack.fault('chat.postMessage', 'rate', '9'.repeat(400)); const row = await dispatch(f);
    expect(row.lastCode).toBe('rate_limit_requires_review'); expect(row.attempt).toBeUndefined();
    const grant = await currentSlackGrant(connection);
    const bucket = (await f.store.get<SlackRateBucket>(slackRatePk(grant), 'method_chat_postMessage'))!.doc;
    expect(bucket.requiresReview).toBe(true);
    // Even a newly enabled sibling cannot bypass the shared method block.
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); await connect(sibling, slack); await newThread(sibling);
    expect((await dispatch(sibling)).lastCode).toBe('rate_limit_requires_review');
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
});

test('rate review release requires current workspace authority and preserves timed cooldowns and reservations', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    slack.fault('chat.postMessage', 'rate', '9'.repeat(400)); await dispatch(f);
    const grant = await currentSlackGrant(connection); const pk = slackRatePk(grant);
    const future = Date.now() + 172800000; const inFlight = { id: 'retained-in-flight', until: future + 1000 };
    await updateDoc<SlackRateBucket>(pk, 'method_chat_postMessage', row => ({ ...row, pausedUntil: future, nextAt: future + 20, inFlight }));
    const channel = (await f.store.get<SlackRateBucket>(pk, `channel_${slack.channelId}`))!.doc;
    expect(await listSlackRateReviews(await fresh(f), f.owner.id)).toEqual(['chat.postMessage']);
    expect((await getSlackSettings(await fresh(f), f.owner.id)).connection?.rateReviewMethods).toEqual(['chat.postMessage']);
    await expect(clearSlackRateReview(await fresh(f), f.owner.id, 'chat.postMessage', { confirmed: false })).rejects.toThrow();
    await expect(clearSlackRateReview(await fresh(f), f.owner.id, 'conversations.history' as never, { confirmed: true })).rejects.toThrow();
    const other = await fixture();
    await expect(clearSlackRateReview(await fresh(f), other.owner.id, 'chat.postMessage', { confirmed: true })).rejects.toThrow();
    await expect(clearSlackRateReview({ ...f.project, workspaceId: other.project.workspaceId, pk: other.project.pk }, other.owner.id, 'chat.postMessage', { confirmed: true })).rejects.toThrow();
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), row => ({ ...row, role: 'commenter' }));
    await expect(clearSlackRateReview(await fresh(f), f.owner.id, 'chat.postMessage', { confirmed: true })).rejects.toThrow();
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), row => ({ ...row, role: 'admin' }));
    expect((await f.store.get<SlackRateBucket>(pk, 'method_chat_postMessage'))?.doc.requiresReview).toBe(true);
    const before = slack.calls.length; const released = await clearSlackRateReview(await fresh(f), f.owner.id, 'chat.postMessage', { confirmed: true });
    expect(released.released).toBe(true); expect(released.receipt?.id).toMatch(/^rate_release_[a-f0-9-]{36}$/);
    expect(Number.isFinite(Date.parse(released.receipt!.at))).toBe(true);
    const retained = (await f.store.get<SlackRateBucket>(pk, 'method_chat_postMessage'))!.doc;
    expect(retained.requiresReview).toBe(false); expect(retained.pausedUntil).toBe(future); expect(retained.nextAt).toBe(future + 20);
    expect(retained.inFlight).toEqual(inFlight); expect((await f.store.get<SlackRateBucket>(pk, channel.id))!.doc).toEqual(channel);
    expect(slack.calls).toHaveLength(before); expect(await listSlackRateReviews(await fresh(f), f.owner.id)).toEqual([]);
    const replay = await clearSlackRateReview(await fresh(f), f.owner.id, 'chat.postMessage', { confirmed: true });
    expect(replay.released).toBe(false); expect(replay.receipt).toEqual(released.receipt);
});

for (const { name, header, manual } of [{ name: 'long', header: '172800', manual: false }, { name: 'unrepresentable', header: '9'.repeat(400), manual: true }]) {
    test(`${name} refresh rate limits are shared before the send marker and cannot be bypassed by another project`, async ({ slack }) => {
        const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
        const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); await connect(sibling, slack); await newThread(sibling);
        const grant = await currentSlackGrant(connection);
        await updateDoc<SlackGrant>(grant.pk, grant.id, row => ({ ...row, tokens: { ...row.tokens!, expiresAt: old } }));
        slack.fault('oauth.v2.access', 'rate', header); const before = Date.now();
        const first = await dispatch(f); expect(slack.refreshCalls).toBe(1);
        const bucket = (await f.store.get<SlackRateBucket>(slackRatePk(grant), 'method_oauth_v2_access'))!.doc;
        if (manual) { expect(first.lastCode).toBe('rate_limit_requires_review'); expect(bucket.requiresReview).toBe(true); }
        else { expect(first.lastCode).toBe('ratelimited'); expect(bucket.pausedUntil).toBeGreaterThanOrEqual(before + 172800000); }
        await dispatch(sibling); expect(slack.refreshCalls).toBe(1);
        const retained = await currentSlackGrant(connection);
        expect(retained.tokens).toBeDefined(); expect(retained.generation).toBe(grant.generation); expect(retained.refreshStartedAt).toBeUndefined();
    });
}

test('a private transition while waiting on a channel slot is fenced before any payload leaves', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    const grant = await currentSlackGrant(connection);
    await f.store.create<SlackRateBucket>({ type: 'slack-rate', pk: slackRatePk(grant), id: `channel_${slack.channelId}`, nextAt: Date.now() + 250, pausedUntil: 0 });
    const changing = new Promise<void>((resolve, reject) => setTimeout(() => { void change(f, { private: true }).then(() => resolve(), reject); }, 40));
    const row = await dispatch(f); await changing;
    expect(row.lastCode).toBe('projection_changed'); expect(row.attempt).toBeUndefined(); expect(slack.messages.size).toBe(0);
});

test('disabled and removed-admin connections make no calls; auth invalidation stops the shared grant without stale wipes', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f);
    await setSlackEnabled(await fresh(f), f.owner.id, false); const before = slack.calls.length; await dispatch(f); expect(slack.calls).toHaveLength(before);
    await setSlackEnabled(await fresh(f), f.owner.id, true);
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'commenter' }));
    await retry(f); expect(slack.calls).toHaveLength(before);
    await updateDoc<DbMember>(f.project.pk, memberId(f.owner.id), member => ({ ...member, role: 'admin' }));
    const grant = await currentSlackGrant(connection);
    await updateDoc<SlackGrant>(grant.pk, grant.id, row => ({ ...row, generation: row.generation + 1 }));
    await invalidateSlackGrant(grant); expect((await currentSlackGrant(connection)).tokens).toBeDefined();
});

test('a lost refresh response requires reconnect instead of replaying an uncertain rotating credential', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); const grant = await currentSlackGrant(connection);
    await updateDoc<SlackGrant>(grant.pk, grant.id, row => ({ ...row, tokens: { ...row.tokens!, expiresAt: old } }));
    slack.loseNextRefresh(); await expect(slackAccessToken(connection)).rejects.toThrow();
    expect((await currentSlackGrant(connection)).tokens).toBeUndefined(); expect(slack.refreshCalls).toBe(1);
    await expect(slackAccessToken(connection)).rejects.toThrow(); expect(slack.refreshCalls).toBe(1);
});

test('hard deletion cleans the known root without exporting a missing source', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); await newThread(f); const previous = await dispatch(f);
    const current = (await f.comments.get(f.source.domain, f.source.id))!;
    expect(await f.comments.delete(f.source.domain, f.source.id, current.etag)).toBe('ok');
    await enqueueIntegrationSync(await fresh(f), 'slack', connection.id, f.source.id, previous.requestedVersion + 1,
        { deletion: { version: previous.requestedVersion + 1, deletedAt: new Date().toISOString() } });
    const row = await retry(f, { exportFeedback: async () => { throw new Error('No deleted packet'); } });
    expect(row.tombstoned).toBe(true); expect(row.status).toBe('suppressed'); expect(slack.messages.size).toBe(0);
});

test('a persisted in-flight refresh marker after a crash requires reconnect even while the old access expiry is future', async ({ slack }) => {
    const f = await fixture(); const connection = await connect(f, slack); const grant = await currentSlackGrant(connection);
    await updateDoc<SlackGrant>(grant.pk, grant.id, row => ({ ...row, refreshStartedAt: new Date().toISOString() }));
    const before = slack.calls.length; await expect(slackAccessToken(connection)).rejects.toThrow();
    expect(slack.calls).toHaveLength(before); expect(slack.refreshCalls).toBe(0); expect((await currentSlackGrant(connection)).tokens).toBeUndefined();
});

test('local off and disconnect use persisted installation identity when deployment credentials disappear', async ({ slack }) => {
    const f = await fixture(); const first = await connect(f, slack);
    const sibling = await fixture({ id: f.project.workspaceId, owner: f.owner }); const second = await connect(sibling, slack);
    const fields = ['SLACK_APP_ID', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_TOKEN_KEY'] as const;
    const saved = Object.fromEntries(fields.map(key => [key, process.env[key]]));
    try {
        for (const key of fields) delete process.env[key];
        await setSlackEnabled(await fresh(f), f.owner.id, false);
        await disconnectSlack(await fresh(f), f.owner.id); expect((await currentSlackGrant(second)).tokens).toBeDefined();
        await disconnectSlack(await fresh(sibling), sibling.owner.id); expect((await currentSlackGrant(first)).tokens).toBeUndefined();
    } finally { for (const key of fields) process.env[key] = saved[key]; }
});

test('test sends are explicit, generic, budgeted and recorded; ordinary destination saves send nothing', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); expect(slack.messages.size).toBe(0);
    await sendSlackTestNotification(await fresh(f), f.owner.id); expect(slack.messages.size).toBe(1);
    expect([...slack.messages.values()][0]!.payload.text).toBe('uier is connected to this channel.');
    expect(await f.store.query({ type: 'slack-test', pk: f.project.pk, where: { status: 'sent' } })).toHaveLength(1);
});

test('literal hostile feedback cannot become mentions, links, files or browser details, and transport errors are redacted', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f);
    const current = await source(f); await change(f, { thread: { items: [{ ...current.thread.items[0]!, text: '<@U123> <!channel> @here & <https://evil.example|click>\u202e'.repeat(40) }] } });
    const row = await dispatch(f); const message = [...slack.messages.values()][0]!.payload;
    expect(message.mrkdwn).toBe(false); expect(message.parse).toBe('none'); expect(message.unfurl_links).toBe(false);
    expect(String(message.text)).not.toMatch(/<@|<!channel>|\u202e|screenshot|viewport|selector/i);
    const blocks = message.blocks as { type: string; text?: { type: string; text: string } }[];
    expect(blocks.filter(block => block.text).every(block => block.text!.type === 'plain_text')).toBe(true);
    expect(blocks[1]!.text!.text.length).toBeLessThanOrEqual(500); expect(String(message.text).length).toBeLessThanOrEqual(2500);
    expect(JSON.stringify(message).length).toBeLessThanOrEqual(2600); // Includes the channel and non-broadcast envelope.
    expect(state(row).root?.permalink).toContain('slack.com');
    const token = await slackAccessToken((await rawSlackConnection(await fresh(f)))!); slack.fault('chat.getPermalink', 'internal');
    await expect(slackRequest('chat.getPermalink', { channel: slack.channelId, message_ts: state(row).root!.ts }, { token })).rejects.toMatchObject({ name: 'SlackApiError', message: 'Slack could not complete the request.' });
    expect(new SlackApiError(500, 'internal_error').message).not.toContain(token);
});


test('native reply sync upgrades Slack scopes explicitly, syncs thread replies and original edits/deletions', async ({ slack }) => {
    test.setTimeout(90_000);
    const f = await fixture(); await connect(f, slack); await newThread(f); let current = await dispatch(f);
    await expect(setIntegrationReplySync(f.project, 'slack', f.owner.id, true)).rejects.toThrow('Reconnect Slack');
    const upgrade = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl, requestReplies: true }));
    expect(upgrade.searchParams.get('scope')).toContain('channels:history'); expect(upgrade.searchParams.has('user_scope')).toBe(false);
    expect((await finishSlackConnect({ userId: f.owner.id, state: upgrade.searchParams.get('state'), baseUrl,
        code: slack.code({ scopes: 'chat:write,channels:read,groups:read,channels:history,groups:history,users:read' }) })).status).toBe('connected');
    await fresh(f);
    const upgraded = (await rawSlackConnection(f.project))!;
    const reused = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl, requestReplies: true }));
    expect(reused.pathname).toBe(`/app/projects/${f.project.id}/settings/integrations/slack`);
    expect(await rawSlackConnection(f.project)).toMatchObject({ enabled: true, destinationRevision: upgraded.destinationRevision });
    await setIntegrationReplySync(f.project, 'slack', f.owner.id, true);
    const reply = { id: `item_${randomUUID()}`, text: 'A Slack thread reply', authorId: `user:${f.owner.id}`, createdAt: new Date().toISOString() };
    await change(f, { thread: { items: [...(await source(f)).thread.items, reply] } }); slack.fault('chat.postMessage', 'lost'); current = await dispatch(f);
    expect(current.attempt?.step).toBe('create_native_reply'); current = await retry(f); expect(current.status).toBe('accepted');
    const root = state(current).root!; const copy = [...slack.messages.values()].find(message => message.threadTs === root.ts)!;
    expect(copy.payload.text).toContain(reply.text);
    await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, toolbarLanguage: 'hr' }));
    await change(f, { thread: (await source(f)).thread });
    current = await dispatch(f);
    expect(copy.payload.text).toContain('Pogledajte u uieru');
    expect(copy.payload.text).toContain(reply.text);
    expect([...slack.messages.values()].filter(message => message.threadTs === root.ts)).toHaveLength(1);
    await change(f, { thread: { items: (await source(f)).thread.items.map(item => item.id === reply.id ? { ...item, text: 'Edited uier reply' } : item) } });
    current = await dispatch(f); expect(copy.payload.text).toContain('Edited uier reply');
    await change(f, { thread: { items: (await source(f)).thread.items.filter(item => item.id !== reply.id) } });
    current = await dispatch(f); expect(slack.messages.has(`${root.channelId}:${copy.ts}`)).toBe(false);
    const ts = (Date.now() / 1000 + 0.01).toFixed(6); slack.human(root.channelId, ts, root.ts, 'Human Slack reply');
    const poll = () => processIntegrationDelivery(current, baseUrl, slackAdapter, { statusOnly: true });
    await poll(); expect((await source(f)).thread.items.at(-1)!.text).toBe('Human Slack reply');
    current = await dispatch(f); expect([...slack.messages.values()].filter(message => message.threadTs === root.ts)).toHaveLength(1);
    slack.messages.get(`${root.channelId}:${ts}`)!.payload.text = 'Edited in Slack'; await poll(); expect((await source(f)).thread.items.at(-1)!.text).toBe('Edited in Slack');
    current = await dispatch(f); slack.messages.delete(`${root.channelId}:${ts}`); await poll(); expect((await source(f)).thread.items.at(-1)!.deletedAt).toBeTruthy();
});

test('Events API imports Slack thread replies at once and uier replies reach Slack without the worker', async ({ slack }) => {
    test.setTimeout(90_000);
    const secret = 'slack-test-signing-secret';
    const f = await fixture(); await connect(f, slack);
    const upgrade = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl, requestReplies: true }));
    expect(upgrade.searchParams.get('scope')).toBe('chat:write,channels:read,groups:read,channels:history,groups:history,users:read');
    expect((await finishSlackConnect({ userId: f.owner.id, state: upgrade.searchParams.get('state'), baseUrl,
        code: slack.code({ scopes: 'chat:write,channels:read,groups:read,channels:history,groups:history,users:read' }) })).status).toBe('connected');
    await setIntegrationReplySync(await fresh(f), 'slack', f.owner.id, true);
    await newThread(f); const current = await dispatch(f); const root = state(current).root!;
    expect(await findSlackThread(root.teamId, root.channelId, root.ts)).toMatchObject({ ledgerPk: current.pk, ledgerId: current.id });

    const tasks: Promise<void>[] = [];
    const send = async (body: object, options: { secret?: string; at?: number } = {}) => {
        const raw = JSON.stringify(body); const at = options.at ?? Math.floor(Date.now() / 1000);
        const signature = `v0=${createHmac('sha256', options.secret ?? secret).update(`v0:${at}:${raw}`).digest('hex')}`;
        const result = await receiveSlackEvent(raw, new Headers({ 'x-slack-request-timestamp': String(at), 'x-slack-signature': signature }),
            { baseUrl, schedule: task => { tasks.push(task()); return true; } });
        await Promise.all(tasks.splice(0)); return result;
    };
    const event = (inner: object) => ({ type: 'event_callback', api_app_id: slack.appId, team_id: root.teamId,
        event: { type: 'message', channel: root.channelId, ...inner } });
    const ts = (seconds: number) => (Date.now() / 1000 + seconds).toFixed(6);
    expect((await send({ type: 'url_verification', challenge: 'missing-secret' })).status).toBe(503);
    process.env.SLACK_SIGNING_SECRET = secret;
    try {
        expect(await send({ type: 'url_verification', challenge: 'challenge-123' })).toEqual({ status: 200, body: JSON.stringify({ challenge: 'challenge-123' }) });
        expect((await send({ type: 'url_verification', challenge: 'forged' }, { secret: 'not-the-secret' })).status).toBe(401);
        expect((await send({ type: 'url_verification', challenge: 'replayed' }, { at: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);

        // Channel messages outside a linked thread, other apps' callbacks and uier's own copies are dropped unread.
        const before = slack.calls.length;
        expect((await send(event({ user: 'UHUMAN', text: 'Unrelated channel message', ts: ts(1) }))).status).toBe(200);
        expect((await send({ ...event({ user: 'UHUMAN', text: 'Another app', ts: ts(2), thread_ts: root.ts }), api_app_id: 'AOTHERAPP' })).status).toBe(200);
        expect((await send(event({ user: slack.botId, app_id: slack.appId, bot_id: 'BTESTBOT', text: 'Own copy', ts: ts(3), thread_ts: root.ts }))).status).toBe(200);
        expect((await send(event({ user: 'UHUMAN', text: 'Unknown thread', ts: ts(3.5), thread_ts: ts(-60) }))).status).toBe(200);
        expect(slack.calls.length).toBe(before);
        expect((await source(f)).thread.items).toHaveLength(1);
        // A file the app shared (Screenshots and recordings) comes back as the bot user's file_share message, with or without its app id.
        await send(event({ subtype: 'file_share', user: slack.botId, text: '', files: [{ id: 'F0TESTFILE' }], ts: ts(3.7), thread_ts: root.ts }));
        expect((await source(f)).thread.items).toHaveLength(1);

        // A reply imports with the person's Slack name, without a history read; the next one is not held back.
        const first = ts(4);
        await send(event({ user: 'UHUMAN', text: 'Looks good from Slack', ts: first, thread_ts: root.ts }));
        expect((await source(f)).thread.items.at(-1)).toMatchObject({ text: 'Looks good from Slack', authorName: 'Human via Slack' });
        await send(event({ user: 'UHUMAN', text: 'One more thing', ts: ts(5), thread_ts: root.ts }));
        expect((await source(f)).thread.items.at(-1)!.text).toBe('One more thing');
        expect(slack.calls.filter(call => call.method === 'conversations.replies')).toHaveLength(0);
        // One name lookup per new reply; edits and deletions below need none.
        expect(slack.calls.filter(call => call.method === 'users.info')).toHaveLength(2);
        const imported = (await source(f)).thread.items.find(item => item.integrationSource?.externalId === first)!;
        await send(event({ subtype: 'message_changed', ts: ts(6), message: { user: 'UHUMAN', text: 'Edited in Slack', ts: first, thread_ts: root.ts } }));
        expect((await source(f)).thread.items.find(item => item.id === imported.id)!.text).toBe('Edited in Slack');
        await send(event({ subtype: 'message_deleted', ts: ts(7), deleted_ts: first, previous_message: { user: 'UHUMAN', text: 'Edited in Slack', ts: first, thread_ts: root.ts } }));
        expect((await source(f)).thread.items.find(item => item.id === imported.id)!.deletedAt).toBeTruthy();
        expect(slack.calls.filter(call => call.method === 'users.info')).toHaveLength(2);

        // A uier reply to a thread Slack already has goes out right away.
        const reply = { id: `item_${randomUUID()}`, text: 'Replying from uier', authorId: `user:${f.owner.id}`, createdAt: new Date().toISOString() };
        await change(f, { thread: { items: [...(await source(f)).thread.items, reply] } });
        expect(await deliverThreadNow(f.project.id, f.source.id, { baseUrl, deadline: Date.now() + 15_000 })).toBe(1);
        expect([...slack.messages.values()].some(message => message.threadTs === root.ts && String(message.payload.text).includes('Replying from uier'))).toBe(true);
        expect((await source(f)).syncPending).toBe(false);
    } finally { delete process.env.SLACK_SIGNING_SECRET; }
});

test('a new thread keeps the worker batching window; immediate delivery only updates existing Slack copies', async ({ slack }) => {
    const f = await fixture(); await connect(f, slack); await newThread(f);
    expect(await deliverThreadNow(f.project.id, f.source.id, { baseUrl, deadline: Date.now() + 15_000 })).toBe(0);
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(0);
    expect((await source(f)).syncPending).toBe(true);
});

test('custom feedback types use their saved label and built-in names stay stable', () => {
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted', identity: { commentId: 'comment_type' },
        title: 'Saved thread', kind: 'custom_design', feedbackType: { id: 'custom_design', label: 'Design review', icon: 'message' },
        status: 'open', feedback: null, anchor: { type: 'page' }, source: { path: '/' }, links: {},
        reproduction: {}, screenshot: { state: 'unavailable' }, discussion: [], notes: []
    };
    expect(slackRootMessage(context, 'Project').payload.text.split('\n')[0]).toBe('Design review in Project');
    for (const [kind, label] of [['feedback', 'Feedback'], ['bug', 'Bug'], ['rewrite', 'Suggested rewrite']] as const)
        expect(slackRootMessage({ ...context, kind }, 'Project').payload.text.split('\n')[0]).toBe(`${label} in Project`);
});

test('the card links its heading, keeps reviewer text plain and gives status, priority, page and environment one line', () => {
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted', identity: { projectId: 'abcdefghijkl', commentId: 'comment_card', number: 7 },
        title: 'Saved thread', kind: 'bug', priority: 'high', status: 'open', feedback: { id: 'item_card', deleted: false, text: 'The price is cut off <!channel>' },
        anchor: { type: 'page' }, source: { path: '/pricing', environment: 'Production' }, links: {},
        reproduction: {}, screenshot: { state: 'unavailable' }, discussion: [], notes: []
    };
    const link = 'https://uier.io/app/review/abcdefghijkl?comment=comment_card';
    const { payload } = slackRootMessage(context, 'Acme <!here> & Co');
    expect(payload.blocks).toEqual([
        // Labels in rich text lose their angle brackets; the fallback and reviewer text keep Slack's documented entities.
        { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
            { type: 'link', url: link, text: 'Bug #7', style: { bold: true } }, { type: 'text', text: ' in Acme ‹!here› & Co' }] }] },
        { type: 'section', text: { type: 'plain_text', text: 'The price is cut off &lt;!channel&gt;', emoji: false } },
        { type: 'context', elements: [{ type: 'plain_text', text: 'Open · Priority: High · /pricing · Production', emoji: false }] },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in uier', emoji: false }, url: link }] }
    ]);
    expect(payload.text).toBe(['Bug #7 in Acme &lt;!here&gt; &amp; Co', 'The price is cut off &lt;!channel&gt;',
        'Open · Priority: High · /pricing · Production', `Open in uier: ${link}`].join('\n'));
    // The default priority is left out, a long page path is cut, and a thread without a link gets a plain heading and no button.
    const quiet = slackRootMessage({ ...context, identity: { commentId: 'comment_card' }, priority: 'normal', status: 'done',
        source: { path: `/${'a'.repeat(100)}` } }, 'Project').payload;
    expect(quiet.blocks).toEqual([
        { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Bug', style: { bold: true } }, { type: 'text', text: ' in Project' }] }] },
        { type: 'section', text: { type: 'plain_text', text: 'The price is cut off &lt;!channel&gt;', emoji: false } },
        { type: 'context', elements: [{ type: 'plain_text', text: `Done · /${'a'.repeat(58)}…`, emoji: false }] }
    ]);
    expect(quiet.text).toContain('Open the project in uier to view this feedback.');
});

test('sending files needs its own permission and setting, and keeps the channel and other optional access', async ({ slack }) => {
    const f = await fixture(); const before = await connect(f, slack);
    expect((await getSlackSettings(f.project, f.owner.id)).connection).toMatchObject({ files: false, filesAllowed: false });
    await expect(setSlackFiles(f.project, f.owner.id, true)).rejects.toMatchObject({ code: 'files_permission_required' });
    await allowFiles(f, slack);
    expect((await rawSlackConnection(f.project))!).toMatchObject({ enabled: true, destinationRevision: before.destinationRevision,
        config: { channelId: slack.channelId, files: true } });
    expect((await getSlackSettings(f.project, f.owner.id)).connection).toMatchObject({ files: true, filesAllowed: true });
    // A later request for reply access asks for file access again, so one never replaces the other.
    const replies = new URL(await beginSlackConnect({ userId: f.owner.id, workspaceId: f.project.workspaceId, projectId: f.project.id, baseUrl, requestReplies: true }));
    expect(replies.searchParams.get('scope')).toBe('chat:write,channels:read,groups:read,channels:history,groups:history,users:read,files:write');
    // A grant that comes back without the permission turns sending off, rather than failing on every thread.
    expect((await finishSlackConnect({ userId: f.owner.id, state: replies.searchParams.get('state'), baseUrl,
        code: slack.code({ scopes: 'chat:write,channels:read,groups:read,channels:history,groups:history,users:read' }) })).status).toBe('connected');
    expect((await rawSlackConnection(await fresh(f)))!.config.files).toBe(false);
    expect((await getSlackSettings(f.project, f.owner.id)).connection).toMatchObject({ files: false, filesAllowed: false });
    expect(slack.calls.some(call => call.method.startsWith('files.') || call.method === 'upload')).toBe(false);
});

test('screenshots and recordings are shared under the message, replaced when they change and removed with the thread', async ({ slack }) => {
    test.setTimeout(90_000);
    const f = await fixture(); await connect(f, slack); await allowFiles(f, slack);
    const image = Buffer.from('first-image'); const video = Buffer.from('recording-bytes');
    await change(f, { screenshot: await saveScreenshot(f, image, 'r1'), recording: await saveRecording(f, video) });
    await newThread(f); let row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(row.attempt).toBeUndefined();
    const root = state(row).root!;
    expect(liveFiles(slack).map(file => [file.name, file.title, file.channel, file.threadTs, file.completed])).toEqual([
        ['uier-feedback-screenshot.webp', 'Screenshot', root.channelId, root.ts, true], ['uier-feedback-recording.mp4', 'Recording', root.channelId, root.ts, true]]);
    expect(liveFiles(slack).map(file => file.bytes)).toEqual([image, video]); expect(liveFiles(slack)[0]!.alt).toContain('Screenshot');
    expect(state(row).files).toMatchObject([{ key: 'root:screenshot', revision: 'r1', shared: true, channelId: root.channelId, rootTs: root.ts },
        { key: 'root:recording', shared: true }]);
    // The bytes travel only in the upload: no message and no ledger holds them.
    expect(JSON.stringify([...slack.messages.values()].map(message => message.payload))).not.toMatch(/first-image|recording-bytes/);
    expect(JSON.stringify(row)).not.toMatch(/first-image|recording-bytes/);
    const uploads = () => slack.calls.filter(call => call.method === 'upload').length;
    await change(f, { resolved: true }); row = await dispatch(f); expect(row.status).toBe('accepted'); expect(uploads()).toBe(2);
    // A replaced image, for example a redacted one, replaces its copy.
    await change(f, { screenshot: await saveScreenshot(f, Buffer.from('redacted'), 'r2') }); row = await dispatch(f);
    expect(liveFiles(slack).map(file => file.bytes!.toString()).sort()).toEqual(['recording-bytes', 'redacted']);
    expect([...slack.files.values()].filter(file => file.deleted)).toHaveLength(1);
    // Off: nothing new is sent, and a file replaced or removed in uier still leaves Slack.
    await setSlackFiles(await fresh(f), f.owner.id, false);
    await f.comments.deleteScreenshot(f.source.domain, f.source.id);
    await change(f, { screenshot: undefined, recording: await saveRecording(f, Buffer.from('second-recording')) }); row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(liveFiles(slack)).toEqual([]); expect(uploads()).toBe(3);
    // On again: the next change to the thread sends what it has now.
    await setSlackFiles(await fresh(f), f.owner.id, true);
    await change(f, { resolved: false }); row = await dispatch(f);
    expect(liveFiles(slack).map(file => [file.title, file.bytes!.toString()])).toEqual([['Recording', 'second-recording']]);
    // Privacy cleanup deletes the remaining file with the message, without a feedback packet.
    await change(f, { private: true }); row = await dispatch(f, { exportFeedback: async () => { throw new Error('No private packet'); } });
    expect(liveFiles(slack)).toEqual([]); expect(slack.messages.size).toBe(0); expect(state(row).files ?? []).toEqual([]);
});

test('the files of a reply follow its synced copy in the Slack thread and leave with it', async ({ slack }) => {
    test.setTimeout(90_000);
    const f = await fixture(); await connect(f, slack);
    await allowFiles(f, slack, 'chat:write,channels:read,groups:read,channels:history,groups:history,users:read,files:write', { requestReplies: true });
    await newThread(f); await dispatch(f);
    const item = (offset: number) => ({ id: `item_${randomUUID()}`, text: 'Here it is', authorId: `user:${f.owner.id}`, createdAt: new Date(Date.now() + offset).toISOString() });
    const withFiles = async (reply: ReturnType<typeof item>) => ({ ...reply, screenshot: await saveScreenshot(f, Buffer.from(`image-${reply.id}`), 'r1', reply.id),
        recording: await saveRecording(f, Buffer.from(`video-${reply.id}`), reply.id) });
    // Without reply sync the reply is not in Slack, so its files stay in uier too.
    const first = item(-1000); await change(f, { thread: { items: [...(await source(f)).thread.items, await withFiles(first)] } });
    let row = await dispatch(f); expect(row.status).toBe('accepted'); expect(slack.files.size).toBe(0);
    // Reply sync starts with replies added after it is turned on; the earlier reply and its files stay out.
    await setIntegrationReplySync(await fresh(f), 'slack', f.owner.id, true);
    const second = item(1000); await change(f, { thread: { items: [...(await source(f)).thread.items, await withFiles(second)] } });
    row = await dispatch(f); expect(row.status).toBe('accepted');
    const root = state(row).root!;
    expect(liveFiles(slack).map(file => [file.name, file.title, file.threadTs, file.bytes!.toString()])).toEqual([
        ['uier-feedback-reply-screenshot.webp', 'Screenshot from a reply', root.ts, `image-${second.id}`],
        ['uier-feedback-reply-recording.mp4', 'Recording from a reply', root.ts, `video-${second.id}`]]);
    expect(state(row).files!.map(file => file.key)).toEqual([`${second.id}:screenshot`, `${second.id}:recording`]);
    // The file messages are the app's own: reading the thread back imports nothing from them.
    await processIntegrationDelivery(row, baseUrl, slackAdapter, { statusOnly: true });
    expect((await source(f)).thread.items).toHaveLength(3);
    // A reply deleted in uier takes its copy and its files out of Slack.
    await change(f, { thread: { items: (await source(f)).thread.items.filter(reply => reply.id !== second.id) } }); row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(liveFiles(slack)).toEqual([]); expect(state(row).files).toEqual([]);
    expect([...slack.messages.values()].filter(message => message.threadTs === root.ts)).toHaveLength(0);
});

test('an upload with an unknown outcome is deleted by its id and sent once more, a refused file is not retried and a lost permission never holds back the message', async ({ slack }) => {
    test.setTimeout(90_000);
    const f = await fixture(); await connect(f, slack); await allowFiles(f, slack);
    await change(f, { screenshot: await saveScreenshot(f, Buffer.from('image'), 'r1') }); await newThread(f);
    slack.fault('files.completeUploadExternal', 'lost');
    let row = await dispatch(f);
    // Slack shared the file, but the answer never arrived: the message stands and the file is unconfirmed.
    expect(row.status).toBe('queued'); expect(row.attempt).toMatchObject({ step: 'share_file', repeatable: true });
    expect(state(row).root).toBeDefined(); expect(state(row).files).toHaveLength(1); expect(state(row).files![0]!.shared).toBeUndefined();
    row = await retry(f); expect(row.status).toBe('accepted'); expect(row.attempt).toBeUndefined();
    expect([...slack.files.values()].map(file => Boolean(file.deleted))).toEqual([true, false]); expect(state(row).files).toMatchObject([{ shared: true }]);
    expect(liveFiles(slack)).toHaveLength(1);
    expect(slack.calls.filter(call => call.method === 'chat.postMessage')).toHaveLength(1);
    // A file type the workspace refuses is remembered for that revision.
    slack.fault('files.completeUploadExternal', 'refused');
    await change(f, { screenshot: await saveScreenshot(f, Buffer.from('second'), 'r2') }); row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(row.lastCode).toBe('file_refused'); expect(row.attempt).toBeUndefined();
    expect(state(row).skippedFiles).toEqual([{ key: 'root:screenshot', revision: 'r2', code: 'file_type_not_allowed' }]); expect(liveFiles(slack)).toEqual([]);
    const reserved = () => slack.calls.filter(call => call.method === 'files.getUploadURLExternal').length; const before = reserved();
    await change(f, { resolved: true }); row = await dispatch(f); expect(row.lastCode).toBe('file_refused'); expect(reserved()).toBe(before);
    // Without the permission the message still updates and the connection stays on; the file waits.
    slack.fault('files.getUploadURLExternal', 'scope');
    await change(f, { resolved: false, screenshot: await saveScreenshot(f, Buffer.from('third'), 'r3') }); row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(row.lastCode).toBe('files_permission_required'); expect(row.attempt).toBeUndefined();
    expect((await rawSlackConnection(await fresh(f)))!.status).toBe('connected');
    expect(String([...slack.messages.values()][0]!.payload.text)).toContain('Open · /pricing');
    // The next change sends it.
    await change(f, { resolved: true }); row = await dispatch(f);
    expect(row.status).toBe('accepted'); expect(row.lastCode).toBeUndefined(); expect(liveFiles(slack).map(file => file.bytes!.toString())).toEqual(['third']);
});

const slackLanguages = [
    { language: 'en', open: 'Open in uier', view: 'View in uier', connected: 'uier is connected to this channel.', one: '1 new reply in uier.', two: '2 new replies in uier.' },
    { language: 'de', open: 'In uier öffnen', view: 'In uier ansehen', connected: 'uier ist mit diesem Channel verbunden.', one: '1 neue Antwort in uier.', two: '2 neue Antworten in uier.' },
    { language: 'fr', open: 'Ouvrir dans uier', view: 'Voir dans uier', connected: 'uier est connecté à ce canal.', one: '1 nouvelle réponse dans uier.', two: '2 nouvelles réponses dans uier.' },
    { language: 'es', open: 'Abrir en uier', view: 'Ver en uier', connected: 'uier está conectado a este canal.', one: '1 nueva respuesta en uier.', two: '2 nuevas respuestas en uier.' },
    { language: 'it', open: 'Apri in uier', view: 'Visualizza in uier', connected: 'uier è collegato a questo canale.', one: '1 nuova risposta in uier.', two: '2 nuove risposte in uier.' },
    { language: 'hr', open: 'Otvorite u uieru', view: 'Pogledajte u uieru', connected: 'uier je povezan s ovim kanalom.', one: '1 novi odgovor u uieru.', two: 'Novi odgovori u uieru: 2.' }
] as const;

for (const expected of slackLanguages) test(`Slack ${expected.language} translates generated text and buttons without translating or interpreting saved content`, async () => {
    const i18n = createAppI18n(expected.language, await loadAppCatalog(expected.language));
    const context: FeedbackContext = {
        schemaVersion: 1, contentTrust: 'untrusted', identity: { projectId: 'abcdefgh1234', commentId: 'comment_language', number: 8 },
        title: 'Saved title', kind: 'rewrite', status: 'done', priority: 'high',
        feedback: { id: 'item_language', deleted: false, text: 'Nemojte prevoditi <@U123> & {text} $&.' },
        anchor: { type: 'page' }, source: { path: '/', environment: 'Saved environment' }, links: {},
        reproduction: {}, screenshot: { state: 'unavailable' }, discussion: [], notes: [],
        verification: { id: 'verification_language', revision: 'r1', outcome: 'pending', requestedAt: old, requester: 'Ana <@U123>', reviewer: 'Luka & Lea',
            decision: { kind: 'confirm', actor: 'Saved actor', at: old, override: true } }
    };
    const root = slackRootMessage(context, 'Saved project', baseUrl, i18n).payload;
    expect(JSON.stringify(root.blocks)).toContain(expected.open);
    expect(root.text).toContain('Nemojte prevoditi &lt;@U123&gt; &amp; {text} $&amp;.');
    for (const saved of ['Saved project', 'Saved environment', 'Ana &lt;@U123&gt;', 'Luka &amp; Lea', 'Saved actor']) expect(root.text).toContain(saved);
    expect(root.text).toContain(i18n.t('Suggested rewrite'));
    expect(root.text).toContain(i18n.t('Priority: {priority}', { priority: i18n.t('High') }));
    // The heading is one translated sentence; the linked name sits where that language puts it.
    expect(root.text.split('\n')[0]).toBe(i18n.t('{thread} in {project}', { thread: `${i18n.t('Suggested rewrite')} #8`, project: 'Saved project' }));
    expect(JSON.stringify(root.blocks[0])).toContain(`"text":"${i18n.t('Suggested rewrite')} #8","style":{"bold":true}`);
    if (expected.language !== 'en') expect(root.text).not.toMatch(/Requested by|admin override for|historical only|Priority:|Environment:|Suggested rewrite:/);
    expect(root).toMatchObject({ mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false });
    expect(slackChangeSummary(undefined, 1, i18n).payload.text).toBe(expected.one);
    expect(slackChangeSummary(undefined, 2, i18n).payload.text).toBe(expected.two);
    expect(slackChangeSummary('done', 0, i18n).payload.text).toContain(i18n.t('Done'));
    const copy = slackReplyMessage({ author: 'Saved author <@U123>', text: 'Original reply & <!channel> {author}',
        url: 'https://uier.io/app/review/abcdefgh1234#uier-reply-stable', marker: 'uier-reply-stable' }, i18n);
    expect(copy).toContain('Saved author &lt;@U123&gt;'); expect(copy).toContain('Original reply &amp; &lt;!channel&gt; {author}');
    expect(copy).toContain(`#uier-reply-stable|${expected.view}>`);
    expect(copy).not.toMatch(/<@|<!channel>/);
    const custom = slackRootMessage({ ...context, kind: 'custom_language', feedbackType: { id: 'custom_language', label: 'Open', icon: 'message' } }, 'Saved project', baseUrl, i18n);
    // A custom type named like a built-in word stays as saved.
    expect(custom.payload.text.split('\n')[0]).toContain('Open #8');
    for (const feedback of [null, { id: 'deleted', deleted: true }, { id: 'empty', deleted: false, text: '' }]) {
        const fallback = slackRootMessage({ ...context, kind: 'feedback', identity: { commentId: 'no_project' }, feedback }, '', baseUrl, i18n).payload.text;
        if (expected.language !== 'en') expect(fallback).not.toMatch(/This message was deleted|Feedback is unavailable|Open the feedback|Open the project/);
    }
    const bounded = slackRootMessage({ ...context, feedback: { ...context.feedback!, text: '<@U123> <!channel> &\u202e'.repeat(500) } }, 'Saved project', baseUrl, i18n).payload;
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(2500);
    expect(bounded.text).not.toMatch(/<@|<!channel>|\u202e/);
});

test('Slack language follows the project, then workspace, then English independently of account preferences', async ({ slack }) => {
    const f = await fixture();
    expect(slackLanguages.map(value => value.language)).toEqual(toolbarLanguages);
    await updateDoc<DbUser>(userPk(f.owner.id), f.owner.id, user => ({ ...user, appLanguage: 'it', toolbarLanguage: 'de' }));
    expect((await loadSlackI18n(f.project)).language).toBe('en');
    await f.store.create<DbWorkspace>({ type: 'workspace', id: f.project.workspaceId, pk: f.project.pk, name: 'Slack languages', createdBy: f.owner.id, createdAt: old });
    await updateDoc<DbWorkspace>(f.project.pk, f.project.workspaceId, workspace => ({ ...workspace, toolbarLanguage: 'fr' }));
    expect((await loadSlackI18n(f.project)).language).toBe('fr');
    expect((await loadSlackI18n({ ...f.project, toolbarLanguage: 'es' })).language).toBe('es');
    expect((await loadSlackI18n({ ...f.project, toolbarLanguage: 'en' })).language).toBe('en');
    expect((await loadSlackI18n({ ...f.project, toolbarLanguage: 'unsupported' as never })).language).toBe('fr');
    await updateDoc<DbWorkspace>(f.project.pk, f.project.workspaceId, workspace => ({ ...workspace, toolbarLanguage: 'unsupported' as never }));
    expect((await loadSlackI18n(f.project)).language).toBe('en');
    expect(slack.calls).toHaveLength(0);
});

test('Slack delivers roots, summaries and connection tests in all six project languages and updates the same root', async ({ slack }) => {
    test.setTimeout(90_000);
    const f = await fixture(); await connect(f, slack, true); await newThread(f); let row = await dispatch(f);
    const root = state(row).root!;
    for (const [index, expected] of slackLanguages.entries()) {
        await updateDoc<DbProject>(f.project.pk, f.project.id, project => ({ ...project, toolbarLanguage: expected.language }));
        const current = await source(f);
        await change(f, { resolved: index % 2 === 0, thread: { items: [...current.thread.items, { id: `language_${expected.language}`, text: 'Saved reply', authorId: `user:${f.owner.id}`, createdAt: new Date().toISOString() }] } });
        row = await dispatch(f); expect(row.status).toBe('accepted');
        expect(state(row).root!.ts).toBe(root.ts);
        expect(JSON.stringify(slack.messages.get(`${root.channelId}:${root.ts}`)!.payload.blocks)).toContain(expected.open);
        const summary = state(row).notifications!.at(-1)!;
        expect(slack.messages.get(`${summary.channelId}:${summary.ts}`)!.payload.text).toContain(expected.one);
        await sendSlackTestNotification(await fresh(f), f.owner.id);
        expect([...slack.messages.values()].at(-1)!.payload.text).toBe(expected.connected);
    }
    expect([...slack.messages.values()].filter(message => message.ts === root.ts)).toHaveLength(1);
});
