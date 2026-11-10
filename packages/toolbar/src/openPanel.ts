import { createContext } from 'react';
import type { CommentsFilter } from './components/sidebar/CommentsFilter';
import { panelSide } from './components/DockablePanel';

/** A docked panel: the inbox, the Accessibility or the SEO panel */
export type DockPanelId = 'inbox' | 'accessibility' | 'seo';

const storageKey = 'uier:toolbar-panel';
const isDockPanel = (value: unknown): value is DockPanelId => value === 'inbox' || value === 'accessibility' || value === 'seo';

/**
 * The open panels that can stay open together, oldest first: one on each side where two fit side by
 * side (`sideBySide`), else one. The newest stays; an older one on its side closes.
 */
export function fitPanels(panels: readonly DockPanelId[], sideBySide: boolean): DockPanelId[] {
    const kept: DockPanelId[] = [];
    for (const panel of [...panels].reverse()) {
        if (kept.includes(panel)) continue;
        if (kept.length && (!sideBySide || kept.some(other => panelSide(other) === panelSide(panel)))) continue;
        kept.unshift(panel);
    }
    return kept.length === panels.length && kept.every((panel, index) => panel === panels[index]) ? panels as DockPanelId[] : kept;
}

// The review layer remounts for every page (`CommentsGlobal` is keyed by the path), so what stays
// open lives here for client-side navigation and in `sessionStorage` for a full page load
let memory: { panels?: DockPanelId[]; filter?: CommentsFilter } = {};
let documentRead = false;

/**
 * This document continues the tab's review on the site: a link or redirect on it, back or forward, or
 * a reload. A window opened from the site gets a copy of its `sessionStorage` and its referrer, but
 * starts its own history: it is a page opened anew.
 */
function fromThisSite() {
    const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type === 'reload' || navigation?.type === 'back_forward') return true;
    if (history.length < 2) return false;
    try {
        return Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin;
    } catch {
        return false;
    }
}

/**
 * The panels open on the previous page (two when they were docked on different sides), oldest first:
 * after a client-side navigation always, after a full page load only when it came from this site
 * (not a page opened anew, such as a review link)
 */
export function readOpenPanels(): DockPanelId[] {
    if (!documentRead) {
        documentRead = true;
        try {
            // "inbox,seo"; a single panel was saved as its id before
            const saved = window.sessionStorage.getItem(storageKey)?.split(',').filter(isDockPanel) ?? [];
            memory.panels = saved.length && fromThisSite() ? [...new Set(saved)].slice(-2) : undefined;
        } catch {
            // Not kept across full page loads
        }
    }
    return memory.panels ?? [];
}

export function rememberOpenPanels(panels: readonly DockPanelId[]) {
    memory.panels = [...panels];
    try {
        if (panels.length) window.sessionStorage.setItem(storageKey, panels.join(','));
        else window.sessionStorage.removeItem(storageKey);
    } catch {
        // Kept for client-side navigation only
    }
}

/**
 * The inbox's filter on the previous page, for client-side navigation only: its search text is never
 * written to the site's storage
 */
export function readInboxFilter() {
    return memory.filter;
}

export function rememberInboxFilter(filter: CommentsFilter) {
    memory.filter = filter;
}

/** "Exit review": the next review starts without a panel */
export function forgetOpenPanel() {
    memory = {};
    rememberOpenPanels([]);
}

/**
 * The panels that were open on the previous page and stay open on this one: they neither slide in
 * nor take the focus, so the page keeps them after a link. Closing a panel takes it out.
 */
export const RestoredPanelContext = createContext<readonly DockPanelId[]>([]);
