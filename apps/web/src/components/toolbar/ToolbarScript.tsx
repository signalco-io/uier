import Script from 'next/script';

/**
 * - `showcase`: always mounted, anyone can leave public feedback (the landing page)
 * - `review`: mounted only when the page URL has `?review=true`
 */
export type ToolbarMode = 'showcase' | 'review';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * The toolbar bundle (packages/toolbar): `/toolbar.js` in production builds (copied by
 * scripts/copy-toolbar.mjs), the toolbar dev server's watch build in `next dev` (`pnpm dev`).
 */
export const toolbarScriptSrc = isDevelopment
    ? 'http://localhost:4005/index.js'
    : '/toolbar.js';

/**
 * Embeds the uier toolbar exactly like a customer site would:
 * `<script src="/toolbar.js" data-uier-mode="showcase"></script>`.
 *
 * The toolbar reads its configuration from its own script tag and calls the comments API on the
 * script's origin (this app). `next/script` also loads it after client-side navigation.
 */
export function ToolbarScript({ mode }: { mode: ToolbarMode }) {
    return (
        <Script
            src={toolbarScriptSrc}
            data-uier-mode={mode}
            strategy="afterInteractive" />
    );
}
