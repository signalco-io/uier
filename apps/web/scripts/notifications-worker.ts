import { sweepCommentCleanup } from '../src/lib/comments/cleanup';
import { retryNotificationDelivery, runNotificationWorker } from '../src/lib/notifications/delivery';
import { configuredAppBaseUrl } from '../src/lib/app/deployment';
import { runIntegrationWorker } from '../src/lib/integrations/worker';

if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || !process.env.COSMOSDB_CONNECTION_STRING || !process.env.UIER_COMMENTS_SECRET)
    throw new Error('The notification worker requires the production deployment configuration.');

if (process.env.UIER_NOTIFICATION_RETRY_DELIVERY) await retryNotificationDelivery(process.env.UIER_NOTIFICATION_RETRY_DELIVERY);
const baseUrl = configuredAppBaseUrl();
if (!baseUrl) throw new Error('The notification worker requires a trusted application URL.');
const cleanup = await sweepCommentCleanup();
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
