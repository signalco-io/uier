import { randomUUID } from 'node:crypto';
import type { AppDoc, DbProject } from '../../app/model';
import { getAppStore, updateDoc } from '../../app/store';
import { sha256Hex } from '../../app/tokens';
import { setIntegrationBinding } from '../connection';
import type { IntegrationSync } from '../model';
import { integrationPk, integrationSyncId, enqueueIntegrationSync } from '../discovery';
import { getCommentsStore } from '../../repo/commentsStore';
import { isPrivateAppFeedback } from '../../comments/publicProject';
import { acquireOwner, currentSlackGrant, releaseOwner, SlackConnectionError, rawSlackConnection, requireSlackProject, slackAccessToken } from './connection';
import { isSlackConfigured, slackId, slackLabel } from './config';
import { slackMethods, slackRequest, type SlackMethod } from './client';
import type { SlackConnection, SlackInstallationOwner, SlackState } from './model';
import { slackRatePk, withSlackRateLimit, type SlackRateBucket } from './rate';

export async function getSlackSettings(project: DbProject, userId: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    const review = connection ? await Promise.all((['failed', 'ambiguous'] as const).map(status => getAppStore().query<IntegrationSync>({
        type: 'slack-sync', pk: integrationPk('slack', project.id), where: { connectionId: connection.id, status }, limit: 1000 }))) : [];
    const ledgers = review.flat();
    const rateReviewMethods = connection ? await listSlackRateReviews(project, userId).catch(error => {
        if (error instanceof SlackConnectionError) return [] as SlackMethod[];
        throw error;
    }) : [];
    return { configured: isSlackConfigured(), connection: connection ? {
        status: connection.status, statusCode: connection.statusCode, enabled: connection.enabled,
        teamName: slackLabel(connection.config.teamName), channelName: slackLabel(connection.config.channelName),
        replySummaries: connection.config.replySummaries, statusSummaries: connection.config.statusSummaries,
        lastSyncedAt: connection.lastSyncedAt,
        backfill: connection.backfill ? { queued: connection.backfill.queued, total: connection.backfill.threadIds.length, done: connection.backfill.done } : undefined,
        needsReviewCount: ledgers.length, needsReviewCountCapped: review.some(page => page.length === 1000), rateReviewMethods
    } : null };
}

async function slackRateAuthority(project: DbProject, userId: string, heldLeaseId?: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    if (!connection || project.integrations?.slack?.connectionId !== connection.id) throw new SlackConnectionError('rate_review_unavailable');
    const grant = await currentSlackGrant(connection);
    const pk = `slack-installation:${sha256Hex(JSON.stringify([grant.appId, grant.teamId]))}`;
    const owner = (await getAppStore().get<SlackInstallationOwner>(pk, 'owner'))?.doc;
    if (grant.status !== 'connected' || !grant.tokens || !owner || owner.workspaceId !== project.workspaceId
        || owner.appId !== grant.appId || owner.teamId !== grant.teamId || owner.grantId !== grant.id
        || owner.status !== 'active' || owner.generation !== grant.generation) throw new SlackConnectionError('rate_review_unavailable');
    if (owner.operationLease && Date.parse(owner.operationLease.until) > Date.now() && owner.operationLease.id !== heldLeaseId)
        throw new SlackConnectionError('installation_busy');
    return { project, connection, grant, owner };
}

/** Fixed method names only. No credentials or provider calls enter the settings view. */
export async function listSlackRateReviews(project: DbProject, userId: string): Promise<SlackMethod[]> {
    const { grant } = await slackRateAuthority(project, userId);
    const rows = await getAppStore().query<SlackRateBucket>({ type: 'slack-rate', pk: slackRatePk(grant), where: { requiresReview: true }, limit: 8 });
    const ids = new Set(rows.map(row => row.id));
    return slackMethods.filter(method => ids.has(`method_${method.replaceAll('.', '_')}`));
}

