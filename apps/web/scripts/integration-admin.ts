import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { memberId, userPk, workspacePk, type DbMember, type DbProject, type DbUser } from '../src/lib/app/model';
import { configuredAppBaseUrl } from '../src/lib/app/deployment';
import { getAppStore, updateDoc, type AppStore } from '../src/lib/app/store';
import { isLocalRuntime } from '../src/lib/comments/environment';
import { PUBLIC_PROJECT_ID } from '../src/lib/comments/publicProject';
import { getIntegrationConnection } from '../src/lib/integrations/connection';
import { integrationSyncId } from '../src/lib/integrations/discovery';
import { integrationProviders, type IntegrationConnection, type IntegrationSync } from '../src/lib/integrations/model';
import { resolveGitHubCreate } from '../src/lib/integrations/github';
import type { GitHubState } from '../src/lib/integrations/github/model';
import { resolveSlackUncertainPost, resumeSlackNotification, clearSlackRateReview, listSlackRateReviews } from '../src/lib/integrations/slack';
import { slackMethods } from '../src/lib/integrations/slack/client';
import type { SlackState } from '../src/lib/integrations/slack/model';

export class IntegrationAdminError extends Error {
    constructor(public readonly code: 'invalid_input' | 'production_configuration_required' | 'admin_required'
        | 'connection_unavailable' | 'ledger_not_found' | 'ledger_changed' | 'recovery_unavailable') {
        super('The integration administration request could not be completed.');
        this.name = 'IntegrationAdminError';
    }
}

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const ledgerId = z.string().regex(/^(notion|github|linear|slack)_[a-f0-9]{64}$/);
const actor = { workspaceId: identifier, projectId: z.string().regex(/^[a-z0-9]{12}$/), userId: identifier,
    provider: z.enum(integrationProviders) };
const inputSchema = z.discriminatedUnion('action', [
    z.object({ ...actor, action: z.literal('status'), ledgerId: ledgerId.optional() }).strict(),
    z.object({ ...actor, action: z.literal('retry'), ledgerId, operatorAcknowledged: z.literal(true) }).strict(),
    z.object({ ...actor, provider: z.literal('github'), action: z.literal('github-resolve-create'), ledgerId,
        operationId: z.string().uuid(), operatorAcknowledged: z.literal(true), decision: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('confirm-absent') }).strict(),
            z.object({ kind: z.literal('adopt-issue'), issueNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
            z.object({ kind: z.literal('adopt-comment'), commentId: z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => Number.isSafeInteger(Number(value))) }).strict()
        ]) }).strict(),
    z.object({ ...actor, provider: z.literal('slack'), action: z.literal('slack-resolve-post'), ledgerId,
        operationId: z.string().uuid(), operatorAcknowledged: z.literal(true), originalDestinationReviewed: z.literal(true),
        decision: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('adopt'), ts: z.string().regex(/^\d{1,20}\.\d{1,20}$/), sourceChannelBotMatch: z.literal(true) }).strict(),
            z.object({ kind: z.literal('confirm-absent') }).strict()
        ]) }).strict(),
    z.object({ ...actor, provider: z.literal('slack'), action: z.literal('slack-resume-notification'), ledgerId,
        operatorAcknowledged: z.literal(true), newNotificationConfirmed: z.literal(true) }).strict(),
    z.object({ ...actor, provider: z.literal('slack'), action: z.literal('slack-release-rate'), ledgerId: z.undefined().optional(),
        method: z.enum(slackMethods), operatorAcknowledged: z.literal(true), providerLimitVerified: z.literal(true) }).strict()
]);
export type IntegrationAdminInput = z.infer<typeof inputSchema>;

export function parseIntegrationAdminInput(value: unknown): IntegrationAdminInput {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success || (parsed.data.ledgerId && !parsed.data.ledgerId.startsWith(`${parsed.data.provider}_`)))
        throw new IntegrationAdminError('invalid_input');
    return parsed.data;
}

/** Production operator entry points cannot fall back to development stores or preview credentials. */
export function assertIntegrationAdminProductionConfiguration() {
    if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || process.env.VERCEL_ENV === 'preview' || isLocalRuntime()
        || process.env.UIER_LOCAL === '1' || process.env.NODE_ENV === 'development'
        || !process.env.COSMOSDB_CONNECTION_STRING || process.env.COSMOSDB_ENDPOINT || (process.env.UIER_COMMENTS_SECRET?.length ?? 0) < 32
        || (process.env.COSMOSDB_APP_CONTAINER && process.env.COSMOSDB_APP_CONTAINER !== 'app')
        || (process.env.COSMOSDB_COMMENTS_CONTAINER && process.env.COSMOSDB_COMMENTS_CONTAINER !== 'comments')
        || configuredAppBaseUrl() !== 'https://uier.io') throw new IntegrationAdminError('production_configuration_required');
}

const safeDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
function ledgerView(ledger: IntegrationSync) {
    const githubState = ledger.state as unknown as GitHubState;
    const pending = ledger.provider === 'slack' && Array.isArray(ledger.state.uncertainPosts)
        ? (ledger.state as SlackState).uncertainPosts!.filter(post => !post.resolved).slice(0, 100)
        : ledger.provider === 'github' ? [githubState.active, ...(githubState.retired ?? [])].flatMap(destination => destination?.uncertainCreates ?? []).slice(0, 100) : [];
    return { id: ledger.id, provider: ledger.provider, threadId: identifier.safeParse(ledger.threadId).success ? ledger.threadId : undefined,
        status: ['queued', 'waiting', 'accepted', 'suppressed', 'failed', 'ambiguous'].includes(ledger.status) ? ledger.status : 'unknown',
        code: safeCode(ledger.lastCode), nextAttemptAt: safeDate(ledger.nextAttemptAt),
        ...(ledger.attempt ? { attempt: { operationId: /^[a-f0-9-]{36}$/i.test(ledger.attempt.operationId) ? ledger.attempt.operationId : undefined,
            step: safeCode(ledger.attempt.step), firstSentAt: safeDate(ledger.attempt.firstSentAt) } } : {}),
        ...(pending.length ? { unresolvedOperations: pending.map(post => ({ operationId: /^[a-f0-9-]{36}$/i.test(post.operationId) ? post.operationId : undefined,
            step: safeCode(post.step), firstSentAt: safeDate(post.firstSentAt) })), unresolvedOperationsCapped: pending.length >= 100 } : {}) };
}

async function currentAuthority(input: IntegrationAdminInput, store: AppStore) {
    const pk = workspacePk(input.workspaceId);
    const project = (await store.get<DbProject>(pk, input.projectId))?.doc;
    const member = (await store.get<DbMember>(pk, memberId(input.userId)))?.doc;
    const user = (await store.get<DbUser>(userPk(input.userId), input.userId))?.doc;
    if (!project || project.type !== 'project' || project.id !== input.projectId || project.workspaceId !== input.workspaceId || project.id === PUBLIC_PROJECT_ID
        || member?.type !== 'member' || member.role !== 'admin' || member.workspaceId !== input.workspaceId || member.userId !== input.userId
        || user?.type !== 'user' || user.id !== input.userId) throw new IntegrationAdminError('admin_required');
    const connection = await getIntegrationConnection(project, input.provider, store);
    if (!connection) throw new IntegrationAdminError('connection_unavailable');
    return { project, connection };
}
function ownsLedger(input: IntegrationAdminInput, connection: IntegrationConnection, ledger: IntegrationSync) {
    return ledger.type === `${input.provider}-sync` && ledger.provider === input.provider && ledger.workspaceId === input.workspaceId
        && ledger.projectId === input.projectId && ledger.connectionId === connection.id && ledger.pk === `${input.provider}:${input.projectId}`
        && ledger.id === integrationSyncId(input.provider, connection.id, input.projectId, ledger.threadId);
}

