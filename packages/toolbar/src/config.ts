/**
 * Toolbar configuration, read synchronously while the toolbar script runs.
 *
 * Embed the toolbar with a classic script tag:
 *     <script src="https://uier.io/toolbar.js" data-uier-mode="showcase" defer></script>
 * or configure it before the script runs:
 *     <script>window.uierConfig = { mode: 'showcase', apiUrl: 'https://uier.io' };</script>
 */

export type ToolbarMode = 'showcase' | 'review';

export type ToolbarConfig = {
    /**
     * - `review` (default): mounts only when the page URL contains `?review=true`
     * - `showcase`: always mounted, shows a first-run hint, anyone can leave public feedback
     */
    mode: ToolbarMode;
    /** Base URL of the uier comments API (origin, optional path prefix), without a trailing slash */
    apiUrl: string;
};

export type ToolbarWindowConfig = {
    mode?: string;
    apiUrl?: string;
};

declare global {
    interface Window {
        uierConfig?: ToolbarWindowConfig;
    }
}

function getToolbarScript(): HTMLScriptElement | null {
    // Only set while a classic script runs (including deferred and dynamically inserted ones),
    // so this has to be read synchronously at module start.
    const current = typeof document !== 'undefined' ? document.currentScript : null;
    if (current instanceof HTMLScriptElement) {
        return current;
    }

    // Module scripts have no `currentScript`; fall back to the tag that configures the toolbar
    return typeof document !== 'undefined'
        ? document.querySelector<HTMLScriptElement>('script[data-uier-mode]')
        : null;
}

function readMode(value: string | undefined): ToolbarMode | undefined {
    return value === 'showcase' || value === 'review' ? value : undefined;
}

function trimTrailingSlash(url: string) {
    return url.replace(/\/+$/, '');
}

function getScriptOrigin(script: HTMLScriptElement | null) {
    if (!script?.src) {
        return undefined;
    }

    try {
        const url = new URL(script.src, window.location.href);
        return url.protocol === 'http:' || url.protocol === 'https:'
            ? url.origin
            : undefined;
    } catch {
        return undefined;
    }
}

export function readToolbarConfig(): ToolbarConfig {
    const script = getToolbarScript();
    const windowConfig = typeof window !== 'undefined' ? window.uierConfig : undefined;

    const mode = readMode(script?.dataset.uierMode)
        ?? readMode(windowConfig?.mode)
        ?? 'review';

    // Explicit configuration wins. Otherwise the API is served by the same origin as the
    // toolbar script (so a preview deployment's toolbar talks to that preview's API).
    // The development build is served by the toolbar dev server (localhost:4005), which has
    // no API, so it always uses the build-time URL (the local web app).
    const explicitApiUrl = script?.dataset.uierApiUrl || windowConfig?.apiUrl;
    const apiUrl = explicitApiUrl
        || (__UIER_DEV__ ? undefined : getScriptOrigin(script))
        || __UIER_API_URL__;

    return {
        mode,
        apiUrl: trimTrailingSlash(apiUrl)
    };
}

/** Configuration of this toolbar instance (read once, while the script runs) */
export const toolbarConfig = readToolbarConfig();
