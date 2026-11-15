import { assertWorkerEnvironment, runScheduledWorker } from '../src/lib/worker/run';

// Privileged recovery and preview maintenance remain manual Actions operations.
process.env.UIER_COSMOS_WORKLOAD = 'scheduled';
assertWorkerEnvironment('github-actions');
const result = await runScheduledWorker({ integrationsOnly: process.env.UIER_INTEGRATIONS_ONLY === '1',
    retryDelivery: process.env.UIER_NOTIFICATION_RETRY_DELIVERY, verifyOnly: process.env.UIER_WORKER_VERIFY_ONLY === '1',
    previewMaintenance: true });
console.info('[worker]', JSON.stringify(result));
if (result.failed || result.status === 'deferred' || result.status === 'busy') process.exitCode = 1;
