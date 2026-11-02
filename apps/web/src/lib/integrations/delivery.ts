import { feedbackMarkdown } from '@uier/toolbar/feedback-context';
import { withImportedReplies } from './importReplies';
import { randomUUID } from 'node:crypto';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { withSyncMark } from './syncSignal';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from '../review/actor';
import { projectFeedbackExport } from '../review/feedbackContext';
import { getIntegrationConnection } from './connection';
import type { IntegrationReply, IntegrationAdapter, IntegrationAttempt, IntegrationConnection, IntegrationDeliveryContext, IntegrationOperation, IntegrationResult, IntegrationState, IntegrationSync } from './model';

export const INTEGRATION_MAX_FAILURES = 8;
export const integrationFailureCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'provider_error';
export const integrationBackoffMs = (failures: number) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(failures, 8));

export class IntegrationControlError extends Error {
    constructor(public readonly code: 'lease_lost' | 'authority_lost' | 'temporarily_unavailable' | 'projection_changed' | 'budget_exhausted' | 'uncertain_operation' | 'backfill_destination_changed') {
        super('The integration attempt must wait or be reconciled.');
        this.name = 'IntegrationControlError';
    }
}

export type DeliveryOptions = {
    store?: AppStore;
    comments?: CommentsStore;
    now?: () => number;
    deadline?: number;
    maxCalls?: number;
    onRequest?: () => void;
    statusOnly?: boolean;
    exportFeedback?: typeof projectFeedbackExport;
};

async function authority(ledger: IntegrationSync, store: AppStore, comments: CommentsStore) {
    if (ledger.projectId === PUBLIC_PROJECT_ID) return null;
    const project = (await store.get<DbProject>(workspacePk(ledger.workspaceId), ledger.projectId))?.doc;
    if (!project || project.type !== 'project' || project.workspaceId !== ledger.workspaceId) return null;
    const connection = await getIntegrationConnection(project, ledger.provider, store);
    if (!connection || connection.id !== ledger.connectionId) return null;
    const member = (await store.get<DbMember>(project.pk, memberId(connection.connectedBy)))?.doc;
    const user = (await store.get<DbUser>(userPk(connection.connectedBy), connection.connectedBy))?.doc;
    if (member?.type !== 'member' || member.role !== 'admin' || member.userId !== connection.connectedBy
        || member.workspaceId !== ledger.workspaceId || !user || user.type !== 'user' || user.id !== connection.connectedBy) return null;
    const source = (await comments.get(`project:${ledger.projectId}`, ledger.threadId))?.comment ?? null;
    if (source && (source.projectId !== ledger.projectId || source.domain !== `project:${ledger.projectId}`)) return null;
    const actor: ProjectActor = { kind: 'member', isAdmin: true, userId: user.id, name: user.name };
    return { project, connection, source, actor };
}

function projectHash(project: DbProject) {
    // Source URL/environment changes can invalidate an export without changing its thread cursor.
    return sha256Hex(JSON.stringify({ id: project.id, workspaceId: project.workspaceId, name: project.name,
        urls: project.urls, environments: project.environments, pageState: project.pageState, access: project.access }));
}

function connectionHash(connection: IntegrationConnection) {
    return sha256Hex(JSON.stringify({ id: connection.id, provider: connection.provider, workspaceId: connection.workspaceId,
        projectId: connection.projectId, connectedBy: connection.connectedBy, destinationRevision: connection.destinationRevision,
        grantId: connection.grantId, twoWaySync: connection.twoWaySync, replySync: connection.replySync, config: connection.config, createdAt: connection.createdAt, updatedAt: connection.updatedAt }));
}

function allowsMode(connection: IntegrationConnection, mode: IntegrationDeliveryContext['mode']) {
    return connection.status === 'connected' || (mode === 'cleanup' && connection.provider === 'github'
        && connection.status === 'paused' && connection.statusCode === 'public_confirmation_required');
}

