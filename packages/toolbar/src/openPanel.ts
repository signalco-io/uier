import { createContext } from 'react';
import type { CommentsFilter } from './components/sidebar/CommentsFilter';

/** The docked panel that is open: the inbox, or the Accessibility or SEO panel (one at a time) */
export type DockPanelId = 'inbox' | 'accessibility' | 'seo';

const storageKey = 'uier:toolbar-panel';
const isDockPanel = (value: unknown): value is DockPanelId => value === 'inbox' || value === 'accessibility' || value === 'seo';

// The review layer remounts for every page (`CommentsGlobal` is keyed by the path), so what stays
// open lives here for client-side navigation and in `sessionStorage` for a full page load
let memory: { panel?: DockPanelId; filter?: CommentsFilter } = {};
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
 * The panel open on the previous page, if any: after a client-side navigation always, after a full
 * page load only when it came from this site (not a page opened anew, such as a review link)
 */
export function readOpenPanel(): DockPanelId | undefined {
    if (!documentRead) {
        documentRead = true;
        try {
            const saved = window.sessionStorage.getItem(storageKey);
            memory.panel = isDockPanel(saved) && fromThisSite() ? saved : undefined;
        } catch {
            // Not kept across full page loads
        }
    }
    return memory.panel;
}

export function rememberOpenPanel(panel: DockPanelId | undefined) {
    memory.panel = panel;
    try {
        if (panel) window.sessionStorage.setItem(storageKey, panel);
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
    rememberOpenPanel(undefined);
}

/**
 * The panel that was open on the previous page and stays open on this one: it neither slides in
 * nor takes the focus, so the page keeps it after a link. Opening a panel again clears it.
 */
export const RestoredPanelContext = createContext<DockPanelId | undefined>(undefined);
