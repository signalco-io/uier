import { sha256Hex } from '../../app/tokens';
import { GrantLeaseError } from '../grants';
import type { IntegrationAdapter, IntegrationDeliveryContext, IntegrationResult } from '../model';
import { SlackApiError, slackRequest, type SlackMethod } from './client';
import { isSlackConfigured, slackId, slackTimestamp } from './config';
import { currentSlackGrant, invalidateSlackGrant, recoverSlackSetups, SlackConnectionError, slackAccessToken } from './connection';
import { slackChangeSummary, slackRootMessage } from './message';
import type { SlackConnection, SlackMessage, SlackState, SlackUncertainPost } from './model';
import { SlackRateWait, withSlackRateLimit } from './rate';
import { eligibleChannel } from './settings';

const invalid = () => new SlackConnectionError('invalid_ledger');
function validMessage(value: SlackMessage) { return slackTimestamp(value.ts) && slackId(value.teamId) && slackId(value.channelId); }
function stateFrom(context: IntegrationDeliveryContext): SlackState {
    const state = structuredClone(context.ledger.state) as SlackState;
    if ((state.root && !validMessage(state.root)) || [...(state.notifications ?? []), ...(state.retired ?? [])].some(value => !validMessage(value))
        || (state.uncertainPosts ?? []).some(post => !slackId(post.teamId) || !slackId(post.channelId) || typeof post.operationId !== 'string')) throw invalid();
    return state;
}
function unknownAttempt(context: IntegrationDeliveryContext): SlackUncertainPost | undefined {
    const attempt = context.ledger.attempt;
    if (!attempt || attempt.repeatable || !['post_root', 'post_summary'].includes(attempt.step)) return;
    if (!slackId(attempt.metadata.channelId) || !slackId(attempt.metadata.teamId)) throw invalid();
    return { operationId: attempt.operationId, step: attempt.step, channelId: attempt.metadata.channelId,
        teamId: attempt.metadata.teamId, destinationRevision: attempt.destinationRevision, firstSentAt: attempt.firstSentAt, planHash: attempt.planHash };
}
function rememberUnknown(state: SlackState, post: SlackUncertainPost) {
    const all = state.uncertainPosts ?? [];
    if (!all.some(item => item.operationId === post.operationId)) state.uncertainPosts = [...all, post];
}
export function validSlackLink(url: URL, connection: SlackConnection, root: SlackMessage) {
    return url.protocol === 'https:' && url.hostname === connection.config.teamHost && /^[a-z0-9-]+\.slack\.com$/.test(url.hostname)
        && !url.port && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === `/archives/${root.channelId}/p${root.ts.replace('.', '')}`;
}