/** Explicit operator verification releases the manual flag; timed cooldowns and reservations remain. */
export async function clearSlackRateReview(project: DbProject, userId: string, method: SlackMethod, input: { confirmed: boolean }) {
    if (input.confirmed !== true || !slackMethods.includes(method)) throw new SlackConnectionError('rate_review_confirmation_required');
    const authority = await slackRateAuthority(project, userId);
    const held = await acquireOwner(project.workspaceId, authority.grant.teamId, randomUUID(), authority.grant.appId);
    try {
        const store = getAppStore(); const pk = slackRatePk(authority.grant); const id = `method_${method.replaceAll('.', '_')}`;
        const receipt = { id: `rate_release_${randomUUID()}`, at: new Date().toISOString() };
        for (let attempt = 0; attempt < 8; attempt++) {
            const latest = await slackRateAuthority(project, userId, held.operationLease!.id);
            if (latest.connection.id !== authority.connection.id || latest.connection.destinationRevision !== authority.connection.destinationRevision
                || latest.grant.id !== authority.grant.id || latest.grant.generation !== authority.grant.generation
                || latest.owner.operationLease?.id !== held.operationLease?.id || Date.parse(latest.owner.operationLease?.until ?? '') <= Date.now())
                throw new SlackConnectionError('connection_changed');
            const current = await store.get<SlackRateBucket>(pk, id);
            if (!current?.doc.requiresReview) return { released: false, method, receipt: current?.doc.reviewRelease };
            const result = await store.replace({ ...current.doc, requiresReview: false, reviewRelease: receipt }, current.etag);
            if (result === 'ok') return { released: true, method, receipt };
        }
        throw new SlackConnectionError('rate_review_busy');
    } finally { await releaseOwner(held); }
}

export function eligibleChannel(value: unknown): value is Record<string, unknown> & { id: string; name: string } {
    if (!value || typeof value !== 'object') return false;
    const channel = value as Record<string, unknown>;
    return slackId(channel.id) && typeof channel.name === 'string' && Boolean(slackLabel(channel.name)) && channel.is_member === true
        && channel.is_channel === true && channel.is_archived === false && channel.is_im !== true && channel.is_mpim !== true
        && channel.is_shared !== true && channel.is_ext_shared !== true && channel.is_org_shared !== true && channel.is_pending_ext_shared !== true;
}

export async function loadSlackChannels(project: DbProject, userId: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    if (!isSlackConfigured()) throw new SlackConnectionError('not_configured');
    const connection = await rawSlackConnection(project);
    if (!connection) throw new SlackConnectionError('needs_reconnect');
    const items: { id: string; name: string; private: boolean }[] = [];
    const seen = new Set<string>(); const cursors = new Set<string>(); let scanned = 0;
    const grant = await currentSlackGrant(connection);
    let cursor: string | undefined;
    do {
        await requireSlackProject(project.workspaceId, project.id, userId);
        const token = await slackAccessToken(connection, { allowUnbound: true });
        const response = await withSlackRateLimit(grant, 'conversations.list', undefined, async () => {
            await requireSlackProject(project.workspaceId, project.id, userId);
            return slackRequest('conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: 100,
                ...(cursor ? { cursor } : {}) }, { token });
        });
        if (!Array.isArray(response.channels)) throw new SlackConnectionError('invalid_channels');
        if (response.channels.length > 1000) throw new SlackConnectionError('invalid_channels');
        scanned += response.channels.length;
        for (const channel of response.channels) if (eligibleChannel(channel) && items.length < 1000 && !seen.has(channel.id)) {
            seen.add(channel.id); items.push({ id: channel.id, name: slackLabel(channel.name), private: channel.is_private === true });
        }
        const metadata = response.response_metadata as Record<string, unknown> | undefined;
        if (metadata?.next_cursor !== undefined && (typeof metadata.next_cursor !== 'string' || metadata.next_cursor.length > 512)) throw new SlackConnectionError('invalid_channels');
        cursor = typeof metadata?.next_cursor === 'string' ? metadata.next_cursor.trim() || undefined : undefined;
        if (cursor && cursors.has(cursor)) throw new SlackConnectionError('pagination_stalled');
        if (cursor) cursors.add(cursor);
    } while (cursor && scanned < 1000 && cursors.size < 10);
    return { items, truncated: Boolean(cursor) };
}

export async function saveSlackDestination(project: DbProject, userId: string, input: { channelId: string; replySummaries?: boolean; statusSummaries?: boolean }) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    if (!isSlackConfigured() || !slackId(input.channelId)) throw new SlackConnectionError('invalid_channel');
    const connection = await rawSlackConnection(project);
    if (!connection) throw new SlackConnectionError('needs_reconnect');
    const token = await slackAccessToken(connection, { allowUnbound: true });
    const grant = await currentSlackGrant(connection);
    const response = await withSlackRateLimit(grant, 'conversations.info', undefined,
        () => slackRequest('conversations.info', { channel: input.channelId }, { token }));
    if (!eligibleChannel(response.channel) || response.channel.id !== input.channelId) throw new SlackConnectionError('channel_unavailable');
    await requireSlackProject(project.workspaceId, project.id, userId);
    const changed = connection.config.channelId !== input.channelId;
    const since = changed ? new Date().toISOString() : connection.config.since ?? new Date().toISOString();
    const saved = await updateDoc<SlackConnection>(connection.pk, connection.id, current => {
        if (current.grantId !== connection.grantId || current.destinationRevision !== connection.destinationRevision
            || current.connectedBy !== connection.connectedBy) throw new SlackConnectionError('connection_changed');
        return { ...current, enabled: true, status: 'connected', statusCode: undefined, updatedAt: new Date().toISOString(),
            destinationRevision: current.destinationRevision + 1,
            config: { ...current.config, channelId: input.channelId, channelName: slackLabel((response.channel as Record<string, unknown>).name), since,
                replySummaries: input.replySummaries === true, statusSummaries: input.statusSummaries === true } };
    });
    if (!saved) throw new SlackConnectionError('connection_changed');
    await setIntegrationBinding(project.workspaceId, project.id, 'slack', { connectionId: connection.id, since });
    return getSlackSettings(project, userId);
}

