import { getCommentsStore } from '../repo/commentsStore';
import { createCosmosCommentsStore } from '../repo/cosmosCommentsStore';
import { cosmosDataContainerApp, cosmosDataContainerComments } from '../db/client';
import { getScreenshotBlobStore } from '../screenshots/blobStore';
import { getRecordingBlobs } from '../recordings/blobStore';
import { sweepRecordings } from '../recordings/service';
import { sweepProofStorage } from '../proofs/cleanup';
import { sweepCommentCleanup } from '../comments/cleanup';
import { sweepProjectDeletions } from '../app/projectDeletion';
import { sweepProjectTransfers } from '../app/projectTransfer';
import { retryNotificationDelivery, runNotificationWorker } from '../notifications/delivery';
import { configuredAppBaseUrl } from '../app/deployment';
import { runIntegrationWorker } from '../integrations/worker';
import { runMcpEventWorker } from '../mcp/events/delivery';
import { getAppStore, type AppStore } from '../app/store';
import { acquireWorkerLease, releaseWorkerLease, WORKER_BUDGET_MS } from './lease';

export type WorkerOptions = { integrationsOnly?: boolean; retryDelivery?: string; verifyOnly?: boolean; previewMaintenance?: boolean };
export type WorkerPhase = { name: string; run: (deadline: number) => Promise<number | void> };
export type WorkerResult = { status: 'completed' | 'busy' | 'verified' | 'deferred'; failed: number; phases: string[] };

/** A private schedule uses only the web app's existing production identity/settings. */
export function assertWorkerEnvironment(host: 'vercel' | 'github-actions', environment: Record<string, string | undefined> = process.env) {
    const common = environment.UIER_DEPLOYMENT_ENV === 'production' && environment.COSMOSDB_ENDPOINT
        && environment.UIER_COMMENTS_SECRET && !environment.COSMOSDB_CONNECTION_STRING;
    const permitted = host === 'vercel'
        ? (!environment.VERCEL_ENV || environment.VERCEL_ENV === 'production') && environment.GITHUB_ACTIONS !== 'true'
            && !environment.UIER_AZURE_AUTH_MODE && environment.AZURE_TENANT_ID && environment.AZURE_CLIENT_ID
            && environment.COSMOSDB_APP_CONTAINER === 'app' && environment.COSMOSDB_COMMENTS_CONTAINER === 'comments'
            && environment.AZURE_SCREENSHOTS_CONTAINER === 'screenshots'
        : environment.UIER_AZURE_AUTH_MODE === 'github-actions' && environment.GITHUB_ACTIONS === 'true'
            && !environment.AZURE_SCREENSHOTS_CONNECTION_STRING;
    if (!common || !permitted) throw new Error('The notification worker requires the production deployment configuration.');
}

export async function verifyWorkerAccess(previewMaintenance = false) {
    const containers = [cosmosDataContainerComments(), cosmosDataContainerApp()];
    if (previewMaintenance) containers.push(cosmosDataContainerComments().database.container('comments-preview'));
    for (const container of containers) {
        try { await container.item('__uier_worker_oidc_probe__', '__uier_worker_oidc_probe__').read(); }
        catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 404) throw error; }
    }
    for (const name of previewMaintenance ? ['screenshots', 'screenshots-preview'] : ['screenshots'])
        await getScreenshotBlobStore(name).listBefore(new Date(0));
    console.info('[worker] Azure OIDC data access verified for all worker containers.');
}

