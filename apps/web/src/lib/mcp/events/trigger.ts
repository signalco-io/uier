import { PUBLIC_PROJECT_ID } from '../../comments/publicProjectPolicy';
import { configuredAppBaseUrl } from '../../app/deployment';

/** Inline delivery budget, inside every route's platform limit */
const AFTER_CHANGE_BUDGET_MS = 10_000;

type AfterResponse = (task: () => Promise<void>) => void;
// On globalThis: instrumentation and route bundles may hold separate copies of this module.
const schedulerKey = Symbol.for('uier.mcp-events.after-response');
const registry = globalThis as typeof globalThis & { [schedulerKey]?: AfterResponse };

/**
 * Next.js registers its `after()` at server start (`instrumentation.ts`). Library code stays free
 * of `next/*` imports, so API specs and the scheduled worker load it without the framework.
 */
export function registerAfterResponse(after: AfterResponse) {
    registry[schedulerKey] = after;
}

/**
 * After a change that recorded a thread event, deliver the project's MCP events once the response
 * is sent. Without a registered scheduler or request scope (the scheduled worker, API specs) this
 * does nothing: the worker's sweep discovers the same events and retries what this could not send.
 */
export function queueMcpEventDelivery(projectId: string) {
    const after = registry[schedulerKey];
    // The public showcase project is never reachable through MCP.
    if (!after || projectId === PUBLIC_PROJECT_ID) return;
    try {
        after(async () => {
            try {
                // Loaded here: the delivery module reads review services that import this one.
                const [{ dispatchProjectEvents }, { appBaseUrl }] = await Promise.all([import('./delivery'), import('../../app/request')]);
                const baseUrl = configuredAppBaseUrl() ?? await appBaseUrl().catch(() => undefined);
                await dispatchProjectEvents(projectId, { baseUrl, deadline: Date.now() + AFTER_CHANGE_BUDGET_MS });
            } catch (error) {
                // No identifiers, URLs or payloads in logs.
                console.warn(`[mcp-events] Delivery after a change failed (${error instanceof Error ? error.name : 'Error'}); the scheduled worker retries.`);
            }
        });
    } catch { /* Not in a request scope. */ }
}
