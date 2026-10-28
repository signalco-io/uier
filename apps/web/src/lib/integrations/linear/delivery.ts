import { randomUUID } from 'node:crypto';
import { sha256Hex } from '../../app/tokens';
import { getAppStore } from '../../app/store';
import { getProjectScreenshot } from '../../review/comments';
import { GrantLeaseError } from '../grants';
import type { IntegrationAdapter, IntegrationDeliveryContext, IntegrationResult, IntegrationState } from '../model';
import { bounded, field, linearGraphql, LinearApiError, mutation, object, uuid, validLinearAsset, withLinearRequest } from './client';
import { isLinearConfigured } from './config';
import { currentLinearGrant, linearAccessToken, LinearSetupError, pauseLinearGrant } from './connection';
import { linearCommentMarker, linearCommentProjection, linearIssueProjection, linearMarker } from './issue';
import type { LinearConnection, LinearDestination, LinearGrant, LinearIssueGeneration, LinearState } from './model';

type RemoteIssue = { id: string; identifier: string; url: string; description: string; creatorId: string; teamId: string;
    projectId?: string; trashed: boolean; archived: boolean; stateId: string; labelIds: string[] };
type RemoteComment = { id: string; body: string; userId: string; issueId: string };
const issueFields = 'id identifier url description creator { id } team { id } project { id } trashed archivedAt state { id } labels(first: 100) { nodes { id } }';
const commentFields = 'id body user { id } issue { id }';

function destination(connection: LinearConnection): LinearDestination {
    const value = connection.config;
    if (!uuid(value.organizationId) || !uuid(value.teamId) || !uuid(value.openStateId) || !uuid(value.doneStateId)
        || (value.projectId !== undefined && !uuid(value.projectId)) || typeof value.organizationSlug !== 'string'
        || !Array.isArray(value.labelIds) || value.labelIds.some(id => !uuid(id))) throw new LinearSetupError('mapping_invalid');
    return value as unknown as LinearDestination;
}
function issueDecoder(value: unknown): RemoteIssue {
    if (!object(value) || !uuid(value.id) || typeof value.identifier !== 'string' || typeof value.url !== 'string'
        || !object(value.creator) || !uuid(value.creator.id) || !object(value.team) || !uuid(value.team.id)
        || !object(value.state) || !uuid(value.state.id) || !object(value.labels) || !Array.isArray(value.labels.nodes)) throw new LinearApiError('invalid_issue');
    return { id: value.id, identifier: bounded(value.identifier, 100), url: value.url,
        description: typeof value.description === 'string' ? value.description : '', creatorId: value.creator.id,
        teamId: value.team.id, ...(object(value.project) && uuid(value.project.id) ? { projectId: value.project.id } : {}),
        trashed: value.trashed === true, archived: Boolean(value.archivedAt), stateId: value.state.id,
        labelIds: value.labels.nodes.map(node => { if (!object(node) || !uuid(node.id)) throw new LinearApiError('invalid_issue'); return node.id; }) };
}
function commentDecoder(value: unknown): RemoteComment {
    if (!object(value) || !uuid(value.id) || typeof value.body !== 'string' || !object(value.user) || !uuid(value.user.id)
        || !object(value.issue) || !uuid(value.issue.id)) throw new LinearApiError('invalid_comment');
    return { id: value.id, body: value.body, userId: value.user.id, issueId: value.issue.id };
}
function stateFrom(value: IntegrationState): LinearState {
    const state = structuredClone(value) as LinearState;
    if (state.issue && (!uuid(state.issue.issueId) || !uuid(state.issue.teamId) || !/^uier-source:[a-f0-9]{64}$/.test(state.issue.marker)
        || !object(state.issue.comments) || !Array.isArray(state.issue.managedLabels))) throw new LinearSetupError('invalid_ledger');
    return state;
}
function issueOwned(issue: RemoteIssue, saved: LinearIssueGeneration, grant: LinearGrant) {
    if (issue.id !== saved.issueId || issue.creatorId !== (saved.appUserId ?? grant.appUserId) || issue.teamId !== saved.teamId
        || issue.projectId !== saved.projectId || (!issue.description.includes(saved.marker) && !saved.scrubbed)) throw new LinearSetupError('external_issue_changed');
}
function commentOwned(comment: RemoteComment, issue: LinearIssueGeneration, itemId: string, grant: LinearGrant) {
    if (comment.issueId !== issue.issueId || comment.userId !== (issue.appUserId ?? grant.appUserId) || !comment.body.includes(linearCommentMarker(issue, itemId)))
        throw new LinearSetupError('external_comment_changed');
}
function validIssueUrl(value: string, config: LinearDestination, identifier?: string) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'linear.app' && !url.username && !url.password && !url.search && !url.hash
        && url.pathname.startsWith(`/${config.organizationSlug}/issue/`) && (!identifier || url.pathname.split('/')[3]?.toUpperCase() === identifier.toUpperCase()
            || url.pathname.split('/')[3]?.toUpperCase().startsWith(identifier.toUpperCase() + '-') === true); } catch { return false; }
}

