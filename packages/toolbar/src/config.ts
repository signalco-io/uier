/**
 * Toolbar configuration, read synchronously while the toolbar script runs.
 *
 * Embed the toolbar with a classic script tag:
 *     <script src="https://uier.io/toolbar.js" data-uier-project="V1StGXR8_Z5jdHi6B-myT" defer></script>
 * or configure it before the script runs:
 *     <script>window.uierConfig = { mode: 'showcase', apiUrl: 'https://uier.io' };</script>
 */

export type ToolbarMode = 'showcase' | 'review' | 'feedback';

export type ToolbarConfig = {
    /**
     * - `review` (default): mounts for an authenticated project member or a review link,
     *   `?toolbar-code=<project code>` or `?review=true`, then for the rest of the browser tab
     *   until "Exit review" (`src/review.ts`)
     * - `showcase`: always mounted, shows a first-run hint, anyone can leave public feedback
     * - `feedback`: mounted when the page asks for it (the script loading, then `uier:open-feedback`,
     *   see `openFeedback.ts`) with the feedback form open; it can be closed again
     */
    mode: ToolbarMode;
    /** Base URL of the uier comments API (origin, optional path prefix), without a trailing slash */
    apiUrl: string;
    /**
     * The uier project code (from the app's install guide). With a project, comments belong to the
     * project and its access settings apply (`/api/review/<project>`); without one, to the domain
     * (`/api/comments`, the uier.io showcase). This is the project a review applies to, whichever
     * review link started it: the link only starts the review.
     */
    project?: string;
};

export type ToolbarWindowConfig = {
    mode?: string;
    apiUrl?: string;
    project?: string;
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
    if (typeof HTMLScriptElement !== 'undefined' && current instanceof HTMLScriptElement) {
        return current;
    }

    // Module scripts have no `currentScript`; fall back to the tag that configures the toolbar
    return typeof document !== 'undefined'
        ? document.querySelector<HTMLScriptElement>('script[data-uier-project], script[data-uier-mode]')
        : null;
}

function readMode(value: string | undefined): ToolbarMode | undefined {
    return value === 'showcase' || value === 'review' || value === 'feedback' ? value : undefined;
}

function readProject(value: string | undefined) {
    const project = value?.trim();
    return project && /^(?:[0-9a-z]{12}|[A-Za-z0-9_-]{21})$/.test(project) ? project : undefined;
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

/** Ignore named elements, inherited fields, accessors and malformed values on the host page. */
function readWindowConfig(): ToolbarWindowConfig {
    try {
        const value: unknown = typeof window !== 'undefined' ? window.uierConfig : undefined;
        if (!value || typeof value !== 'object') return {};
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return {};
        const config: ToolbarWindowConfig = {};
        for (const field of ['mode', 'apiUrl', 'project'] as const) {
            const entry = Object.getOwnPropertyDescriptor(value, field)?.value;
            if (typeof entry === 'string') config[field] = entry;
        }
        return config;
    } catch { return {}; }
}

export function readToolbarConfig(): ToolbarConfig {
    const script = getToolbarScript();
    const windowConfig = readWindowConfig();

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
        apiUrl: trimTrailingSlash(apiUrl),
        project: readProject(script?.dataset.uierProject) ?? readProject(windowConfig?.project)
    };
}

/** Configuration of this toolbar instance (read once, while the script runs) */
export const toolbarConfig = readToolbarConfig();
