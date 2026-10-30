import { sha256Hex } from '../../app/tokens';
import { GrantLeaseError } from '../grants';
import type { IntegrationAdapter, IntegrationDeliveryContext, IntegrationResult, IntegrationState } from '../model';
import { AzureDevOpsApiError, azureDevOpsRequest, azureDevOpsUrl, object, withAzureDevOpsRequest, type AzureDevOpsResponse } from './client';
import { guid, isAzureDevOpsConfigured, validOrganization } from './config';
import { azureDevOpsAccessToken, AzureDevOpsSetupError, currentAzureDevOpsGrant, pauseAzureDevOpsGrant } from './connection';
import type { AzureDevOpsConnection, AzureDevOpsDestination, AzureDevOpsGrant, AzureDevOpsState, AzureDevOpsWorkItem } from './model';
import { azureDevOpsMarker, azureDevOpsProjection, removedProjection } from './workItem';

type RemoteWorkItem = { id: number; projectName: string; type: string; state: string; body: string };
const bodyFields = ['System.Description', 'Microsoft.VSTS.TCM.ReproSteps'];
/** A create that left without a response may still commit; after this long an empty search means it did not. */
const CREATE_SETTLE_MS = 2 * 60_000;

function destination(connection: AzureDevOpsConnection): AzureDevOpsDestination {
    const value = connection.config;
    if (!validOrganization(value.organization) || !guid(value.organizationId) || !guid(value.projectId) || typeof value.projectName !== 'string'
        || typeof value.workItemType !== 'string' || !bodyFields.includes(value.bodyField as string) || typeof value.openState !== 'string'
        || typeof value.doneState !== 'string' || (value.areaPath !== undefined && typeof value.areaPath !== 'string')) throw new AzureDevOpsSetupError('mapping_invalid');
    return value as unknown as AzureDevOpsDestination;
}
function stateFrom(value: IntegrationState): AzureDevOpsState {
    const state = structuredClone(value) as AzureDevOpsState;
    for (const copy of [...(state.item ? [state.item] : []), ...(state.retired ?? [])])
        if (!/^uier-source:[a-f0-9]{64}$/.test(copy.marker) || !validOrganization(copy.organization) || !guid(copy.projectId)
            || (copy.id !== undefined && (!Number.isSafeInteger(copy.id) || copy.id <= 0)) || !bodyFields.includes(copy.bodyField)) throw new AzureDevOpsSetupError('invalid_ledger');
    if (state.retired !== undefined && (!Array.isArray(state.retired) || state.retired.length > 20)) throw new AzureDevOpsSetupError('invalid_ledger');
    return state;
}
function workItemDecoder(bodyField: string) {
    return ({ body }: AzureDevOpsResponse): RemoteWorkItem => {
        if (!object(body) || !Number.isSafeInteger(body.id) || (body.id as number) <= 0 || !object(body.fields)) throw new AzureDevOpsApiError('invalid_work_item');
        const fields = body.fields;
        if (typeof fields['System.TeamProject'] !== 'string' || typeof fields['System.WorkItemType'] !== 'string' || typeof fields['System.State'] !== 'string')
            throw new AzureDevOpsApiError('invalid_work_item');
        return { id: body.id as number, projectName: fields['System.TeamProject'], type: fields['System.WorkItemType'], state: fields['System.State'],
            body: typeof fields[bodyField] === 'string' ? fields[bodyField] : '' };
    };
}
export const azureDevOpsWorkItemUrl = (organization: string, id: number) => `https://dev.azure.com/${organization}/_workitems/edit/${id}`;