async function deliver(context: IntegrationDeliveryContext): Promise<IntegrationResult> {
    const connection = context.connection as LinearConnection;
    let grant: LinearGrant | undefined;
    try {
        const config = destination(connection);
        grant = await currentLinearGrant(connection);
        if (grant.organizationId !== config.organizationId) return { status: 'paused', code: 'organization_changed' };
        let token = await linearAccessToken(connection, send => context.read(send));
        let bucketKey = `${grant.clientId}:${grant.appUserId}`;
        const paceSignal = () => AbortSignal.timeout(Math.max(1, context.deadline - Date.now()));
        const state = stateFrom(context.ledger.state);
        const checkpoint = async (clearAttempt = false) => context.checkpoint(state, { clearAttempt });
        const currentGrant = grant;
        for (const saved of [...(state.retired ?? []), ...(state.issue ? [state.issue] : [])]) {
            saved.grantId ??= currentGrant.id; saved.organizationId ??= currentGrant.organizationId; saved.appUserId ??= currentGrant.appUserId;
        }
        const useAuthority = async (saved?: LinearIssueGeneration) => {
            const authority = saved?.grantId && saved.grantId !== connection.grantId ? { ...connection, grantId: saved.grantId } : connection;
            grant = await currentLinearGrant(authority);
            if (saved?.organizationId && saved.organizationId !== grant.organizationId) throw new LinearSetupError('cleanup_authority_unavailable');
            token = await linearAccessToken(authority, send => context.read(send)); bucketKey = `${grant.clientId}:${grant.appUserId}`;
        };
        const read = async <T>(name: string, query: string, variables: Record<string, unknown>, decode: (data: Record<string, unknown>) => T) =>
            withLinearRequest(bucketKey, paceSignal(), () => context.read(signal => linearGraphql(token, name, query, variables, decode, signal, { paced: true, bucketKey })));
        const write = async <T>(step: string, name: string, query: string, variables: Record<string, unknown>, decode: (data: Record<string, unknown>) => T,
            metadata: IntegrationState = {}, repeatable = true) => withLinearRequest(bucketKey, paceSignal(), async () => {
                try { return await context.operation({ step, planHash: sha256Hex(JSON.stringify({ name, variables })), metadata, repeatable },
                    signal => linearGraphql(token, name, query, variables, decode, signal, { paced: true, bucketKey })); }
                catch (error) { if (error instanceof LinearApiError && error.definitive) await checkpoint(true); throw error; }
            });
        const maybeIssue = async (id: string) => {
            try { return await read('UierLinearIssue', `query UierLinearIssue($id: String!) { issue(id: $id) { ${issueFields} } }`, { id }, data => issueDecoder(data.issue)); }
            catch (error) { if (error instanceof LinearApiError && error.code === 'not_found' && error.definitive) return null; throw error; }
        };
        const maybeComment = async (id: string) => {
            try { return await read('UierLinearComment', `query UierLinearComment($id: String!) { comment(id: $id) { ${commentFields} } }`, { id }, data => commentDecoder(data.comment)); }
            catch (error) { if (error instanceof LinearApiError && error.code === 'not_found' && error.definitive) return null; throw error; }
        };
        if (context.mode === 'sync') await read('UierLinearDestination', 'query UierLinearDestination($teamId: String!, $openId: String!, $doneId: String!) { team(id: $teamId) { id archivedAt organization { id } } open: workflowState(id: $openId) { id archivedAt type team { id } } done: workflowState(id: $doneId) { id archivedAt type team { id } } }',
            { teamId: config.teamId, openId: config.openStateId, doneId: config.doneStateId }, data => {
                const team = field(data, 'team'); const organization = field(team, 'organization');
                if (team.id !== config.teamId || organization.id !== grant!.organizationId || team.archivedAt) throw new LinearSetupError('destination_unavailable');
                if (context.mode === 'sync') for (const [key, id, types] of [['open', config.openStateId, ['triage', 'backlog', 'unstarted', 'started']], ['done', config.doneStateId, ['completed', 'canceled']]] as const) {
                    const workflow = field(data, key); const workflowTeam = field(workflow, 'team');
                    if (workflow.id !== id || workflowTeam.id !== config.teamId || workflow.archivedAt || !types.some(type => type === workflow.type)) throw new LinearSetupError('mapping_invalid');
                }
                return true;
            });

        // Reconcile a previous process's operation before planning any new create, including cleanup.
        const attempt = context.ledger.attempt;
        if (attempt && context.mode === 'cleanup') {
            // Exact issue/comment ids are already reserved. Cleanup supersedes their content writes;
            // uncertainty about one target must not prevent scrubbing every other known copy.
            const saved = state.issue;
            if (attempt.step === 'create_issue' && saved) saved.createUncertain = true;
            if (attempt.step === 'create_comment' && saved && typeof attempt.metadata.itemId === 'string') {
                const item = saved.comments[attempt.metadata.itemId]; if (item) item.uncertain = true;
            }
            if (attempt.step === 'upload_screenshot' && saved?.screenshot)
                saved.uncertainUpload = { revision: saved.screenshot.revision, assetUrl: saved.screenshot.assetUrl };
            await checkpoint(true);
        } else if (attempt) {
            let available = true;
            try { await useAuthority(state.issue); }
            catch (error) {
                if (!state.issue || state.issue.grantId === connection.grantId || !(error instanceof LinearSetupError)) throw error;
                available = false;
                if (attempt.step === 'create_issue') state.issue.createUncertain = true;
                else if (attempt.step === 'create_comment' && typeof attempt.metadata.itemId === 'string') {
                    const item = state.issue.comments[attempt.metadata.itemId]; if (item) item.uncertain = true;
                } else if (attempt.step === 'upload_screenshot' && state.issue.screenshot)
                    state.issue.uncertainUpload = { revision: state.issue.screenshot.revision, assetUrl: state.issue.screenshot.assetUrl };
                else if (!attempt.repeatable) return { status: 'ambiguous', code: 'unrecognized_operation' };
                await checkpoint(true);
            }
            if (available) {
                if (attempt.step === 'create_issue') {
                    const saved = state.issue;
                    if (!saved || attempt.metadata.issueId !== saved.issueId) return { status: 'ambiguous', code: 'operation_identity_changed' };
                    const remote = await maybeIssue(saved.issueId);
                    if (remote) { issueOwned(remote, saved, grant); saved.identifier = remote.identifier; saved.url = remote.url; }
                    // A retry reserves the same UUID, never a second object identity.
                    await checkpoint(true);
                } else if (attempt.step === 'create_comment') {
                    const saved = state.issue;
                    const itemId = typeof attempt.metadata.itemId === 'string' ? attempt.metadata.itemId : '';
                    const item = saved?.comments[itemId];
                    if (!saved || !item || attempt.metadata.commentId !== item.id) return { status: 'ambiguous', code: 'operation_identity_changed' };
                    const remote = await maybeComment(item.id);
                    if (remote) commentOwned(remote, saved, itemId, grant);
                    await checkpoint(true);
                } else if (attempt.step === 'upload_screenshot') {
                    const saved = state.issue;
                    if (!saved?.screenshot || attempt.metadata.assetUrl !== saved.screenshot.assetUrl) return { status: 'ambiguous', code: 'upload_identity_changed' };
                    const exists = await probeAsset(saved.screenshot.assetUrl, token, context);
                    if (!exists) return { status: 'ambiguous', code: 'upload_reconciliation_pending' };
                    saved.screenshot.uploaded = true;
                    await checkpoint(true);
                } else {
                    // Known-id update/delete/upload-preparation operations are safe to project again.
                    if (!attempt.repeatable) return { status: 'ambiguous', code: 'unrecognized_operation' };
                    await checkpoint(true);
                }
            }
        }

        if (context.mode === 'cleanup') {
            let blocked = false;
            for (const saved of [...(state.issue ? [state.issue] : []), ...(state.retired ?? [])]) {
                if (saved.cleaned) { if (saved.uncertainUpload || saved.createUncertain || Object.values(saved.comments).some(item => item.uncertain)) blocked = true; continue; }
                try {
                    if (!saved.cleanupStarted) { saved.cleanupStarted = true; await checkpoint(); }
                    await useAuthority(saved);
                    const remote = await maybeIssue(saved.issueId);
                    if (!remote) {
                        if (saved.createUncertain || (!saved.scrubbed && saved.identifier)) { blocked = true; continue; }
                        saved.trashed = true; saved.cleaned = true; await checkpoint(); continue;
                    }
                    issueOwned(remote, saved, grant!); saved.createUncertain = false;
                    let restored = false;
                    if (remote.trashed && (!saved.scrubbed || Object.values(saved.comments).some(item => !item.deleted))) {
                        await write('restore_issue', 'UierLinearIssueUpdate', 'mutation UierLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }',
                            { id: saved.issueId, input: { trashed: false } }, data => { const result = mutation(data, 'issueUpdate'); if (field(result, 'issue').id !== saved.issueId) throw new LinearApiError('invalid_response'); return true; }, { issueId: saved.issueId });
                        restored = true; saved.trashed = false; await checkpoint(true);
                    }
                    if (!saved.scrubbed) {
                        await write('scrub_issue', 'UierLinearIssueUpdate', 'mutation UierLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }',
                            { id: saved.issueId, input: { title: 'Removed from uier', description: `This feedback was removed from uier.\n\n${saved.marker}`, removedLabelIds: saved.managedLabels } },
                            data => { const result = mutation(data, 'issueUpdate'); if (field(result, 'issue').id !== saved.issueId) throw new LinearApiError('invalid_response'); return true; }, { issueId: saved.issueId });
                        saved.scrubbed = true; await checkpoint(true);
                    }
                    for (const [itemId, item] of Object.entries(saved.comments)) {
                        if (item.deleted) continue;
                        try {
                            const comment = await maybeComment(item.id);
                            if (comment) {
                                commentOwned(comment, saved, itemId, grant!);
                                await write('delete_comment', 'UierLinearCommentDelete', 'mutation UierLinearCommentDelete($id: String!) { commentDelete(id: $id) { success } }', { id: item.id },
                                    data => { mutation(data, 'commentDelete'); return true; }, { commentId: item.id });
                                item.uncertain = false;
                            } else if (item.uncertain) { blocked = true; continue; }
                            item.deleted = true; await checkpoint(true);
                        } catch (error) {
                            if (error instanceof LinearSetupError || error instanceof LinearApiError && (['forbidden', 'not_found'].includes(error.code)
                                || (saved.grantId !== connection.grantId && ['unauthenticated', 'invalid_grant', 'invalid_client'].includes(error.code)))) { blocked = true; continue; } throw error;
                        }
                    }
                    if (!remote.trashed || restored) await write('trash_issue', 'UierLinearIssueDelete', 'mutation UierLinearIssueDelete($id: String!) { issueDelete(id: $id, permanentlyDelete: false) { success } }',
                        { id: saved.issueId }, data => { mutation(data, 'issueDelete'); return true; }, { issueId: saved.issueId });
                    saved.trashed = true; saved.cleaned = Object.values(saved.comments).every(item => item.deleted && !item.uncertain); saved.url = undefined;
                    if (saved.uncertainUpload) blocked = true;
                    await checkpoint(true);
                } catch (error) {
                    if (error instanceof LinearSetupError || error instanceof LinearApiError && (['forbidden', 'not_found'].includes(error.code)
                                || (saved.grantId !== connection.grantId && ['unauthenticated', 'invalid_grant', 'invalid_client'].includes(error.code)))) { blocked = true; continue; } throw error;
                }
            }
            return blocked ? { status: 'ambiguous', code: 'cleanup_incomplete' } : { status: 'accepted' };
        }
        await useAuthority();
        if (!context.feedback) return { status: 'failed', code: 'feedback_unavailable' };
        if (state.issue && (state.issue.cleaned || state.issue.cleanupStarted || state.issue.grantId !== connection.grantId || state.issue.teamId !== config.teamId || state.issue.projectId !== config.projectId)) { state.retired = [...(state.retired ?? []), state.issue]; state.issue = undefined; }
        if (!state.issue) {
            const generation = (state.visibilityGeneration ?? 0) + 1;
            state.visibilityGeneration = generation;
            state.issue = { generation, issueId: randomUUID(), marker: linearMarker(connection.id, context.project.id, context.ledger.threadId, generation),
                teamId: config.teamId, projectId: config.projectId, grantId: grant!.id, organizationId: grant!.organizationId, appUserId: grant!.appUserId, destinationRevision: connection.destinationRevision, managedLabels: [], comments: {} };
            await checkpoint();
        }
        const saved = state.issue;
        if (saved.teamId !== config.teamId || saved.projectId !== config.projectId) return { status: 'paused', code: 'destination_changed' };
        let remote = await maybeIssue(saved.issueId);
        if (remote) {
            issueOwned(remote, saved, grant);
            if (remote.trashed || remote.archived) return { status: 'paused', code: 'issue_removed_in_linear' };
            saved.identifier = remote.identifier; saved.url = remote.url;
        } else if (saved.identifier) return { status: 'paused', code: 'issue_missing_in_linear' };
        if (config.screenshots && context.feedback.context.screenshot.state === 'protected') {
            await uploadScreenshot(saved, context, connection, token, write, checkpoint);
        } else if (saved.screenshot) { saved.screenshot = undefined; await checkpoint(); }
        const projection = linearIssueProjection(context.feedback.context, saved);
        const stateId = context.feedback.context.status === 'done' ? config.doneStateId : config.openStateId;
        const payload = { title: projection.title, description: projection.description, stateId };
        const bodyHash = sha256Hex(JSON.stringify(payload));
        if (!remote) {
            remote = await write('create_issue', 'UierLinearIssueCreate', `mutation UierLinearIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${issueFields} } } }`,
                { input: { id: saved.issueId, teamId: config.teamId, ...(config.projectId ? { projectId: config.projectId } : {}), ...payload, labelIds: config.labelIds } },
                data => issueDecoder(mutation(data, 'issueCreate').issue), { issueId: saved.issueId }, false);
            issueOwned(remote, saved, grant);
            saved.identifier = remote.identifier; saved.url = remote.url; saved.bodyHash = bodyHash; saved.stateId = stateId; saved.managedLabels = config.labelIds;
            await checkpoint(true);
        } else if (saved.bodyHash !== bodyHash || JSON.stringify(saved.managedLabels) !== JSON.stringify(config.labelIds)) {
            await write('update_issue', 'UierLinearIssueUpdate', 'mutation UierLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }',
                { id: saved.issueId, input: { ...payload, addedLabelIds: config.labelIds.filter(id => !remote!.labelIds.includes(id)),
                    removedLabelIds: saved.managedLabels.filter(id => !config.labelIds.includes(id)) } },
                data => { const result = mutation(data, 'issueUpdate'); if (field(result, 'issue').id !== saved.issueId) throw new LinearApiError('invalid_response'); return true; }, { issueId: saved.issueId });
            saved.bodyHash = bodyHash; saved.stateId = stateId; saved.managedLabels = config.labelIds; await checkpoint(true);
        }
        if (saved.url && !validIssueUrl(saved.url, config, saved.identifier)) return { status: 'paused', code: 'invalid_issue_url' };
        const discussion = new Map(context.feedback.context.discussion.map(item => [item.id, item]));
        for (const [itemId, item] of Object.entries(saved.comments)) {
            if (discussion.get(itemId) && !discussion.get(itemId)!.deleted || item.deleted) continue;
            const comment = await maybeComment(item.id);
            if (comment) {
                commentOwned(comment, saved, itemId, grant);
                await write('delete_comment', 'UierLinearCommentDelete', 'mutation UierLinearCommentDelete($id: String!) { commentDelete(id: $id) { success } }',
                    { id: item.id }, data => { mutation(data, 'commentDelete'); return true; }, { commentId: item.id });
            }
            item.deleted = true; await checkpoint(true);
        }
        for (const message of context.feedback.context.discussion) {
            if (message.deleted) continue;
            let item = saved.comments[message.id];
            if (!item || item.deleted) { item = { id: randomUUID() }; saved.comments[message.id] = item; await checkpoint(); }
            const body = linearCommentProjection(message, linearCommentMarker(saved, message.id));
            const textHash = sha256Hex(body);
            const existing = await maybeComment(item.id);
            if (existing) commentOwned(existing, saved, message.id, grant);
            if (!existing) {
                if (item.hash) return { status: 'paused', code: 'comment_missing_in_linear' };
                const created = await write('create_comment', 'UierLinearCommentCreate', `mutation UierLinearCommentCreate($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${commentFields} } } }`,
                    { input: { id: item.id, issueId: saved.issueId, body } }, data => commentDecoder(mutation(data, 'commentCreate').comment),
                    { issueId: saved.issueId, itemId: message.id, commentId: item.id }, false);
                commentOwned(created, saved, message.id, grant);
                item.hash = textHash; await checkpoint(true);
            } else if (item.hash !== textHash) {
                await write('update_comment', 'UierLinearCommentUpdate', 'mutation UierLinearCommentUpdate($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { id } } }',
                    { id: item.id, input: { body } }, data => { const result = mutation(data, 'commentUpdate'); if (field(result, 'comment').id !== item!.id) throw new LinearApiError('invalid_response'); return true; }, { commentId: item.id });
                item.hash = textHash; await checkpoint(true);
            }
        }
        saved.destinationRevision = connection.destinationRevision;
        await checkpoint();
        return { status: 'accepted', ...(projection.truncated ? { code: 'content_truncated' } : {}) };
    } catch (error) {
        if (error instanceof LinearApiError) {
            if (error.definitive && context.ledger.attempt) await context.checkpoint(context.ledger.state, { clearAttempt: true });
            if (error.code === 'rate_limited') { if (grant && error.retryAt) await pauseLinearGrant(grant, error.retryAt); return { status: 'waiting', code: 'rate_limited', retryAt: error.retryAt }; }
            if (error.code === 'unauthenticated') {
                try { await linearAccessToken(connection, send => context.read(send), true); return { status: 'waiting', code: 'credentials_refreshed' }; }
                catch (refreshError) {
                    if (refreshError instanceof GrantLeaseError) return { status: 'waiting', code: 'refresh_busy' };
                    if (refreshError instanceof LinearApiError && ['invalid_grant', 'invalid_client'].includes(refreshError.code)
                        || refreshError instanceof LinearSetupError && ['needs_reconnect', 'refresh_recovery_expired', 'grant_unavailable'].includes(refreshError.code))
                        return { status: 'needs_reconnect', code: 'needs_reconnect' };
                    // Preserve the original rotating pair and its replay marker after a lost response.
                    return { status: 'waiting', code: 'credential_refresh_pending' };
                }
            }
            if (['invalid_grant', 'invalid_client'].includes(error.code)) return { status: 'needs_reconnect', code: 'needs_reconnect' };
            if (['forbidden', 'not_found'].includes(error.code)) return { status: 'paused', code: 'destination_unavailable' };
            if (context.ledger.attempt && !context.ledger.attempt.repeatable) return { status: 'waiting', code: 'reconcile_pending' };
            return { status: 'failed', code: error.code };
        }
        if (error instanceof GrantLeaseError) return { status: 'waiting', code: 'refresh_busy' };
        if (error instanceof LinearSetupError && error.code === 'screenshot_changed') return { status: 'waiting', code: 'screenshot_changed' };
        if (error instanceof LinearSetupError) return { status: error.code === 'needs_reconnect' || error.code === 'grant_unavailable' ? 'needs_reconnect' : 'paused', code: error.code };
        throw error;
    }
}

