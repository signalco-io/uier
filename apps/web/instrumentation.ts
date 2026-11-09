/**
 * Runs once per Node.js server instance. Gives library code Next.js's `after()` without importing
 * the framework, so API specs and the scheduled worker load the same modules without it.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const [{ after }, { registerAfterResponse }] = await Promise.all([import('next/server'), import('./src/lib/afterResponse')]);
    registerAfterResponse(after);
}