/** One connection's bounded leased attempt. No provider receives private feedback during cleanup. */
export async function processIntegrationDelivery(candidate: IntegrationSync, baseUrl: string, adapter: IntegrationAdapter,
    options: DeliveryOptions = {}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const clock = options.now ?? Date.now;
    const now = clock();
    const deadline = Math.floor(options.deadline ?? now + Math.min(adapter.maxRunMs ?? 60_000, 4 * 60_000));
    const stored = await store.get<IntegrationSync>(candidate.pk, candidate.id);
    const statusOnly = options.statusOnly === true;
    if (!stored || (statusOnly ? (!adapter.supportsStatusSync && !adapter.supportsReplySync) || stored.doc.status !== 'accepted' || stored.doc.active
        || stored.doc.attempt || stored.doc.deletion || stored.doc.tombstoned : !stored.doc.active || Date.parse(stored.doc.nextAttemptAt) > now)
        || stored.doc.provider !== adapter.provider
        || (stored.doc.lease && Date.parse(stored.doc.lease.until) > now) || deadline <= now) return;
    const lease = { id: randomUUID(), until: new Date(Math.min(deadline + 30_000, now + 5 * 60_000)).toISOString() };
    let ledger: IntegrationSync = { ...stored.doc, lease };
    if (await store.replace(ledger, stored.etag) !== 'ok') return;
    const ownsLease = (current: IntegrationSync) => current.lease?.id === lease.id && Date.parse(current.lease.until) > clock();
    const update = async (change: (current: IntegrationSync) => IntegrationSync) => {
        const saved = await updateDoc<IntegrationSync>(ledger.pk, ledger.id, current => {
            if (!ownsLease(current)) throw new IntegrationControlError('lease_lost');
            return change(current);
        }, store);
        if (!saved) throw new IntegrationControlError('lease_lost');
        ledger = saved;
        return saved;
    };
    const finish = async (patch: Partial<IntegrationSync>) => update(current => {
        const { lease: _lease, ...next } = current;
        // A failed poll must not mark outbound delivery complete, failed or suppressed.
        return statusOnly ? { ...next, statusCheckedAt: new Date(clock()).toISOString(), statusSyncCode: patch.lastCode } : { ...next, ...patch };
    });
    let snapshot: Awaited<ReturnType<typeof authority>>;
    let through = ledger.requestedVersion;
    const requestRevision = ledger.requestRevision;
    let calls = 0;
    try {
        snapshot = await authority(ledger, store, comments);
        if (!snapshot) {
            await finish({ status: 'suppressed', active: false, lastCode: 'authority_lost' });
            return;
        }
        const { connection, project, source, actor } = snapshot;
        const mode = ledger.deletion || !source || source.private || isPrivateAppFeedback(source) ? 'cleanup' : 'sync';
        if (statusOnly && ((!connection.twoWaySync && !connection.replySync?.enabled) || mode !== 'sync' || !source
            || (source.syncVersion ?? 0) > ledger.processedVersion || ledger.requestedVersion > ledger.processedVersion
            || ledger.requestRevision > ledger.processedRequestRevision)) {
            await finish({});
            return;
        }
        if (ledger.reconcileDestinationRevision !== undefined && ledger.reconcileDestinationRevision !== connection.destinationRevision
            && !ledger.attempt && mode === 'sync' && (ledger.sourceRequestedVersion ?? -1) <= ledger.processedVersion) {
            await finish({ status: 'suppressed', active: false, processedRequestRevision: ledger.requestRevision,
                lastCode: 'backfill_destination_changed' });
            return;
        }
        if (!adapter.isConfigured() || !connection.enabled || !allowsMode(connection, mode)
            || (connection.pausedUntil && Date.parse(connection.pausedUntil) > now)) {
            await finish({ status: 'waiting', lastCode: !adapter.isConfigured() ? 'not_configured' : !connection.enabled ? 'turned_off' : connection.statusCode,
                nextAttemptAt: connection.pausedUntil && Date.parse(connection.pausedUntil) > now ? connection.pausedUntil : new Date(now + 60_000).toISOString() });
            return;
        }
        if (!ledger.deletion && source && (source.syncVersion ?? 0) < ledger.requestedVersion) {
            await finish({ status: 'waiting', lastCode: 'source_version_behind', nextAttemptAt: new Date(now + 60_000).toISOString() });
            return;
        }
        through = ledger.deletion?.version ?? source?.syncVersion ?? ledger.requestedVersion;
        const feedback = mode === 'cleanup' || statusOnly ? null : await (options.exportFeedback ?? projectFeedbackExport)(project, actor, ledger.threadId, undefined, baseUrl);
        if (feedback && source) {
            const echoes = new Set(source.thread.items.filter(item => item.integrationSource?.provider === connection.provider
                && item.integrationSource.connectionId === connection.id).map(item => item.id));
            feedback.context.discussion = feedback.context.discussion.filter(item => !echoes.has(item.id));
            feedback.markdown = feedbackMarkdown(feedback.context);
        }
        const initialProjectHash = projectHash(project);
        const sourceVersion = source?.syncVersion ?? 0;
        const boundary = async (write: boolean, providerRequest = true) => {
            if (clock() >= deadline || (providerRequest && calls >= (options.maxCalls ?? adapter.maxCalls ?? 100))) throw new IntegrationControlError('budget_exhausted');
            const retained = await store.get<IntegrationSync>(ledger.pk, ledger.id);
            if (!retained || !ownsLease(retained.doc)) throw new IntegrationControlError('lease_lost');
            ledger = retained.doc;
            const latest = await authority(ledger, store, comments);
            if (!latest) throw new IntegrationControlError('authority_lost');
            if (!latest.connection.enabled || !allowsMode(latest.connection, mode) || !adapter.isConfigured())
                throw new IntegrationControlError('temporarily_unavailable');
            if (connectionHash(latest.connection) !== connectionHash(connection)) throw new IntegrationControlError('projection_changed');
            if (latest.connection.pausedUntil && Date.parse(latest.connection.pausedUntil) > clock()) throw new IntegrationControlError('budget_exhausted');
            const latestMode = ledger.deletion || !latest.source || latest.source.private || isPrivateAppFeedback(latest.source) ? 'cleanup' : 'sync';
            // Old uncertain creates may be reconciled, but clearing their receipt does not grant
            // permission to export an old forced selection into a different destination.
            if (write && latestMode === 'sync' && !ledger.attempt && ledger.reconcileDestinationRevision !== undefined
                && ledger.reconcileDestinationRevision !== latest.connection.destinationRevision
                && (ledger.sourceRequestedVersion ?? -1) <= ledger.processedVersion)
                throw new IntegrationControlError('backfill_destination_changed');
            if (latestMode !== mode || ((write || statusOnly) && mode === 'sync' && ((latest.source?.syncVersion ?? 0) !== sourceVersion
                || projectHash(latest.project) !== initialProjectHash))) throw new IntegrationControlError('projection_changed');
            // The asynchronous authority reads can themselves outlast the remaining lease/budget.
            if (clock() >= deadline || !ownsLease(ledger)) throw new IntegrationControlError('budget_exhausted');
        };
        const signal = () => AbortSignal.timeout(Math.max(1, Math.min(20_000, deadline - clock())));
        let incomingStatus: boolean | undefined;
        const incomingReplies: IntegrationReply[] = [];
        const context: IntegrationDeliveryContext = {
            connection, project, feedback, mode, through, deadline, baseUrl,
            statusOnly,
            importedReplies: (source?.thread.items ?? []).filter(item => item.integrationSource?.provider === connection.provider
                && item.integrationSource.connectionId === connection.id
                && !item.deletedAt).map(item => ({ externalId: item.integrationSource!.externalId, target: item.integrationSource!.target, createdAt: item.createdAt ?? connection.replySync?.since ?? '' })),
            get ledger() { return ledger; },
            async receiveStatus(resolved: boolean) {
                if (!statusOnly || typeof resolved !== 'boolean') throw new Error('Invalid inbound status');
                if (connection.twoWaySync !== true) return;
                await boundary(true, false);
                incomingStatus = resolved;
            },
            async receiveReplies(replies) {
                if (!statusOnly || !connection.replySync?.enabled || !adapter.supportsReplySync || project.access === 'disabled') return;
                await boundary(true, false);
                if (!Array.isArray(replies) || incomingReplies.length + replies.length > 100) throw new Error('Reply batch too large');
                incomingReplies.push(...replies);
            },
            async read<T>(send: (signal: AbortSignal) => Promise<T>) {
                await boundary(false);
                calls++;
                options.onRequest?.();
                return send(signal());
            },
            async operation<T>(operation: IntegrationOperation, send: (signal: AbortSignal) => Promise<T>) {
                if (statusOnly) throw new Error('Status polling cannot write to a provider');
                await boundary(true);
                if (!/^[a-z][a-z0-9_-]{0,63}$/.test(operation.step) || !/^[a-f0-9]{64}$/.test(operation.planHash))
                    throw new Error('Invalid integration operation metadata');
                const existing = ledger.attempt;
                if (existing && (!existing.repeatable || existing.step !== operation.step || existing.planHash !== operation.planHash
                    || existing.destinationRevision !== connection.destinationRevision)) throw new IntegrationControlError('uncertain_operation');
                const attempt: IntegrationAttempt = existing ?? { operationId: randomUUID(), firstSentAt: new Date(clock()).toISOString(),
                    through, requestRevision, destinationRevision: connection.destinationRevision, step: operation.step,
                    planHash: operation.planHash, metadata: operation.metadata ?? {}, repeatable: operation.repeatable === true };
                await update(current => ({ ...current, attempt }));
                // Recheck after persistence too, before any request with a feedback body can leave.
                try { await boundary(true); }
                catch (error) {
                    // This invocation can prove its new request was never sent. Keep genuine
                    // prior-run uncertainty, but don't manufacture it for an unsent operation.
                    if (!existing) await update(current => current.attempt?.operationId !== attempt.operationId ? current : ({ ...current, attempt: undefined }));
                    throw error;
                }
                calls++;
                options.onRequest?.();
                return send(signal());
            },
            async checkpoint(state: IntegrationState, checkpointOptions = {}) {
                await update(current => ({ ...current, state: structuredClone(state),
                    ...(checkpointOptions.clearAttempt ? { attempt: undefined } : {}) }));
            }
        };
        const result = await adapter.deliver(context);
        if (statusOnly) {
            if (result.status === 'accepted') {
                await boundary(true, false);
                const current = await comments.get(`project:${project.id}`, ledger.threadId);
                if (!current || (current.comment.syncVersion ?? 0) !== sourceVersion || current.comment.private
                    || isPrivateAppFeedback(current.comment)) throw new IntegrationControlError('projection_changed');
                const at = new Date(clock()).toISOString();
                const changed = withImportedReplies(current.comment, connection, { resolved: incomingStatus, replies: incomingReplies, at });
                if (changed !== current.comment) {
                    await boundary(true, false);
                    if (await comments.replace(withSyncMark(project, current.comment, { ...changed, updatedAt: at }), current.etag) !== 'ok')
                        throw new IntegrationControlError('projection_changed');
                }
            }
            await finish({ lastCode: result.code });
            return;
        }
        await applyResult(result, connection);
    } catch (error) {
        if (error instanceof IntegrationControlError && error.code === 'lease_lost') return;
        try {
            if (error instanceof IntegrationControlError) {
                if (error.code === 'authority_lost') await finish({ status: 'suppressed', active: false, lastCode: error.code });
                else if (error.code === 'backfill_destination_changed') await finish({ status: 'suppressed', active: false,
                    processedRequestRevision: ledger.requestRevision, lastCode: error.code });
                else if (error.code === 'uncertain_operation') await finish({ status: 'ambiguous', active: false, lastCode: error.code });
                else await finish({ status: 'waiting', active: true, lastCode: error.code, nextAttemptAt: new Date(clock() + 60_000).toISOString() });
            } else {
                // Unknown failures after an uncertain create must never cause a blind replay.
                const ambiguous = ledger.attempt && !ledger.attempt.repeatable;
                const failures = ledger.failures + 1;
                await finish({ status: ambiguous ? 'ambiguous' : failures >= INTEGRATION_MAX_FAILURES ? 'failed' : 'queued',
                    active: !ambiguous && failures < INTEGRATION_MAX_FAILURES, failures,
                    lastCode: integrationFailureCode(error instanceof Error ? error.name : undefined),
                    nextAttemptAt: new Date(clock() + integrationBackoffMs(failures)).toISOString() });
            }
        } catch (saveError) {
            if (!(saveError instanceof IntegrationControlError && saveError.code === 'lease_lost')) throw saveError;
        }
    }

    async function applyResult(result: IntegrationResult, connection: IntegrationConnection) {
        const code = result.code === undefined ? undefined : integrationFailureCode(result.code);
        if (result.status === 'accepted' || result.status === 'suppressed') {
            await update(current => {
                if (current.attempt) throw new IntegrationControlError('uncertain_operation');
                const { lease: _lease, ...next } = current;
                const processedVersion = Math.max(current.processedVersion, through);
                const processedRequestRevision = Math.max(current.processedRequestRevision, requestRevision);
                return { ...next, processedVersion, processedRequestRevision, failures: 0, status: result.status,
                    active: current.requestedVersion > processedVersion || current.requestRevision > processedRequestRevision,
                    tombstoned: Boolean(current.deletion && current.deletion.version <= through), lastCode: code,
                    nextAttemptAt: new Date(clock()).toISOString() };
            });
            await updateDoc<IntegrationConnection>(connection.pk, connection.id, current => connectionHash(current) !== connectionHash(connection) ? current
                : ({ ...current, lastSyncedAt: new Date(clock()).toISOString() }), store);
        } else if (result.status === 'paused' || result.status === 'needs_reconnect') {
            await updateDoc<IntegrationConnection>(connection.pk, connection.id, current => connectionHash(current) !== connectionHash(connection) ? current
                : ({ ...current, status: result.status, statusCode: code, updatedAt: new Date(clock()).toISOString() }), store);
            await finish({ status: 'waiting', lastCode: code, nextAttemptAt: new Date(clock() + 60_000).toISOString() });
        } else if (result.status === 'waiting') {
            const retryAt = result.retryAt && Number.isFinite(Date.parse(result.retryAt)) && Date.parse(result.retryAt) > clock()
                ? result.retryAt : new Date(clock() + 60_000).toISOString();
            await finish({ status: 'waiting', lastCode: code, nextAttemptAt: retryAt });
        } else {
            const failures = ledger.failures + (result.status === 'failed' ? 1 : 0);
            await finish({ failures, status: result.status === 'ambiguous' ? 'ambiguous' : failures >= INTEGRATION_MAX_FAILURES ? 'failed' : 'queued',
                active: result.status !== 'ambiguous' && failures < INTEGRATION_MAX_FAILURES, lastCode: code,
                nextAttemptAt: new Date(clock() + integrationBackoffMs(failures)).toISOString() });
        }
    }
}
