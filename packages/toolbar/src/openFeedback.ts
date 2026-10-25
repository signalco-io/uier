/**
 * Opening the toolbar's feedback form from the page, e.g. a "Give feedback" button
 * (`openUierFeedback()` in `@uier/toolbar/react`). No side effects: the React entry imports it too.
 */

/** Dispatched on `window`: a mounted toolbar opens its feedback form, `feedback` mode mounts one first */
export const openFeedbackEvent = 'uier:open-feedback';

let requestedOnMount = false;

/** `feedback` mode mounts the toolbar because someone asked to give feedback */
export function requestFeedbackOnMount() {
    requestedOnMount = true;
}

/** Whether the toolbar that is mounting should open its feedback form (once) */
export function takeFeedbackRequest() {
    const requested = requestedOnMount;
    requestedOnMount = false;
    return requested;
}
