/**
 * Review links and the review session.
 *
 * In `review` mode the toolbar mounts only when the page was opened with a review link:
 *
 * - `?toolbar-code=<project code>`: the review link of a project, as the uier app makes them
 * - `?review=true`: a review link without a project code
 *
 * The link only starts the review. The project whose comments and settings apply is the script's
 * `data-uier-project` (`config.ts`), so `?review=true` on a project's site reviews that project.
 * The review then lasts for the browser tab (`sessionStorage`), so it continues on other pages
 * of the site, until the reviewer chooses "Exit review".
 */

import { storedPagePath } from './pageState';

export const reviewParamKey = 'review';
export const toolbarCodeParamKey = 'toolbar-code';

const reviewSessionStorageKey = 'uier:review';

/** Letters, digits, `-` and `_`, up to 64 characters */
const projectCodePattern = /^[A-Za-z0-9_-]{1,64}$/;

export type ReviewSession = {
    /** Project code from the review link (`?toolbar-code=`), when it had one */
    projectCode?: string;
};

export function isValidProjectCode(code: string | null | undefined): code is string {
    return typeof code === 'string' && projectCodePattern.test(code);
}

/** The review the URL starts, if it is a review link */
export function readReviewLink(url: URL): ReviewSession | null {
    const code = url.searchParams.get(toolbarCodeParamKey)?.trim();
    if (isValidProjectCode(code)) {
        return { projectCode: code };
    }
    if (code) {
        console.debug('uier-toolbar: Ignoring an invalid toolbar-code');
    }

    return url.searchParams.get(reviewParamKey) === 'true' ? {} : null;
}

function readSavedSession(): ReviewSession | null {
    try {
        const saved = window.sessionStorage.getItem(reviewSessionStorageKey);
        if (!saved) {
            return null;
        }
        const value = JSON.parse(saved) as { projectCode?: unknown } | null;
        if (typeof value !== 'object' || value === null) {
            return null;
        }
        return isValidProjectCode(value.projectCode as string | undefined)
            ? { projectCode: value.projectCode as string }
            : {};
    } catch {
        return null;
    }
}

function saveSession(session: ReviewSession) {
    try {
        window.sessionStorage.setItem(reviewSessionStorageKey, JSON.stringify(session));
    } catch {
        // Not remembered: the review ends when the reviewer leaves this page
    }
}

/**
 * The review of this page: started by a review link in the URL, or continued from earlier in
 * this tab. `null` when the page is not being reviewed.
 */
export function resolveReviewSession(): ReviewSession | null {
    const fromLink = readReviewLink(new URL(window.location.href));
    if (fromLink) {
        saveSession(fromLink);
        return fromLink;
    }

    return readSavedSession();
}

/** Ends the review in this tab and removes the review link parameters from the address */
export function endReviewSession() {
    try {
        window.sessionStorage.removeItem(reviewSessionStorageKey);
    } catch {
        // Nothing was remembered
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has(reviewParamKey) || url.searchParams.has(toolbarCodeParamKey)) {
        url.searchParams.delete(reviewParamKey);
        url.searchParams.delete(toolbarCodeParamKey);
        window.history.replaceState(window.history.state, '', url.toString());
    }
}

/** `?uier-comment=<comment id>`: a link to one comment ("Copy link"), opens its thread */
export const commentLinkParamKey = 'uier-comment';

/**
 * Link to a comment on its recorded, server-authorized source. In a review it carries the review link too, so the
 * toolbar opens for whoever follows it; showcase pages need none.
 *
 * Always on this page's origin: the stored path only replaces the path, so a path like `//host` or
 * `/\host` (which a browser would read as another site) can't lead away.
 */
export function commentLink(comment: { id: string; path: string; source?: { origin?: string; available: boolean } }, review: ReviewSession | null | undefined) {
    if (comment.source && !comment.source.available) return undefined;
    const origin = comment.source?.origin ?? window.location.origin;
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return undefined;
    const url = new URL(storedPagePath(comment.path, 1), origin);
    if (review?.projectCode) {
        url.searchParams.set(toolbarCodeParamKey, review.projectCode);
    } else if (review) {
        url.searchParams.set(reviewParamKey, 'true');
    }
    url.searchParams.set(commentLinkParamKey, comment.id);
    return url.toString();
}

/** The comment the page was opened for (`?uier-comment=`); the parameter is removed from the address */
export function takeLinkedCommentId() {
    const url = new URL(window.location.href);
    const id = url.searchParams.get(commentLinkParamKey);
    if (id === null) {
        return undefined;
    }

    url.searchParams.delete(commentLinkParamKey);
    window.history.replaceState(window.history.state, '', url.toString());
    return /^[A-Za-z0-9_.:-]{1,128}$/.test(id) ? id : undefined;
}
