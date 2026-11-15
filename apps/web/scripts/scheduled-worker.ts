import { handleSchedule } from '@vercel/schedules';
import { assertWorkerEnvironment, runScheduledWorker } from '../src/lib/worker/run';
import { withWorkerRequest } from '../src/lib/worker/oidc';

// The deployment exposes this only as a private schedule/v1beta function, never an HTTP route.
// Event data cannot select a recovery id, preview access or alternate identity.
export const POST = handleSchedule(async (metadata, request) => {
    if (metadata.name !== 'review-notifications' || metadata.namespace !== 'default' || metadata.source !== 'static')
        throw new Error('Unexpected worker schedule.');
    assertWorkerEnvironment('vercel');
    process.env.UIER_COSMOS_WORKLOAD = 'scheduled';
    const startedAt = new Date().toISOString();
    let result;
    try { result = await withWorkerRequest(request, () => runScheduledWorker()); }
    catch (error) {
        const errorClass = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error';
        console.error('[worker]', JSON.stringify({ status: 'failed', errorClass, startedAt, finishedAt: new Date().toISOString() }));
        // Access/storage errors may contain provider details. Do not expose them through the launcher.
        throw new Error('The scheduled worker needs retry.');
    }
    console.info('[worker]', JSON.stringify({ ...result,
        scheduledAt: metadata.scheduledAt.toISOString(), startedAt, finishedAt: new Date().toISOString() }));
    if (result.failed) throw new Error('The scheduled worker needs retry.');
});

// Vercel's Node.js launcher accepts the Fetch handler object for standalone functions.
export default { fetch: POST };
