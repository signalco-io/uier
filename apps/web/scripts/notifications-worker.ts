import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { cosmosDataContainerApp, cosmosDataContainerComments } from '../src/lib/db/client';
import { getScreenshotBlobStore } from '../src/lib/screenshots/blobStore';
import { sweepCommentCleanup } from '../src/lib/comments/cleanup';
import { sweepProjectDeletions } from '../src/lib/app/projectDeletion';
import { sweepProjectTransfers } from '../src/lib/app/projectTransfer';
import { retryNotificationDelivery, runNotificationWorker } from '../src/lib/notifications/delivery';
import { configuredAppBaseUrl } from '../src/lib/app/deployment';
import { runIntegrationWorker } from '../src/lib/integrations/worker';
import { runMcpEventWorker } from '../src/lib/mcp/events/delivery';

process.env.UIER_COSMOS_WORKLOAD = 'scheduled';

if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || process.env.UIER_AZURE_AUTH_MODE !== 'github-actions'
    || process.env.GITHUB_ACTIONS !== 'true' || !process.env.COSMOSDB_ENDPOINT || !process.env.UIER_COMMENTS_SECRET
    || process.env.COSMOSDB_CONNECTION_STRING || process.env.AZURE_SCREENSHOTS_CONNECTION_STRING)
    throw new Error('The notification worker requires the production deployment configuration.');

const integrationsOnly = process.env.UIER_INTEGRATIONS_ONLY === '1';
if (integrationsOnly && process.env.UIER_NOTIFICATION_RETRY_DELIVERY)
    throw new Error('An integration-only run cannot retry an email delivery.');
const baseUrl = configuredAppBaseUrl();
if (!baseUrl) throw new Error('The notification worker requires a trusted application URL.');
async function verifyWorkerAccess() {
    // Missing-document reads validate all data scopes without reading customer records or writing.
    const containers = [cosmosDataContainerComments(), cosmosDataContainerApp(),
        cosmosDataContainerComments().database.container('comments-preview')];
    for (const container of containers) {
        try { await container.item('__uier_worker_oidc_probe__', '__uier_worker_oidc_probe__').read(); }
        catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 404) throw error; }
    }
    for (const name of ['screenshots', 'screenshots-preview']) await getScreenshotBlobStore(name).listBefore(new Date(0));
    console.info('[worker] Azure OIDC data access verified for all worker containers.');
}
await verifyWorkerAccess();
if (process.env.UIER_WORKER_VERIFY_ONLY !== '1') {
    if (!integrationsOnly) {
        const comments = getCommentsStore();
        try {
            const migration = await comments.migrateScreenshots?.();
            console.info(`[screenshots] Migrated ${migration?.migrated ?? 0} legacy production images; ${migration?.failed ?? 0} need retry.`);
            if (migration?.failed) process.exitCode = 1;
        } catch { console.error('[screenshots] Production migration needs retry'); process.exitCode = 1; }
        // The production worker owns both environments; preview deployments cannot access production.
        const preview = createCosmosCommentsStore(() => cosmosDataContainerComments().database.container('comments-preview'),
            () => getScreenshotBlobStore('screenshots-preview'));
        try {
            const previewMigration = await preview.migrateScreenshots!();
            const previewCleanup = await preview.sweepScreenshotBlobs!(Date.now());
            console.info(`[screenshots] Migrated ${previewMigration.migrated} legacy preview images; swept ${previewCleanup.removed} preview blobs.`);
            if (previewMigration.failed || previewCleanup.failed) process.exitCode = 1;
        } catch { console.error('[screenshots] Preview migration/cleanup needs retry'); process.exitCode = 1; }
        // Before the comment sweep, which then completes the thread cleanups a project deletion queued
        const deletions = await sweepProjectDeletions({ comments });
        if (deletions.failed) { console.error(`[projects] ${deletions.failed} project deletions need retry.`); process.exitCode = 1; }
        // Transfers an interrupted request left: finished after the switch, given up before it
        const transfers = await sweepProjectTransfers();
        if (transfers.failed) { console.error(`[projects] ${transfers.failed} project transfers need retry.`); process.exitCode = 1; }
        const cleanup = await sweepCommentCleanup(comments);
        console.info(`[comments] Swept ${cleanup.removed} orphan screenshots; ${cleanup.failed} cleanups need retry.`);
        if (cleanup.failed) process.exitCode = 1;
        // Missing email settings are a configuration error, not a delivery failure: leave every ledger
        // queued with its failure budget intact instead of failing each attempt.
        if (!process.env.ACS_CONNECTION_STRING || !process.env.UIER_EMAIL_SENDER) {
            console.error('[notifications] Email is not configured (ACS_CONNECTION_STRING, UIER_EMAIL_SENDER); delivery skipped.');
            process.exitCode = 1;
        } else {
            if (process.env.UIER_NOTIFICATION_RETRY_DELIVERY) await retryNotificationDelivery(process.env.UIER_NOTIFICATION_RETRY_DELIVERY);
            const result = await runNotificationWorker(baseUrl);
            console.info(`[notifications] Checked ${result.checked} delivery ledgers; ${result.failed} attempts failed; ${result.blocked} require review.`);
            // Ids are hashes and codes are bounded classes: no recipient or content reaches the log.
            for (const ledger of result.review)
                console.info(`::warning title=Notification delivery needs review::${ledger.id} is ${ledger.status} (${ledger.lastCode}). After fixing the cause, run this workflow with retry_delivery set to this id.`);
            // Only this run's failed attempts fail it. A ledger waiting for review stays listed above:
            // failing every run for it kept the workflow red long after delivery recovered.
            if (result.failed) process.exitCode = 1;
        }
    } else console.info('[notifications] Email delivery skipped for this integration-only run.');
    const integrations = await runIntegrationWorker(baseUrl);
    console.info(`[integrations] Discovered ${integrations.discovered.checked} source changes; ${integrations.discovered.deferred} deferred.`);
    for (const provider of integrations.providers)
        console.info(`[${provider.provider}] Checked ${provider.checked} sync ledgers; ${provider.blocked} require review; ${provider.deferred} deferred for time.`);
    if (integrations.blocked) process.exitCode = 1;
    // After integrations, so replies and status imported this run are delivered too. A subscriber's
    // unreachable endpoint is its own problem: only an unexpected worker error fails the run.
    try {
        const events = await runMcpEventWorker(baseUrl, { deadline: Date.now() + 60_000 });
        console.info(`[mcp-events] ${events.projects} projects: ${events.discovered} new deliveries, ${events.delivered} delivered, ${events.retrying} retrying, ${events.failed} failed, ${events.skipped} skipped; ${events.deferred} projects deferred.`);
    } catch (error) {
        console.error(`[mcp-events] Event delivery needs retry (${error instanceof Error ? error.name : 'Error'}).`);
        process.exitCode = 1;
    }
}