export async function setSlackEnabled(project: DbProject, userId: string, enabled: boolean) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    if (!connection?.config.channelId || (enabled && connection.status !== 'connected') || project.integrations?.slack?.connectionId !== connection.id)
        throw new SlackConnectionError('needs_reconnect');
    if (enabled) await slackAccessToken(connection, { allowUnbound: true });
    await updateDoc<SlackConnection>(connection.pk, connection.id, current => {
        if (current.grantId !== connection.grantId || current.destinationRevision !== connection.destinationRevision || current.connectedBy !== connection.connectedBy)
            throw new SlackConnectionError('connection_changed');
        return { ...current, enabled, updatedAt: new Date().toISOString() };
    });
    if (enabled) for (const ledger of await getAppStore().query<IntegrationSync>({ type: 'slack-sync', pk: integrationPk('slack', project.id), where: { connectionId: connection.id, active: true }, limit: 1000 }))
        await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => ({ ...current, nextAttemptAt: new Date().toISOString() }));
}

export async function resumeSlackNotification(project: DbProject, userId: string, threadId: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    const source = (await getCommentsStore().get(`project:${project.id}`, threadId))?.comment;
    if (!connection?.enabled || connection.status !== 'connected' || project.integrations?.slack?.connectionId !== connection.id
        || !source || source.projectId !== project.id || source.private || isPrivateAppFeedback(source)) throw new SlackConnectionError('resume_unavailable');
    const id = integrationSyncId('slack', connection.id, project.id, threadId);
    const ledger = (await getAppStore().get<IntegrationSync>(integrationPk('slack', project.id), id))?.doc;
    const state = ledger?.state as SlackState | undefined;
    if (!ledger || ledger.attempt || state?.root || state?.notifications?.length || state?.retired?.length || state?.uncertainPosts?.some(post => !post.resolved))
        throw new SlackConnectionError('cleanup_incomplete');
    const requestId = randomUUID();
    await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => {
        if (current.lease && Date.parse(current.lease.until) > Date.now()) throw new SlackConnectionError('notification_busy');
        const retained = current.state as SlackState;
        if (current.attempt || retained.root || retained.notifications?.length || retained.retired?.length || retained.uncertainPosts?.some(post => !post.resolved))
            throw new SlackConnectionError('cleanup_incomplete');
        if (retained.resume && !retained.resume.completed) return current;
        return { ...current, state: { ...retained, resume: { id: requestId, requestedAt: new Date().toISOString(), destinationRevision: connection.destinationRevision } },
            active: true, status: 'queued', nextAttemptAt: new Date().toISOString() };
    });
    await enqueueIntegrationSync(project, 'slack', connection.id, threadId, source.syncVersion ?? 0, { requestId, destinationRevision: connection.destinationRevision });
}

export async function sendSlackTestNotification(project: DbProject, userId: string) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    if (!connection?.config.channelId) throw new SlackConnectionError('invalid_channel');
    const token = await slackAccessToken(connection);
    const grant = await currentSlackGrant(connection);
    type TestReceipt = AppDoc & { type: 'slack-test'; projectId: string; channelId: string; status: string; ts?: string };
    const receipt: TestReceipt = { type: 'slack-test', pk: project.pk, id: `slack_test_${randomUUID()}`, projectId: project.id,
        channelId: connection.config.channelId, status: 'prepared', ttl: 30 * 24 * 3600 };
    await getAppStore().create(receipt);
    let postStarted = false;
    try {
        const response = await withSlackRateLimit(grant, 'chat.postMessage', receipt.channelId, async () => {
            await requireSlackProject(project.workspaceId, project.id, userId);
            const metadata = await withSlackRateLimit(grant, 'conversations.info', undefined,
                () => slackRequest('conversations.info', { channel: receipt.channelId }, { token }));
            if (!eligibleChannel(metadata.channel) || metadata.channel.id !== receipt.channelId) throw new SlackConnectionError('channel_unavailable');
            await requireSlackProject(project.workspaceId, project.id, userId);
            const current = await rawSlackConnection(project);
            if (!current?.enabled || current.status !== 'connected' || current.destinationRevision !== connection.destinationRevision || current.connectedBy !== connection.connectedBy)
                throw new SlackConnectionError('connection_changed');
            postStarted = true;
            return slackRequest('chat.postMessage', { channel: receipt.channelId, text: 'uier is connected to this channel.',
                mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false, reply_broadcast: false }, { token });
        });
        if (response.channel !== receipt.channelId || typeof response.ts !== 'string' || !/^\d+\.\d+$/.test(response.ts)) throw new SlackConnectionError('response_uncertain');
        await updateDoc<TestReceipt>(receipt.pk, receipt.id, current => ({ ...current, status: 'sent', ts: String(response.ts) }));
    } catch (error) {
        await updateDoc<TestReceipt>(receipt.pk, receipt.id, current => ({ ...current, status: postStarted ? 'ambiguous' : 'blocked' }));
        throw error;
    }
}

