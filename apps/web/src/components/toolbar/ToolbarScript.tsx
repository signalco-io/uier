import { UierToolbar } from '@uier/toolbar/react';

/**
 * - `showcase`: always mounted, anyone can leave public feedback (every public page)
 * - `review`: mounted when the page is opened with a review link (`?toolbar-code=...` or `?review=true`)
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
 * Embeds the uier toolbar with its React component (`@uier/toolbar/react`), exactly like a
 * customer site would. It adds `<script src="/toolbar.js" data-uier-mode="showcase">` to the page.
 *
 * The toolbar reads its configuration from its own script tag and calls the comments API on the
 * script's origin (this app). It stays mounted across client-side navigation.
 */
export function ToolbarScript({ mode }: { mode: ToolbarMode }) {
    return <UierToolbar src={toolbarScriptSrc} mode={mode} />;
}
