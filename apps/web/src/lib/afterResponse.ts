type AfterResponse = (task: () => Promise<void>) => void;
// On globalThis: instrumentation and route bundles may hold separate copies of this module.
const schedulerKey = Symbol.for('uier.after-response');
const registry = globalThis as typeof globalThis & { [schedulerKey]?: AfterResponse };

/**
 * Next.js registers its `after()` at server start (`instrumentation.ts`). Library code stays free
 * of `next/*` imports, so API specs and the scheduled worker load it without the framework.
 */
export function registerAfterResponse(after: AfterResponse) {
    registry[schedulerKey] = after;
}

/**
 * Runs `task` once the response is sent. Without a registered scheduler or request scope (the
 * scheduled worker, API specs) nothing runs and this returns `false`.
 */
export function afterResponse(task: () => Promise<void>) {
    const after = registry[schedulerKey];
    if (!after) return false;
    try {
        after(task);
        return true;
    } catch {
        // Not in a request scope.
        return false;
    }
}
