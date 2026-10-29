import { getCommentsStore } from '../src/lib/repo/commentsStore';
import { createCosmosCommentsStore } from '../src/lib/repo/cosmosCommentsStore';
import { cosmosDataContainerComments } from '../src/lib/db/client';
import { getScreenshotBlobStore } from '../src/lib/screenshots/blobStore';
import { sweepCommentCleanup } from '../src/lib/comments/cleanup';
import { retryNotificationDelivery, runNotificationWorker } from '../src/lib/notifications/delivery';
import { configuredAppBaseUrl } from '../src/lib/app/deployment';
import { runIntegrationWorker } from '../src/lib/integrations/worker';

if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || !process.env.COSMOSDB_CONNECTION_STRING || !process.env.UIER_COMMENTS_SECRET)
    throw new Error('The notification worker requires the production deployment configuration.');

if (process.env.UIER_NOTIFICATION_RETRY_DELIVERY) await retryNotificationDelivery(process.env.UIER_NOTIFICATION_RETRY_DELIVERY);
const baseUrl = configuredAppBaseUrl();
if (!baseUrl) throw new Error('The notification worker requires a trusted application URL.');
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
const cleanup = await sweepCommentCleanup(comments);
console.info(`[comments] Swept ${cleanup.removed} orphan screenshots; ${cleanup.failed} cleanups need retry.`);
if (cleanup.failed) process.exitCode = 1;
const result = await runNotificationWorker(baseUrl);
console.info(`[notifications] Checked ${result.checked} delivery ledgers; ${result.blocked} require review.`);
if (result.blocked) process.exitCode = 1;
const integrations = await runIntegrationWorker(baseUrl);
console.info(`[integrations] Discovered ${integrations.discovered.checked} source changes; ${integrations.discovered.deferred} deferred.`);
for (const provider of integrations.providers)
    console.info(`[${provider.provider}] Checked ${provider.checked} sync ledgers; ${provider.blocked} require review; ${provider.deferred} deferred for time.`);
if (integrations.blocked) process.exitCode = 1;