function phasesFor(options: WorkerOptions, baseUrl: string, now: () => number): WorkerPhase[] {
    const phases: WorkerPhase[] = [];
    if (!options.integrationsOnly) {
        const comments = getCommentsStore();
        phases.push({ name: 'production-images', async run() {
            const result = await comments.migrateScreenshots?.();
            console.info(`[screenshots] Migrated ${result?.migrated ?? 0} legacy production images; ${result?.failed ?? 0} need retry.`);
            return result?.failed ?? 0;
        } });
        // Preview permissions remain exclusive to the existing privileged manual Actions identity.
        if (options.previewMaintenance) phases.push({ name: 'preview-maintenance', async run() {
            const preview = createCosmosCommentsStore(() => cosmosDataContainerComments().database.container('comments-preview'),
                () => getScreenshotBlobStore('screenshots-preview'));
            const migration = await preview.migrateScreenshots!();
            const cleanup = await preview.sweepScreenshotBlobs!(now());
            const recordings = await sweepRecordings(preview, getRecordingBlobs('screenshots-preview'), 'preview');
            console.info(`[screenshots] Migrated ${migration.migrated} legacy preview images; swept ${cleanup.removed} preview blobs.`);
            return migration.failed + cleanup.failed + recordings.failed;
        } });
        phases.push({ name: 'project-deletions', async run() {
            const result = await sweepProjectDeletions({ comments });
            if (result.failed) console.error(`[projects] ${result.failed} project deletions need retry.`);
            return result.failed;
        } }, { name: 'project-transfers', async run() {
            const result = await sweepProjectTransfers();
            if (result.failed) console.error(`[projects] ${result.failed} project transfers need retry.`);
            return result.failed;
        } }, { name: 'comment-cleanup', async run() {
            const result = await sweepCommentCleanup(comments);
            console.info(`[comments] Swept ${result.removed} orphan screenshots; ${result.failed} cleanups need retry.`);
            return result.failed;
        } }, { name: 'recording-cleanup', async run() {
            const result = await sweepRecordings(comments, getRecordingBlobs(), 'production');
            console.info(`[recordings] Swept ${result.removed} orphan recordings; ${result.failed} cleanups need retry.`);
            return result.failed;
        } }, { name: 'proof-cleanup', async run(deadline) {
            const result = await sweepProofStorage({ deadline: Math.min(deadline - 60_000, now() + 60_000), now: now() });
            if (result.failed) console.error(`[proofs] ${result.failed} proof uploads or cleanups need retry.`);
            return result.failed;
        } }, { name: 'notifications', async run(deadline) {
            if (!process.env.ACS_CONNECTION_STRING || !process.env.UIER_EMAIL_SENDER) {
                console.error('[notifications] Email is not configured (ACS_CONNECTION_STRING, UIER_EMAIL_SENDER); delivery skipped.');
                return 1;
            }
            if (options.retryDelivery) await retryNotificationDelivery(options.retryDelivery);
            const result = await runNotificationWorker(baseUrl, undefined, undefined,
                { deadline: Math.min(deadline - 60_000, now() + 3 * 60_000), now });
            console.info(`[notifications] Checked ${result.checked} delivery ledgers; ${result.failed} attempts failed; ${result.blocked} require review.`);
            for (const ledger of result.review)
                console.info(`::warning title=Notification delivery needs review::${ledger.id} is ${ledger.status} (${ledger.lastCode}). After fixing the cause, run this workflow with retry_delivery set to this id.`);
            return result.failed;
        } });
    } else console.info('[notifications] Email delivery skipped for this integration-only run.');
    phases.push({ name: 'integrations', async run(deadline) {
        const result = await runIntegrationWorker(baseUrl, { budgetMs: Math.min(8 * 60_000, Math.max(0, deadline - now() - 60_000)) });
        console.info(`[integrations] Discovered ${result.discovered.checked} source changes; ${result.discovered.deferred} deferred.`);
        for (const provider of result.providers)
            console.info(`[${provider.provider}] Checked ${provider.checked} sync ledgers; ${provider.blocked} require review; ${provider.deferred} deferred for time.`);
        return result.blocked;
    } }, { name: 'mcp-events', async run(deadline) {
        try {
            const result = await runMcpEventWorker(baseUrl, { deadline: Math.min(deadline, now() + 60_000) });
            console.info(`[mcp-events] ${result.projects} projects: ${result.discovered} new deliveries, ${result.delivered} delivered, ${result.retrying} retrying, ${result.failed} failed, ${result.skipped} skipped, ${result.terminated} subscriptions ended; ${result.deferred} projects deferred.`);
            return 0;
        } catch (error) {
            console.error(`[mcp-events] Event delivery needs retry (${error instanceof Error ? error.name : 'Error'}).`);
            return 1;
        }
    } });
    return phases;
}

/** Await every phase. Verification is read-only; a busy run never invokes a phase. */
export async function runScheduledWorker(options: WorkerOptions = {}, dependencies: {
    store?: AppStore; now?: () => number; verify?: (previewMaintenance: boolean) => Promise<void>; phases?: WorkerPhase[];
} = {}): Promise<WorkerResult> {
    if (options.integrationsOnly && options.retryDelivery) throw new Error('An integration-only run cannot retry an email delivery.');
    const baseUrl = configuredAppBaseUrl();
    if (!baseUrl) throw new Error('The notification worker requires a trusted application URL.');
    const now = dependencies.now ?? Date.now, startedAt = now(), deadline = startedAt + WORKER_BUDGET_MS;
    await (dependencies.verify ?? verifyWorkerAccess)(options.previewMaintenance === true);
    if (options.verifyOnly) return { status: 'verified', failed: 0, phases: [] };
    const store = dependencies.store ?? getAppStore();
    const lease = await acquireWorkerLease(store, startedAt);
    if (!lease) return { status: 'busy', failed: 0, phases: [] };
    const result: WorkerResult = { status: 'completed', failed: 0, phases: [] };
    try {
        for (const phase of dependencies.phases ?? phasesFor(options, baseUrl, now)) {
            if (now() >= deadline) { result.status = 'deferred'; break; }
            result.phases.push(phase.name);
            try { result.failed += await phase.run(deadline) || 0; }
            catch (error) {
                console.error(`[worker] ${phase.name} needs retry (${error instanceof Error ? error.name : 'Error'}).`);
                result.failed++;
            }
        }
        return result;
    } finally { await releaseWorkerLease(lease.owner, store, now()); }
}
