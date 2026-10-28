import { randomUUID } from 'node:crypto';
import { expect, test as base } from '@playwright/test';
import { memberId, projectRefPk, workspacePk, type DbMember, type DbProject, type DbProjectRef } from '../src/lib/app/model';
import { getAppStore, updateDoc } from '../src/lib/app/store';
import { findOrCreateUser } from '../src/lib/app/users';
import type { DbComment } from '../src/lib/db/schema';
import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { processIntegrationDelivery } from '../src/lib/integrations/delivery';
import { discoverThreadIntegrationSync, enqueueIntegrationSync, integrationPk, integrationSyncId } from '../src/lib/integrations/discovery';
import { startIntegrationBackfill, queueIntegrationBackfills } from '../src/lib/integrations/backfill';
import { syncPendingKey } from '../src/lib/integrations/syncSignal';
import type { IntegrationSync } from '../src/lib/integrations/model';
import { slackAdapter, beginSlackConnect, finishSlackConnect, getSlackSettings, loadSlackChannels, saveSlackDestination,
    disconnectSlack, setSlackEnabled, resumeSlackNotification, resolveSlackUncertainPost, sendSlackTestNotification,
    clearSlackRateReview, listSlackRateReviews } from '../src/lib/integrations/slack';
import { currentSlackGrant, rawSlackConnection, recoverSlackSetups, slackAccessToken, invalidateSlackGrant } from '../src/lib/integrations/slack/connection';
import { SlackApiError, slackRequest } from '../src/lib/integrations/slack/client';
import { slackRatePk, type SlackRateBucket } from '../src/lib/integrations/slack/rate';
import { slackRootMessage } from '../src/lib/integrations/slack/message';
import type { SlackConnection, SlackGrant, SlackInstallationOwner, SlackState } from '../src/lib/integrations/slack/model';
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
