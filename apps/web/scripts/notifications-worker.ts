import { retryNotificationDelivery, runNotificationWorker } from '../src/lib/notifications/delivery';

if (process.env.UIER_DEPLOYMENT_ENV !== 'production' || !process.env.COSMOSDB_CONNECTION_STRING || !process.env.UIER_COMMENTS_SECRET)
    throw new Error('The notification worker requires the production deployment configuration.');

if (process.env.UIER_NOTIFICATION_RETRY_DELIVERY) await retryNotificationDelivery(process.env.UIER_NOTIFICATION_RETRY_DELIVERY);
const result = await runNotificationWorker(process.env.UIER_BASE_URL || 'https://uier.io');
console.info(`[notifications] Checked ${result.checked} delivery ledgers; ${result.blocked} require review.`);
if (result.blocked) process.exitCode = 1;
