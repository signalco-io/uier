/**
 * Opening the toolbar from the page: its feedback form, e.g. a "Give feedback" button
 * (`openUierFeedback()` in `@uier/toolbar/react`), or a new comment, e.g. a "C" shortcut
 * (`startUierComment()`). No side effects: the React entry imports it too.
 */

/** Dispatched on `window`: a mounted toolbar opens its feedback form, `feedback` mode mounts one first */
export const openFeedbackEvent = 'uier:open-feedback';
/** Dispatched on `window`: a mounted toolbar starts placing a comment, `feedback` mode mounts one first */
export const startCommentEvent = 'uier:start-comment';

/** What the page asked the toolbar to open */
export type ToolbarRequest = 'feedback' | 'comment';

/** `data-uier-open` on a `feedback` mode script: what its first mount opens (default `feedback`) */
export function readToolbarRequest(value: string | undefined): ToolbarRequest {
    return value === 'comment' ? 'comment' : 'feedback';
}

let requestedOnMount: ToolbarRequest | undefined;

/** `feedback` mode mounts the toolbar because someone asked to give feedback or to comment */
export function requestOnMount(request: ToolbarRequest) {
    requestedOnMount = request;
}

/** What the toolbar that is mounting should open (once) */
export function takeToolbarRequest() {
    const requested = requestedOnMount;
    requestedOnMount = undefined;
    return requested;
}
