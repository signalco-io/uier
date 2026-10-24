/**
 * Review links and the review session.
 *
 * In `review` mode the toolbar mounts only when the page was opened with a review link:
 *
 * - `?toolbar-code=<project code>`: the review link of a project (the code identifies the
 *   project in the uier app)
 * - `?review=true`: a review without a project code
 *
 * The review then lasts for the browser tab (`sessionStorage`), so it continues on other pages
 * of the site, until the reviewer chooses "Exit review".
 */

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