export async function executeIntegrationAdmin(value: unknown, options: { store?: AppStore; now?: () => number;
    githubRecovery?: typeof resolveGitHubCreate; slackRecovery?: typeof resolveSlackUncertainPost; slackResume?: typeof resumeSlackNotification;
    slackRateRelease?: typeof clearSlackRateReview; slackRateReviews?: typeof listSlackRateReviews } = {}) {
    const input = parseIntegrationAdminInput(value);
    const store = options.store ?? getAppStore();
    const now = options.now ?? Date.now;
    const { connection, project } = await currentAuthority(input, store);
    if (input.action === 'slack-release-rate') {
        try {
            const result = await (options.slackRateRelease ?? clearSlackRateReview)(project, input.userId, input.method, { confirmed: true });
            return { provider: input.provider, workspaceId: input.workspaceId, projectId: input.projectId, ...result };
        } catch { throw new IntegrationAdminError('recovery_unavailable'); }
    }
    const pk = `${input.provider}:${input.projectId}`;
    const record = input.ledgerId ? await store.get<IntegrationSync>(pk, input.ledgerId) : null;
    if (input.ledgerId && (!record || !ownsLedger(input, connection, record.doc))) throw new IntegrationAdminError('ledger_not_found');
    if (input.action === 'status') {
        const rows = record ? [record.doc] : await store.query<IntegrationSync>({ type: `${input.provider}-sync`, pk,
            where: { connectionId: connection.id }, limit: 1000, orderBy: 'id' });
        return { provider: input.provider, workspaceId: input.workspaceId, projectId: input.projectId, connectionId: connection.id,
            capped: !record && rows.length >= 1000, ledgers: rows.filter(row => ownsLedger(input, connection, row)).slice(0, 1000).map(ledgerView),
            ...(input.provider === 'slack' ? { rateReviewMethods: await (options.slackRateReviews ?? listSlackRateReviews)(project, input.userId).catch(() => undefined) } : {}) };
    }
    if (!connection.enabled || connection.status !== 'connected') throw new IntegrationAdminError('connection_unavailable');
    const refreshed = await currentAuthority(input, store);
    if (refreshed.connection.id !== connection.id || refreshed.connection.destinationRevision !== connection.destinationRevision
        || refreshed.connection.connectedBy !== connection.connectedBy || !refreshed.connection.enabled || refreshed.connection.status !== 'connected')
        throw new IntegrationAdminError('ledger_changed');
    if (input.action === 'github-resolve-create') {
        const githubState = record!.doc.state as unknown as GitHubState;
        const receipt = record?.doc.attempt?.operationId === input.operationId ? record.doc.attempt
            : [githubState.active, ...(githubState.retired ?? [])].flatMap(destination => destination?.uncertainCreates ?? []).find(receipt => receipt.operationId === input.operationId);
        if (!receipt || receipt.repeatable || !['create_issue', 'create_comment'].includes(receipt.step)
            || (record!.doc.lease && Date.parse(record!.doc.lease.until) > now())) throw new IntegrationAdminError('ledger_changed');
        const decision = input.decision;
        try {
            await (options.githubRecovery ?? resolveGitHubCreate)({ userId: input.userId, workspaceId: input.workspaceId, projectId: input.projectId,
                ledgerId: input.ledgerId, operationId: input.operationId,
                ...(decision.kind === 'confirm-absent' ? { confirmAbsent: true } : decision.kind === 'adopt-issue'
                    ? { issueNumber: decision.issueNumber } : { commentId: decision.commentId }) }, store);
        } catch { throw new IntegrationAdminError('recovery_unavailable'); }
    } else if (input.action === 'slack-resolve-post') {
        const attempt = record!.doc.attempt;
        const retained = (record!.doc.state as SlackState).uncertainPosts?.find(post => post.operationId === input.operationId && !post.resolved);
        if ((!retained && !(attempt && attempt.operationId === input.operationId && !attempt.repeatable && ['post_root', 'post_summary'].includes(attempt.step)))
            || (record!.doc.lease && Date.parse(record!.doc.lease!.until) > now())) throw new IntegrationAdminError('ledger_changed');
        try {
            await (options.slackRecovery ?? resolveSlackUncertainPost)(project, input.userId, record!.doc.threadId, {
                operationId: input.operationId, decision: input.decision.kind === 'adopt' ? 'adopt' : 'absent', confirmed: true,
                ...(input.decision.kind === 'adopt' ? { ts: input.decision.ts } : {}) });
        } catch { throw new IntegrationAdminError('recovery_unavailable'); }
    } else if (input.action === 'slack-resume-notification') {
        if (record!.doc.attempt || (record!.doc.state as SlackState).uncertainPosts?.some(post => !post.resolved))
            throw new IntegrationAdminError('ledger_changed');
        try { await (options.slackResume ?? resumeSlackNotification)(project, input.userId, record!.doc.threadId); }
        catch { throw new IntegrationAdminError('recovery_unavailable'); }
    } else {
        await updateDoc<IntegrationSync>(pk, input.ledgerId, current => {
            if (!ownsLedger(input, connection, current) || !['failed', 'ambiguous'].includes(current.status)
                || (current.lease && Date.parse(current.lease.until) > now()) || current.attempt?.operationId !== record!.doc.attempt?.operationId)
                throw new IntegrationAdminError('ledger_changed');
            return { ...current, status: 'queued', active: true, failures: 0, nextAttemptAt: new Date(now()).toISOString() };
        }, store);
    }
    const saved = (await store.get<IntegrationSync>(pk, input.ledgerId))?.doc;
    if (!saved || !ownsLedger(input, connection, saved)) throw new IntegrationAdminError('ledger_changed');
    return { provider: input.provider, workspaceId: input.workspaceId, projectId: input.projectId, ledger: ledgerView(saved) };
}

export async function integrationAdminMain(inputPath: string) {
    try {
        assertIntegrationAdminProductionConfiguration();
        const file = await stat(inputPath);
        if (!file.isFile() || file.size > 16 * 1024) throw new IntegrationAdminError('invalid_input');
        let input: unknown;
        try { input = JSON.parse(await readFile(inputPath, 'utf8')); }
        catch { throw new IntegrationAdminError('invalid_input'); }
        const result = await executeIntegrationAdmin(input);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ error: error instanceof IntegrationAdminError ? error.code : 'operation_failed' })}\n`);
        process.exitCode = 1;
    }
}
