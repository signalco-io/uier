import { retryNotificationDelivery, runNotificationWorker } from '../src/lib/notifications/delivery';
import { configuredAppBaseUrl } from '../src/lib/app/deployment';

if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || !process.env.COSMOSDB_CONNECTION_STRING || !process.env.UIER_COMMENTS_SECRET)
    throw new Error('The notification worker requires the production deployment configuration.');

if (process.env.UIER_NOTIFICATION_RETRY_DELIVERY) await retryNotificationDelivery(process.env.UIER_NOTIFICATION_RETRY_DELIVERY);
const baseUrl = configuredAppBaseUrl();
if (!baseUrl) throw new Error('The notification worker requires a trusted application URL.');
const result = await runNotificationWorker(baseUrl);
console.info(`[notifications] Checked ${result.checked} delivery ledgers; ${result.blocked} require review.`);
if (result.blocked) process.exitCode = 1;