/** The operator checks Slack under their own access; no history permission is added for recovery. */
export async function resolveSlackUncertainPost(project: DbProject, userId: string, threadId: string,
    input: { operationId: string; decision: 'adopt' | 'absent'; ts?: string; confirmed: boolean }) {
    project = await requireSlackProject(project.workspaceId, project.id, userId);
    const connection = await rawSlackConnection(project);
    const source = (await getCommentsStore().get(`project:${project.id}`, threadId))?.comment;
    if (!connection?.enabled || connection.status !== 'connected' || project.integrations?.slack?.connectionId !== connection.id
        || (source && source.projectId !== project.id) || input.confirmed !== true
        || !['adopt', 'absent'].includes(input.decision) || typeof input.operationId !== 'string' || input.operationId.length > 100
        || (input.decision === 'adopt' && !/^\d{1,20}\.\d{1,20}$/.test(input.ts ?? ''))) throw new SlackConnectionError('resolution_unavailable');
    const pk = integrationPk('slack', project.id); const id = integrationSyncId('slack', connection.id, project.id, threadId);
    await updateDoc<IntegrationSync>(pk, id, ledger => {
        if (ledger.lease && Date.parse(ledger.lease.until) > Date.now()) throw new SlackConnectionError('notification_busy');
        const state = structuredClone(ledger.state) as SlackState;
        const attempt = ledger.attempt;
        if (attempt && !attempt.repeatable && attempt.operationId === input.operationId
            && ['post_root', 'post_summary'].includes(attempt.step) && slackId(attempt.metadata.teamId) && slackId(attempt.metadata.channelId)) {
            state.uncertainPosts = [...(state.uncertainPosts ?? []).filter(post => post.operationId !== attempt.operationId), {
                operationId: attempt.operationId, step: attempt.step, teamId: attempt.metadata.teamId, channelId: attempt.metadata.channelId,
                destinationRevision: attempt.destinationRevision, firstSentAt: attempt.firstSentAt, planHash: attempt.planHash }];
        }
        const post = state.uncertainPosts?.find(post => post.operationId === input.operationId);
        if (!post) throw new SlackConnectionError('resolution_unavailable');
        if (post.resolved) return ledger;
        post.resolved = input.decision === 'adopt' ? 'adopted' : 'absent'; post.ts = input.decision === 'adopt' ? input.ts : undefined;
        if (input.decision === 'adopt') {
            const target = { ts: input.ts!, teamId: post.teamId, channelId: post.channelId };
            if (post.teamId === connection.config.teamId && post.channelId === connection.config.channelId) {
                if (post.step === 'post_root' && !state.root) state.root = target;
                else { state.notifications = [...(state.notifications ?? []), target]; state.resolvedSummary = true; }
            } else state.retired = [...(state.retired ?? []), target];
        } else if (source && !source.private && !isPrivateAppFeedback(source) && post.step === 'post_root' && post.destinationRevision === connection.destinationRevision) {
            state.resume = { id: randomUUID(), requestedAt: new Date().toISOString(), destinationRevision: connection.destinationRevision };
        }
        return { ...ledger, state, attempt: attempt?.operationId === input.operationId ? undefined : attempt,
            active: true, status: 'queued', nextAttemptAt: new Date().toISOString() };
    });
    const saved = (await getAppStore().get<IntegrationSync>(pk, id))?.doc;
    if (!saved) throw new SlackConnectionError('resolution_unavailable');
    await enqueueIntegrationSync(project, 'slack', connection.id, threadId, source?.syncVersion ?? saved.requestedVersion,
        { requestId: `resolve_${input.operationId}`, destinationRevision: connection.destinationRevision });
}
