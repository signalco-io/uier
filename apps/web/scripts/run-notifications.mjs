import { loadWorkerSettings } from './worker-settings.mjs';

if (process.argv[2]) throw new Error('The worker does not accept an environment file.');
loadWorkerSettings(process.env.UIER_WORKER_SETTINGS);
await import('./notifications-worker.mjs');