export const slackAdapter: IntegrationAdapter = { provider: 'slack', isConfigured: isSlackConfigured, maxRunMs: 3 * 60_000, maxCalls: 60,
    async maintenance({ deadline }) { await recoverSlackSetups({ deadline }); return { calls: 0 }; },
    async deliver(context): Promise<IntegrationResult> {
        const connection = context.connection as SlackConnection;
        let state: SlackState;
        let grant: Awaited<ReturnType<typeof currentSlackGrant>> | undefined;
        try {
            state = stateFrom(context);
            const unknown = unknownAttempt(context);
            if (unknown) {
                if (context.mode !== 'cleanup') return { status: 'ambiguous', code: 'post_uncertain' };
                // Keep the unknown copy's receipt before clearing the core attempt to clean known copies.
                rememberUnknown(state, unknown);
                await context.checkpoint(state, { clearAttempt: true });
            } else if (context.ledger.attempt) {
                if (!context.ledger.attempt.repeatable) return { status: 'ambiguous', code: 'operation_uncertain' };
                // Known-target full updates/deletes may converge to the latest projection.
                await context.checkpoint(state, { clearAttempt: true });
            }
            const teamId = connection.config.teamId; const channelId = connection.config.channelId;
            if (!slackId(teamId) || !slackId(channelId) || !connection.config.since || !Number.isFinite(Date.parse(connection.config.since)))
                throw new SlackConnectionError('destination_required');
            grant = await currentSlackGrant(connection);
            const token = await slackAccessToken(connection, { refresh: payload => context.read(signal => slackRequest('oauth.v2.access', payload, { oauth: true, signal })) });
            async function read(method: SlackMethod, payload: Record<string, unknown>) {
                return withSlackRateLimit(grant!, method, undefined, () => context.read(signal => slackRequest(method, payload, { token, signal })), context.deadline);
            }
            async function write(method: 'chat.postMessage' | 'chat.update' | 'chat.delete', step: string, payload: Record<string, unknown>, repeatable: boolean) {
                try {
                    const response = await withSlackRateLimit(grant!, method, String(payload.channel), async () => {
                        if (method !== 'chat.delete') {
                            // Check after the posting slot wait. Saved metadata cannot authorize later Slack Connect access.
                            const metadata = await read('conversations.info', { channel: payload.channel });
                            if (!eligibleChannel(metadata.channel) || metadata.channel.id !== payload.channel)
                                throw new SlackApiError(200, 'channel_ineligible');
                        }
                        return context.operation({ step, planHash: sha256Hex(JSON.stringify(payload)), repeatable,
                            metadata: { teamId: grant!.teamId, channelId: payload.channel, ...(typeof payload.ts === 'string' ? { ts: payload.ts } : {}) } },
                        signal => slackRequest(method, payload, { token, signal }));
                    }, context.deadline);
                    if (response.channel !== payload.channel || !slackTimestamp(response.ts)
                        || (typeof payload.ts === 'string' && response.ts !== payload.ts)) throw new SlackApiError(200, 'response_uncertain', undefined, false);
                    return response;
                } catch (error) {
                    if (error instanceof SlackApiError && error.definitive) await context.checkpoint(state, { clearAttempt: true });
                    throw error;
                }
            }
            if (context.mode === 'cleanup') {
                state.suppressed = true; state.baselineOnly = true; state.resume = undefined; state.missing = undefined;
                await context.checkpoint(state);
                let unreachable = false;
                let denied = false; let currentDenied = false;
                for (const target of [...(state.notifications ?? []), ...(state.retired ?? []), ...(state.root ? [state.root] : [])]) {
                    if (target.teamId !== grant.teamId) { unreachable = true; continue; }
                    try { await write('chat.delete', 'delete_message', { channel: target.channelId, ts: target.ts }, true); }
                    catch (error) {
                        if (error instanceof SlackApiError && ['not_in_channel', 'is_archived', 'channel_not_found', 'cant_delete_message', 'missing_scope'].includes(error.code)) {
                            denied = true;
                            if (target.teamId === teamId && target.channelId === channelId && error.code !== 'cant_delete_message') currentDenied = true;
                            continue;
                        }
                        if (!(error instanceof SlackApiError && error.code === 'message_not_found')) throw error;
                    }
                    if (state.root?.ts === target.ts && state.root.channelId === target.channelId) state.root = undefined;
                    state.notifications = state.notifications?.filter(item => item.ts !== target.ts || item.channelId !== target.channelId);
                    state.retired = state.retired?.filter(item => item.ts !== target.ts || item.channelId !== target.channelId);
                    await context.checkpoint(state, { clearAttempt: true });
                }
                return (state.uncertainPosts ?? []).some(post => !post.resolved) ? { status: 'ambiguous', code: 'unknown_copy_cleanup' }
                    : currentDenied ? { status: 'paused', code: 'cleanup_failed' }
                        : denied ? { status: 'ambiguous', code: 'cleanup_failed' } : unreachable ? { status: 'ambiguous', code: 'cleanup_old_workspace' }
                        : { status: 'suppressed', code: 'privacy_suppressed' };
            }
            if (!context.feedback) throw new SlackConnectionError('feedback_unavailable');
            const feedback = context.feedback.context;
            const changedDestination = state.destination && (state.destination.teamId !== teamId || state.destination.channelId !== channelId);
            if (changedDestination) {
                state.retired = [...(state.retired ?? []), ...(state.root ? [state.root] : []), ...(state.notifications ?? [])];
                state.root = undefined; state.notifications = []; state.missing = undefined; state.baselineOnly = true;
                state.lastNotifiedStatus = undefined; state.notifiedReplyIds = [];
            }
            state.destination = { generation: connection.destinationRevision, since: connection.config.since, teamId, channelId };
            const replyIds = feedback.discussion.filter(item => !item.deleted).map(item => item.id);
            const resuming = state.resume && !state.resume.completed && state.resume.destinationRevision === connection.destinationRevision;
            const historical = context.ledger.reconcileRequestId && context.ledger.requestRevision > context.ledger.processedRequestRevision
                && context.ledger.reconcileDestinationRevision === connection.destinationRevision;
            if ((state.uncertainPosts ?? []).some(post => !post.resolved)) return { status: 'ambiguous', code: 'post_uncertain' };
            const created = Date.parse(feedback.feedback?.createdAt ?? '');
            if (!state.root && ((!resuming && (state.suppressed || state.missing))
                || (!resuming && !historical && (!Number.isFinite(created) || created <= Date.parse(connection.config.since))))) {
                state.baselineOnly = true; state.lastNotifiedStatus = feedback.status; state.notifiedReplyIds = replyIds;
                await context.checkpoint(state); return { status: 'suppressed', code: state.suppressed ? 'privacy_suppressed' : state.missing ? 'message_missing' : 'historical_baseline' };
            }
            const projection = slackRootMessage(feedback, context.project.name, context.baseUrl);
            const initial = !state.root;
            if (initial) {
                const response = await write('chat.postMessage', 'post_root', { channel: channelId, ...projection.payload, reply_broadcast: false }, false);
                if (response.channel !== channelId || !slackTimestamp(response.ts)) throw new SlackApiError(200, 'response_uncertain', undefined, false);
                state.root = { ts: response.ts, teamId, channelId, payloadHash: projection.hash };
                state.suppressed = false; state.baselineOnly = false; state.missing = false;
                if (resuming) state.resume = { ...state.resume!, completed: true };
                // Initial roots include the current state; they never emit an extra historical summary.
                state.lastNotifiedStatus = feedback.status; state.notifiedReplyIds = replyIds;
                await context.checkpoint(state, { clearAttempt: true });
            } else if (state.root!.payloadHash !== projection.hash) {
                try { await write('chat.update', 'update_root', { channel: channelId, ts: state.root!.ts, ...projection.payload }, true); }
                catch (error) {
                    if (error instanceof SlackApiError && error.code === 'message_not_found') {
                        state.missingRoot = { ...state.root!, permalink: undefined };
                        state.root = undefined; state.missing = true;
                        await context.checkpoint(state, { clearAttempt: true }); return { status: 'suppressed', code: 'message_missing' };
                    }
                    throw error;
                }
                state.root = { ...state.root!, payloadHash: projection.hash };
                await context.checkpoint(state, { clearAttempt: true });
            }
            const changedStatus = connection.config.statusSummaries && state.lastNotifiedStatus !== feedback.status;
            const newReplies = connection.config.replySummaries ? replyIds.filter(id => !state.notifiedReplyIds?.includes(id)).length : 0;
            if (!initial && !state.resolvedSummary && (changedStatus || newReplies)) {
                if ((state.notifications?.length ?? 0) >= 1000) return { status: 'failed', code: 'summary_limit' };
                const summary = slackChangeSummary(changedStatus ? feedback.status : undefined, newReplies);
                const response = await write('chat.postMessage', 'post_summary', { channel: channelId, thread_ts: state.root!.ts, ...summary.payload }, false);
                if (response.channel !== channelId || !slackTimestamp(response.ts)) throw new SlackApiError(200, 'response_uncertain', undefined, false);
                state.notifications = [...(state.notifications ?? []), { ts: response.ts, teamId, channelId, payloadHash: summary.hash }];
                await context.checkpoint(state, { clearAttempt: true });
            }
            state.lastNotifiedStatus = feedback.status; state.notifiedReplyIds = replyIds; state.resolvedSummary = undefined;
            await context.checkpoint(state);
            if (!state.root!.permalink) {
                const response = await read('chat.getPermalink', { channel: channelId, message_ts: state.root!.ts });
                let link: URL;
                try { link = new URL(String(response.permalink)); } catch { throw new SlackConnectionError('invalid_permalink'); }
                if (!validSlackLink(link, connection, state.root!)) throw new SlackConnectionError('invalid_permalink');
                state.root = { ...state.root!, permalink: link.href }; await context.checkpoint(state);
            }
            return { status: 'accepted' };
        } catch (error) {
            if (error instanceof SlackRateWait) return { status: 'waiting', code: 'rate_wait', retryAt: error.retryAt };
            if (error instanceof GrantLeaseError) return { status: 'waiting', code: 'grant_busy' };
            if (error instanceof SlackConnectionError) return ['installation_busy'].includes(error.code) ? { status: 'waiting', code: error.code }
                : { status: 'needs_reconnect', code: error.code };
            if (error instanceof SlackApiError) {
                if (error.code === 'rate_limit_requires_review') return { status: 'paused', code: error.code };
                if (error.code === 'channel_ineligible') return { status: 'ambiguous', code: error.code };
                if (grant && ['token_revoked', 'invalid_auth', 'account_inactive', 'invalid_grant', 'invalid_refresh_token'].includes(error.code)) {
                    await invalidateSlackGrant(grant); return { status: 'needs_reconnect', code: error.code };
                }
                if (error.code === 'ratelimited') return { status: 'waiting', code: error.code, retryAt: new Date(Date.now() + (error.retryAfter ?? 60) * 1000).toISOString() };
                if (['not_in_channel', 'is_archived', 'channel_not_found', 'missing_scope', 'cant_update_message', 'cant_delete_message'].includes(error.code))
                    return { status: 'paused', code: context.mode === 'cleanup' ? 'cleanup_failed' : error.code };
                if (context.ledger.attempt && !context.ledger.attempt.repeatable) return { status: 'ambiguous', code: 'post_uncertain' };
                return { status: 'failed', code: error.code };
            }
            throw error;
        }
    },
    externalLink(connection, ledger) {
        const state = ledger.state as SlackState; const current = connection as SlackConnection;
        return state.root && !state.suppressed && !state.missing && state.root.teamId === current.config.teamId
            && state.root.channelId === current.config.channelId ? state.root.permalink ?? null : null;
    },
    validateExternalLink(url, connection, ledger) {
        const root = (ledger.state as SlackState).root;
        return Boolean(root && validSlackLink(url, connection as SlackConnection, root));
    }
};
