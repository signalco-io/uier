import type { DbProject } from '../app/model';
import { afterResponse } from '../afterResponse';
import { configuredAppBaseUrl } from '../app/deployment';
import { isUierFeedbackProject } from '../comments/publicProjectPolicy';
import { integrationTargets } from './syncSignal';

/** Inline delivery budget, inside every route's platform limit */
const AFTER_CHANGE_BUDGET_MS = 15_000;

/**
 * After a change to an existing thread, update the copies it already has once the response is
 * sent (`deliverNow.ts`). New threads are not passed here: they keep the worker's batching window.
 * Without a registered scheduler or request scope (the scheduled worker, API specs) this does
 * nothing, and the worker delivers the same change on its next run.
 */
export function queueIntegrationDelivery(project: Pick<DbProject, 'id' | 'integrations'>, threadId: string) {
    if (isUierFeedbackProject(project.id) || !integrationTargets(project).length) return;
    afterResponse(async () => {
        try {
            // Loaded here: delivery reads review services that import this module.
            const [{ deliverThreadNow }, { appBaseUrl }] = await Promise.all([import('./deliverNow'), import('../app/request')]);
            const baseUrl = configuredAppBaseUrl() ?? await appBaseUrl().catch(() => undefined);
            if (baseUrl) await deliverThreadNow(project.id, threadId, { baseUrl, deadline: Date.now() + AFTER_CHANGE_BUDGET_MS });
        } catch (error) {
            // No identifiers, URLs or payloads in logs.
            console.warn(`[integrations] Delivery after a change failed (${error instanceof Error ? error.name : 'Error'}); the scheduled worker retries.`);
        }
    });
}