async function deliver(context: IntegrationDeliveryContext): Promise<IntegrationResult> {
    const connection = context.connection as AzureDevOpsConnection;
    let grant: AzureDevOpsGrant | undefined;
    try {
        grant = await currentAzureDevOpsGrant(connection);
        const bucketKey = `grant:${grant.id}`;
        let token = await azureDevOpsAccessToken(connection, send => context.read(send));
        const paceSignal = () => AbortSignal.timeout(Math.max(1, context.deadline - Date.now()));
        const state = stateFrom(context.ledger.state);
        const checkpoint = async (clearAttempt = false) => context.checkpoint(state, { clearAttempt });
        const read = <T>(url: string, decode: (response: AzureDevOpsResponse) => T, method: 'GET' | 'POST' = 'GET', body?: unknown) =>
            withAzureDevOpsRequest(bucketKey, paceSignal(), () => context.read(signal => azureDevOpsRequest(token, url, { method, body, signal, bucketKey, paced: true }, decode)));
        const write = <T>(step: string, method: 'POST' | 'PATCH' | 'DELETE', url: string, body: unknown, decode: (response: AzureDevOpsResponse) => T,
            metadata: IntegrationState = {}, repeatable = true) => withAzureDevOpsRequest(bucketKey, paceSignal(), async () => {
            try {
                return await context.operation({ step, planHash: sha256Hex(JSON.stringify({ method, url, body })), metadata, repeatable },
                    signal => azureDevOpsRequest(token, url, { method, body, patch: body !== undefined, signal, bucketKey, paced: true }, decode));
            } catch (error) { if (error instanceof AzureDevOpsApiError && error.definitive) await checkpoint(true); throw error; }
        });
        const fieldList = (copy: AzureDevOpsWorkItem) => ['System.Id', 'System.TeamProject', 'System.WorkItemType', 'System.State', copy.bodyField].join(',');
        const maybeWorkItem = async (copy: AzureDevOpsWorkItem) => {
            try { return await read(azureDevOpsUrl(copy.organization, `_apis/wit/workitems/${copy.id}`, { fields: fieldList(copy) }), workItemDecoder(copy.bodyField)); }
            catch (error) { if (error instanceof AzureDevOpsApiError && error.code === 'not_found') return null; throw error; }
        };
        /** Same work item, project and type as saved. A renamed project is matched through its id. */
        const owned = async (remote: RemoteWorkItem, copy: AzureDevOpsWorkItem) => {
            if (remote.id !== copy.id || remote.type !== copy.workItemType) throw new AzureDevOpsSetupError('external_work_item_changed');
            if (remote.projectName === copy.projectName) return;
            const current = await read(azureDevOpsUrl(copy.organization, `_apis/projects/${copy.projectId}`),
                ({ body }) => object(body) && typeof body.name === 'string' ? body.name : '');
            if (current !== remote.projectName) throw new AzureDevOpsSetupError('external_work_item_changed');
            copy.projectName = current;
        };
        /** Finds a create whose response was lost by its marker, among the work items created around that time. */
        const reconcile = async (copy: AzureDevOpsWorkItem): Promise<number | 'absent' | 'pending'> => {
            const started = Date.parse(copy.createStartedAt ?? '');
            if (!Number.isFinite(started)) return 'absent';
            const since = new Date(started - 5 * 60_000).toISOString(), until = new Date(started + 15 * 60_000).toISOString();
            const matches = new Set<number>();
            let after = 0;
            for (let page = 0; ; page++) {
                if (page >= 5) throw new AzureDevOpsSetupError('reconciliation_limit');
                const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = '${copy.workItemType.replace(/'/g, "''")}'`
                    + ` AND [System.CreatedDate] >= '${since}' AND [System.CreatedDate] <= '${until}' AND [System.Id] > ${after} ORDER BY [System.Id]`;
                const ids = await read(azureDevOpsUrl(copy.organization, `${copy.projectId}/_apis/wit/wiql`, { timePrecision: 'true', $top: '200' }), ({ body }) => {
                    if (!object(body) || !Array.isArray(body.workItems)) throw new AzureDevOpsApiError('invalid_response');
                    return body.workItems.map(item => { if (!object(item) || !Number.isSafeInteger(item.id)) throw new AzureDevOpsApiError('invalid_response'); return item.id as number; });
                }, 'POST', { query });
                if (!ids.length) break;
                const bodies = await read(azureDevOpsUrl(copy.organization, `${copy.projectId}/_apis/wit/workitemsbatch`), ({ body }) => {
                    if (!object(body) || !Array.isArray(body.value)) throw new AzureDevOpsApiError('invalid_response');
                    return body.value.flatMap(item => object(item) && Number.isSafeInteger(item.id) && object(item.fields)
                        ? [{ id: item.id as number, body: String(item.fields[copy.bodyField] ?? '') }] : []);
                }, 'POST', { ids, fields: ['System.Id', copy.bodyField], errorPolicy: 'omit' });
                for (const item of bodies) if (item.body.includes(copy.marker)) matches.add(item.id);
                after = Math.max(...ids);
                if (ids.length < 200) break;
            }
            if (matches.size > 1) throw new AzureDevOpsSetupError('duplicate_work_items');
            if (matches.size === 1) return [...matches][0]!;
            return Date.now() - started < CREATE_SETTLE_MS ? 'pending' : 'absent';
        };
        const settleAt = (copy: AzureDevOpsWorkItem) => new Date(Date.parse(copy.createStartedAt ?? '') + CREATE_SETTLE_MS).toISOString();

        // Reconcile a previous run's operation before planning anything else, including cleanup.
        const attempt = context.ledger.attempt;
        if (attempt) {
            const copy = state.item;
            if (attempt.step === 'create_work_item') {
                if (!copy || attempt.metadata.generation !== copy.generation) return { status: 'ambiguous', code: 'operation_identity_changed' };
                if (context.mode === 'cleanup') copy.createUncertain = true;
                else {
                    const found = await reconcile(copy);
                    if (found === 'pending') return { status: 'waiting', code: 'reconciling_previous_operation', retryAt: settleAt(copy) };
                    if (found !== 'absent') copy.id = found;
                    copy.createStartedAt = undefined;
                }
            } else if (!attempt.repeatable) return { status: 'ambiguous', code: 'unrecognized_operation' };
            // Known-id updates and deletes are planned again from the current state.
            await checkpoint(true);
        }

        if (context.mode === 'cleanup') {
            let blocked = false; let waitUntil: string | undefined;
            for (const copy of [...(state.item ? [state.item] : []), ...(state.retired ?? [])]) {
                if (copy.cleaned) continue;
                try {
                    if (!copy.cleanupStarted) { copy.cleanupStarted = true; await checkpoint(); }
                    if (copy.createUncertain || (!copy.id && copy.createStartedAt)) {
                        const found = await reconcile(copy);
                        if (found === 'pending') { waitUntil = settleAt(copy); continue; }
                        if (found !== 'absent') copy.id = found;
                        copy.createUncertain = false; copy.createStartedAt = undefined; await checkpoint();
                    }
                    if (!copy.id) { copy.cleaned = true; await checkpoint(); continue; }
                    const remote = await maybeWorkItem(copy);
                    if (!remote) {
                        // Missing and inaccessible look alike: only a scrubbed copy can be called cleaned.
                        if (!copy.scrubbed) { blocked = true; continue; }
                        copy.deleted = true; copy.cleaned = true; await checkpoint(); continue;
                    }
                    await owned(remote, copy);
                    if (!copy.scrubbed) {
                        const removed = removedProjection(copy.marker);
                        await write('scrub_work_item', 'PATCH', azureDevOpsUrl(copy.organization, `_apis/wit/workitems/${copy.id}`),
                            [{ op: 'add', path: '/fields/System.Title', value: removed.title }, { op: 'add', path: `/fields/${copy.bodyField}`, value: removed.html }],
                            workItemDecoder(copy.bodyField), { workItemId: copy.id });
                        copy.scrubbed = true; await checkpoint(true);
                    }
                    // Moves the work item to the project's recycle bin; it is never destroyed permanently.
                    await write('delete_work_item', 'DELETE', azureDevOpsUrl(copy.organization, `_apis/wit/workitems/${copy.id}`), undefined, () => true, { workItemId: copy.id });
                    copy.deleted = true; copy.cleaned = true; await checkpoint(true);
                } catch (error) {
                    if (error instanceof AzureDevOpsSetupError || error instanceof AzureDevOpsApiError && ['forbidden', 'not_found', 'bad_request'].includes(error.code)) {
                        blocked = true; continue;
                    }
                    throw error;
                }
            }
            if (waitUntil) return { status: 'waiting', code: 'reconciling_cleanup', retryAt: waitUntil };
            return blocked ? { status: 'ambiguous', code: 'cleanup_incomplete' } : { status: 'accepted' };
        }

        if (!context.feedback) return { status: 'failed', code: 'feedback_unavailable' };
        const config = destination(connection);
        if (state.item && (state.item.cleaned || state.item.cleanupStarted || state.item.organization !== config.organization
            || state.item.projectId !== config.projectId || state.item.workItemType !== config.workItemType)) {
            // A new destination or visibility generation never retargets an earlier copy.
            if ((state.retired?.length ?? 0) >= 20) return { status: 'ambiguous', code: 'destination_history_limit' };
            state.retired = [...(state.retired ?? []), state.item]; state.item = undefined;
        }
        if (!state.item) {
            const generation = (state.visibilityGeneration ?? 0) + 1;
            state.visibilityGeneration = generation;
            state.item = { generation, marker: azureDevOpsMarker(connection.id, context.project.id, context.ledger.threadId, generation),
                organization: config.organization, projectId: config.projectId, projectName: config.projectName, workItemType: config.workItemType,
                bodyField: config.bodyField, destinationRevision: connection.destinationRevision };
            await checkpoint();
        }
        const copy = state.item;
        let remote = copy.id ? await maybeWorkItem(copy) : null;
        // A work item removed or moved by someone in Azure DevOps is never silently recreated or taken back.
        if (copy.id && !remote) return { status: 'ambiguous', code: 'work_item_missing' };
        if (remote) await owned(remote, copy);
        const projection = azureDevOpsProjection(context.feedback.context, copy.marker);
        const bodyHash = sha256Hex(JSON.stringify({ title: projection.title, html: projection.html, field: copy.bodyField }));
        const status = context.feedback.context.status;
        const desiredState = status === 'done' ? config.doneState : config.openState;
        if (!remote) {
            copy.createStartedAt = new Date().toISOString(); await checkpoint();
            remote = await write('create_work_item', 'POST', azureDevOpsUrl(copy.organization, `${copy.projectId}/_apis/wit/workitems/$${encodeURIComponent(copy.workItemType)}`),
                [{ op: 'add', path: '/fields/System.Title', value: projection.title }, { op: 'add', path: `/fields/${copy.bodyField}`, value: projection.html },
                    ...(config.areaPath ? [{ op: 'add', path: '/fields/System.AreaPath', value: config.areaPath }] : [])],
                workItemDecoder(copy.bodyField), { generation: copy.generation }, false);
            copy.id = remote.id; copy.bodyHash = bodyHash; copy.createStartedAt = undefined;
            await checkpoint(true);
        }
        const changes: { op: 'add'; path: string; value: string }[] = [];
        if (copy.bodyHash !== bodyHash) changes.push({ op: 'add', path: '/fields/System.Title', value: projection.title },
            { op: 'add', path: `/fields/${copy.bodyField}`, value: projection.html });
        // The mapped state follows uier's status changes only, so a team's own board moves are kept.
        if (copy.status !== status && remote.state !== desiredState) changes.push({ op: 'add', path: '/fields/System.State', value: desiredState });
        if (changes.length) {
            await write('update_work_item', 'PATCH', azureDevOpsUrl(copy.organization, `_apis/wit/workitems/${copy.id}`), changes,
                workItemDecoder(copy.bodyField), { workItemId: copy.id });
        }
        copy.bodyHash = bodyHash; copy.status = status; copy.destinationRevision = connection.destinationRevision;
        await checkpoint(true);
        return { status: 'accepted', ...(projection.truncated ? { code: 'content_truncated' } : {}) };
    } catch (error) {
        if (error instanceof AzureDevOpsApiError) {
            if (error.definitive && context.ledger.attempt) await context.checkpoint(context.ledger.state, { clearAttempt: true });
            if (error.code === 'rate_limited') {
                if (grant && error.retryAt) await pauseAzureDevOpsGrant(grant, error.retryAt);
                return { status: 'waiting', code: 'rate_limited', retryAt: error.retryAt };
            }
            if (error.code === 'unauthenticated') {
                // Azure DevOps also answers 401 to an account that lost access to the organization.
                const latest = await currentAzureDevOpsGrant(connection).catch(() => grant);
                const refreshedAt = Date.parse(latest?.forcedRefreshAt ?? '');
                if (Number.isFinite(refreshedAt) && Date.now() - refreshedAt < 10 * 60_000) return { status: 'paused', code: 'access_denied' };
                try { await azureDevOpsAccessToken(connection, send => context.read(send), true); return { status: 'waiting', code: 'credentials_refreshed' }; }
                catch (refreshError) {
                    if (refreshError instanceof GrantLeaseError) return { status: 'waiting', code: 'refresh_busy' };
                    if (refreshError instanceof AzureDevOpsSetupError || refreshError instanceof AzureDevOpsApiError && refreshError.definitive)
                        return { status: 'needs_reconnect', code: 'needs_reconnect' };
                    return { status: 'waiting', code: 'credential_refresh_pending' };
                }
            }
            if (['invalid_grant', 'interaction_required', 'invalid_client', 'unauthorized_client', 'consent_required'].includes(error.code))
                return { status: 'needs_reconnect', code: 'needs_reconnect' };
            if (['forbidden', 'not_found'].includes(error.code)) return { status: 'paused', code: 'destination_unavailable' };
            // A rule in the process (a required field, a state, an area) rejected the change.
            if (error.code === 'bad_request') return { status: 'paused', code: 'work_item_rejected' };
            if (context.ledger.attempt && !context.ledger.attempt.repeatable) return { status: 'waiting', code: 'reconcile_pending' };
            return { status: 'failed', code: error.code };
        }
        if (error instanceof GrantLeaseError) return { status: 'waiting', code: 'refresh_busy' };
        if (error instanceof AzureDevOpsSetupError) {
            if (['needs_reconnect', 'grant_unavailable'].includes(error.code)) return { status: 'needs_reconnect', code: error.code };
            if (['external_work_item_changed', 'duplicate_work_items', 'reconciliation_limit', 'invalid_ledger'].includes(error.code)) return { status: 'ambiguous', code: error.code };
            return { status: 'paused', code: error.code };
        }
        throw error;
    }
}

export const azureDevOpsAdapter: IntegrationAdapter = { provider: 'azure-devops', isConfigured: isAzureDevOpsConfigured, maxRunMs: 4 * 60_000, maxCalls: 100,
    deliver, externalLink(connection, ledger) {
        const copy = stateFrom(ledger.state).item;
        const config = (connection as AzureDevOpsConnection).config;
        if (!copy?.id || copy.cleanupStarted || copy.cleaned || copy.organization !== config.organization || copy.projectId !== config.projectId) return null;
        return azureDevOpsWorkItemUrl(copy.organization, copy.id);
    }, validateExternalLink(url, connection, ledger) {
        const copy = stateFrom(ledger.state).item;
        return Boolean(copy?.id && validOrganization(copy.organization) && url.href === azureDevOpsWorkItemUrl(copy.organization, copy.id));
    }, async revokeAdmin(workspaceId) {
        const { revokeAzureDevOpsAdmin } = await import('./connection');
        await revokeAzureDevOpsAdmin(workspaceId);
    } };