type Writer = <T>(step: string, name: string, query: string, variables: Record<string, unknown>, decode: (data: Record<string, unknown>) => T,
    metadata?: IntegrationState, repeatable?: boolean) => Promise<T>;
async function probeAsset(url: string, token: string, context: IntegrationDeliveryContext) {
    if (!validLinearAsset(url)) throw new LinearSetupError('invalid_asset_url');
    return context.read(async signal => {
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal, headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-0' } });
        await response.body?.cancel();
        if (response.status === 404) return false;
        if (!response.ok) throw new LinearApiError('asset_unavailable', response.status);
        return true;
    });
}
async function uploadScreenshot(saved: LinearIssueGeneration, context: IntegrationDeliveryContext, connection: LinearConnection,
    token: string, write: Writer, checkpoint: (clearAttempt?: boolean) => Promise<void>) {
    const reference = context.feedback!.context.screenshot;
    if (reference.state !== 'protected') return;
    const actor = { kind: 'member' as const, userId: connection.connectedBy, name: 'uier integration', isAdmin: true };
    const screenshot = await context.read(async () => getProjectScreenshot(context.project, actor, context.ledger.threadId));
    const revision = screenshot.revision ?? sha256Hex(screenshot.data);
    if (reference.revision && reference.revision !== revision) throw new LinearSetupError('screenshot_changed');
    if (saved.screenshot?.revision === revision && saved.screenshot.uploaded) return;
    const data = Buffer.from(screenshot.data, 'base64');
    if (data.length > 512 * 1024) throw new LinearSetupError('screenshot_too_large');
    const upload = await write('prepare_upload', 'UierLinearFileUpload', 'mutation UierLinearFileUpload($contentType: String!, $filename: String!, $size: Int!) { fileUpload(contentType: $contentType, filename: $filename, size: $size, makePublic: false) { success uploadFile { uploadUrl assetUrl headers { key value } } } }',
        { contentType: screenshot.contentType, filename: `uier-screenshot.${screenshot.contentType.split('/')[1]}`, size: data.length }, value => {
            const result = mutation(value, 'fileUpload'); const file = field(result, 'uploadFile');
            if (!validLinearAsset(file.uploadUrl, true) || !validLinearAsset(file.assetUrl) || !Array.isArray(file.headers)) throw new LinearApiError('invalid_upload_response');
            const headers = new Headers({ 'Content-Type': screenshot.contentType });
            for (const header of file.headers) {
                if (!object(header) || typeof header.key !== 'string' || typeof header.value !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(header.key)
                    || ['authorization', 'cookie', 'host', 'connection'].includes(header.key.toLowerCase()) || /[\r\n]/.test(header.value)) throw new LinearApiError('invalid_upload_response');
                headers.set(header.key, header.value);
            }
            return { uploadUrl: new URL(file.uploadUrl).href, assetUrl: new URL(file.assetUrl).href, headers };
        }, { revision });
    saved.screenshot = { revision, assetUrl: upload.assetUrl, uploaded: false };
    await checkpoint(true);
    await context.operation({ step: 'upload_screenshot', planHash: sha256Hex(`${revision}:${upload.assetUrl}`), metadata: { revision, assetUrl: upload.assetUrl } }, async signal => {
        const response = await fetch(upload.uploadUrl, { method: 'PUT', redirect: 'error', signal, headers: upload.headers, body: new Uint8Array(data) });
        if (!response.ok) throw new LinearApiError('upload_failed', response.status, undefined, undefined, response.status < 500);
    });
    saved.screenshot.uploaded = true;
    await checkpoint(true);
}

export const linearAdapter: IntegrationAdapter = { provider: 'linear', isConfigured: isLinearConfigured, maxRunMs: 5 * 60_000, maxCalls: 100,
    deliver, externalLink(connection, ledger) {
        const state = stateFrom(ledger.state); const issue = state.issue;
        if (!issue?.url || issue.trashed || issue.cleaned || !issue.identifier) return null;
        const config = destination(connection as LinearConnection);
        return issue.teamId === config.teamId && issue.projectId === config.projectId && validIssueUrl(issue.url, config, issue.identifier) ? issue.url : null;
    }, validateExternalLink(url, connection, ledger) {
        const state = stateFrom(ledger.state); const config = destination(connection as LinearConnection);
        return Boolean(state.issue?.identifier && validIssueUrl(url.href, config, state.issue.identifier));
    }, async revokeAdmin(workspaceId) {
        const { wipeUnusedLinearGrant } = await import('./connection');
        for (const grant of await getAppStore().query<LinearGrant>({ type: 'linear-grant', pk: `workspace:${workspaceId}` }))
            await wipeUnusedLinearGrant(workspaceId, grant.id);
    } };
