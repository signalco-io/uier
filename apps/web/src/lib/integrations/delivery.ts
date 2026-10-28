import { randomUUID } from 'node:crypto';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../app/model';
import { getAppStore, updateDoc, type AppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';
import { isPrivateAppFeedback, PUBLIC_PROJECT_ID } from '../comments/publicProject';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import type { ProjectActor } from '../review/actor';
import { projectFeedbackExport } from '../review/feedbackContext';
import { getIntegrationConnection } from './connection';
import type { IntegrationAdapter, IntegrationAttempt, IntegrationConnection, IntegrationDeliveryContext, IntegrationOperation, IntegrationResult, IntegrationState, IntegrationSync } from './model';

export const INTEGRATION_MAX_FAILURES = 8;
export const integrationFailureCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'provider_error';
export const integrationBackoffMs = (failures: number) => Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.min(failures, 8));

export class IntegrationControlError extends Error {
    constructor(public readonly code: 'lease_lost' | 'authority_lost' | 'temporarily_unavailable' | 'projection_changed' | 'budget_exhausted' | 'uncertain_operation') {
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
        urls: project.urls, environments: project.environments, pageState: project.pageState }));
}

function connectionHash(connection: IntegrationConnection) {
    return sha256Hex(JSON.stringify({ id: connection.id, provider: connection.provider, workspaceId: connection.workspaceId,
        projectId: connection.projectId, connectedBy: connection.connectedBy, destinationRevision: connection.destinationRevision,
        grantId: connection.grantId, config: connection.config, createdAt: connection.createdAt, updatedAt: connection.updatedAt }));
}

/** One connection's bounded leased attempt. No provider receives private feedback during cleanup. */
export async function processIntegrationDelivery(candidate: IntegrationSync, baseUrl: string, adapter: IntegrationAdapter,
    options: DeliveryOptions = {}) {
    const store = options.store ?? getAppStore();
    const comments = options.comments ?? getCommentsStore();
    const clock = options.now ?? Date.now;
    const now = clock();
    const deadline = options.deadline ?? now + Math.min(adapter.maxRunMs ?? 60_000, 4 * 60_000);
    const stored = await store.get<IntegrationSync>(candidate.pk, candidate.id);
    if (!stored || !stored.doc.active || stored.doc.provider !== adapter.provider || Date.parse(stored.doc.nextAttemptAt) > now
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
        return { ...next, ...patch };
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
        if (!adapter.isConfigured() || !connection.enabled || connection.status !== 'connected'
            || (connection.pausedUntil && Date.parse(connection.pausedUntil) > now)) {
            await finish({ status: 'waiting', lastCode: !adapter.isConfigured() ? 'not_configured' : !connection.enabled ? 'turned_off' : connection.statusCode,
                nextAttemptAt: connection.pausedUntil && Date.parse(connection.pausedUntil) > now ? connection.pausedUntil : new Date(now + 60_000).toISOString() });
            return;
        }
        const mode = ledger.deletion || !source || source.private || isPrivateAppFeedback(source) ? 'cleanup' : 'sync';
        if (!ledger.deletion && source && (source.syncVersion ?? 0) < ledger.requestedVersion) {
            await finish({ status: 'waiting', lastCode: 'source_version_behind', nextAttemptAt: new Date(now + 60_000).toISOString() });
            return;
        }
        through = ledger.deletion?.version ?? source?.syncVersion ?? ledger.requestedVersion;
        const feedback = mode === 'cleanup' ? null : await (options.exportFeedback ?? projectFeedbackExport)(project, actor, ledger.threadId, undefined, baseUrl);
        const initialProjectHash = projectHash(project);
        const sourceVersion = source?.syncVersion ?? 0;
        const boundary = async (write: boolean) => {
            if (clock() >= deadline || calls >= (options.maxCalls ?? adapter.maxCalls ?? 100)) throw new IntegrationControlError('budget_exhausted');
            const retained = await store.get<IntegrationSync>(ledger.pk, ledger.id);
            if (!retained || !ownsLease(retained.doc)) throw new IntegrationControlError('lease_lost');
            ledger = retained.doc;
            const latest = await authority(ledger, store, comments);
            if (!latest) throw new IntegrationControlError('authority_lost');
            if (!latest.connection.enabled || latest.connection.status !== 'connected' || !adapter.isConfigured())
                throw new IntegrationControlError('temporarily_unavailable');
            if (connectionHash(latest.connection) !== connectionHash(connection)) throw new IntegrationControlError('projection_changed');
            if (latest.connection.pausedUntil && Date.parse(latest.connection.pausedUntil) > clock()) throw new IntegrationControlError('budget_exhausted');
            const latestMode = ledger.deletion || !latest.source || latest.source.private || isPrivateAppFeedback(latest.source) ? 'cleanup' : 'sync';
            if (latestMode !== mode || (write && mode === 'sync' && ((latest.source?.syncVersion ?? 0) !== sourceVersion
                || projectHash(latest.project) !== initialProjectHash))) throw new IntegrationControlError('projection_changed');
            // The asynchronous authority reads can themselves outlast the remaining lease/budget.
            if (clock() >= deadline || !ownsLease(ledger)) throw new IntegrationControlError('budget_exhausted');
        };
        const signal = () => AbortSignal.timeout(Math.max(1, Math.min(20_000, deadline - clock())));
        const context: IntegrationDeliveryContext = {
            connection, project, feedback, mode, through, deadline, baseUrl,
            get ledger() { return ledger; },
            async read<T>(send: (signal: AbortSignal) => Promise<T>) {
                await boundary(false);
                calls++;
                options.onRequest?.();
                return send(signal());
            },
            async operation<T>(operation: IntegrationOperation, send: (signal: AbortSignal) => Promise<T>) {
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
        await applyResult(result, connection);
    } catch (error) {
        if (error instanceof IntegrationControlError && error.code === 'lease_lost') return;
        try {
            if (error instanceof IntegrationControlError) {
                if (error.code === 'authority_lost') await finish({ status: 'suppressed', active: false, lastCode: error.code });
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
