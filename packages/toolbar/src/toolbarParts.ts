/**
 * The names of the toolbar's parts in anchors on uier's own pages (pure: shared with the feedback
 * packet and the app, `@uier/toolbar/feedback-context`). Saved selectors come from reviewers'
 * browsers: only these names are read from them, and the result is plain text.
 */

/** Anchors on the toolbar cross its shadow boundary once: `#uier-toolbar>>>` and a selector inside it */
export const toolbarAnchorPrefix = '#uier-toolbar>>>';

/**
 * The parts that can be reviewed, by the id or class that names them in anchors, and their name in
 * words. The pill and the panels (the inbox, Accessibility and SEO) are named by their ids, the
 * pill and the inbox as in anchors saved before; popovers and menus have a
 * class, since their id is the one the popover gives itself (the `aria-controls` of its button).
 */
export const toolbarParts = {
    'uier-feedback-toolbar': 'toolbar',
    'uier-panel-inbox': 'inbox',
    'uier-panel-accessibility': 'accessibility panel',
    'uier-panel-seo': 'SEO panel',
    'uier-thread': 'comment thread',
    'uier-thread-menu': 'thread options',
    'uier-thread-status-menu': 'thread status',
    'uier-message-menu': 'message options',
    'uier-reaction-picker': 'reaction picker',
    'uier-copy-menu': 'copy menu',
    'uier-device': 'device details',
    'uier-screenshot': 'screenshot',
    'uier-feedback': 'feedback form',
    'uier-profile': 'profile',
    'uier-options': 'options',
    'uier-locations': 'location filter',
    'uier-status-filter-menu': 'status filter',
    'uier-panel-switch': 'panel menu'
} as const;

export type ToolbarPart = keyof typeof toolbarParts;

const partIds: readonly string[] = ['uier-feedback-toolbar', 'uier-panel-inbox', 'uier-panel-accessibility', 'uier-panel-seo'] satisfies ToolbarPart[];

/** Every reviewable part, as a selector list */
export const toolbarPartsSelector = Object.keys(toolbarParts)
    .map(name => partIds.includes(name) ? `#${name}` : `.${name}`).join(',');

/** A saved comment's pin is named by its id (`#uier-pin-<id>`), when it opens the thread an anchor is in */
export const toolbarPinPrefix = 'uier-pin-';

/** The part's own segment of an anchor (`#uier-panel-inbox`, `div.uier-thread`) for a part element */
export function toolbarPartSegment(name: ToolbarPart, tagName: string) {
    return partIds.includes(name) ? `#${name}` : `${tagName.toLowerCase()}.${name}`;
}

/**
 * The part an anchor is in, in words ("comment thread" for `#uier-toolbar>>>div.uier-thread>…`):
 * `undefined` for an anchor on the page.
 */
export function toolbarPartLabel(selector: string | undefined): string | undefined {
    if (!selector?.startsWith(toolbarAnchorPrefix)) return undefined;
    const first = selector.slice(toolbarAnchorPrefix.length).split(/[>,]/)[0]?.trim() ?? '';
    const name = /^(?:#|[a-z][a-z0-9-]*\.)([a-z-]+)/i.exec(first)?.[1] ?? '';
    if (first.startsWith(`#${toolbarPinPrefix}`)) return 'comment pin';
    return Object.hasOwn(toolbarParts, name) ? toolbarParts[name as ToolbarPart] : 'toolbar';
}
