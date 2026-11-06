import { openUierFeedback, UierToolbar } from '@uier/toolbar/react';

/**
 * - `showcase`: always mounted, anyone can leave public feedback (every public page)
 * - `review`: mounted when the page is opened with a review link (`?toolbar-code=...` or `?review=true`)
 */
export type ToolbarMode = 'showcase' | 'review';

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * The toolbar bundle (packages/toolbar): `/toolbar.js` in production builds (copied by
 * scripts/copy-toolbar.mjs), the toolbar dev server's watch build in `next dev` (`pnpm dev`,
 * the port after this app's; next.config.ts).
 */
export const toolbarScriptSrc = isDevelopment
    ? `${process.env.UIER_TOOLBAR_DEV_ORIGIN}/index.js`
    : '/toolbar.js';

/**
 * Embeds the uier toolbar with its React component (`@uier/toolbar/react`), exactly like a
 * customer site would. It adds `<script src="/toolbar.js" data-uier-mode="showcase">` to the page.
 *
 * The toolbar reads its configuration from its own script tag and calls the comments API on the
 * script's origin (this app). It stays mounted across client-side navigation.
 */
export function ToolbarScript({ mode }: { mode: ToolbarMode }) {
    return <UierToolbar src={toolbarScriptSrc} mode={mode} />;
}

/**
 * Opens the feedback form of uier's own toolbar on this page (the showcase on public pages; in the
 * app it mounts the toolbar first). Feedback goes to this app's API, also in development, where
 * the toolbar script comes from its own server. Call it from a click handler.
 */
export function openToolbarFeedback() {
    openUierFeedback({ src: toolbarScriptSrc, apiUrl: window.location.origin });
}
