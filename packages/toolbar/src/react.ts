import { useEffect } from 'react';
import { openFeedbackEvent } from './openFeedback';

/**
 * React integration of the uier toolbar (`@uier/toolbar/react`, built to `dist/react.js`).
 *
 * Renders nothing: it adds the toolbar script to the page once, exactly like the script tag in
 * the README does. Render it once, e.g. in the root layout:
 *
 *     <UierToolbar project="k3m9x2p7q4ab" />  // a project's site, opened with its review links
 *     <UierToolbar mode="showcase" />         // always shown
 *
 * `openUierFeedback()` opens the toolbar's feedback form from a button of your own.
 */

export type UierToolbarProps = {
    /**
     * - `review` (default): the toolbar appears when the page is opened with a review link
     *   (`?toolbar-code=<project code>` or `?review=true`) and stays for the browser tab
     * - `showcase`: always shown
     */
    mode?: 'review' | 'showcase';
    /**
     * The uier project code from the app's install guide (`data-uier-project`). The comments then
     * belong to the project and its "who can comment" setting applies. Sites other than uier.io
     * need it to load and post comments.
     */
    project?: string;
    /** URL of the toolbar script. Default: https://uier.io/toolbar.js */
    src?: string;
    /** Base URL of the uier API. Default: the origin of `src` */
    apiUrl?: string;
};

export const defaultToolbarScriptSrc = 'https://uier.io/toolbar.js';

export function UierToolbar({ mode = 'review', project, src = defaultToolbarScriptSrc, apiUrl }: UierToolbarProps) {
    useEffect(() => {
        // Once per page: the toolbar stays mounted across client-side navigation, and the
        // script would not mount it twice anyway
        const existing = [...document.querySelectorAll<HTMLScriptElement>('script[data-uier-mode]')]
            .some(script => script.getAttribute('src') === src);
        if (existing) {
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.uierMode = mode;
        if (project) {
            script.dataset.uierProject = project;
        }
        if (apiUrl) {
            script.dataset.uierApiUrl = apiUrl;
        }
        document.body.appendChild(script);
    }, [mode, project, src, apiUrl]);

    return null;
}

/**
 * Opens the toolbar's feedback form, e.g. from a "Give feedback" button. A toolbar already on the
 * page opens its form; otherwise the first call adds the toolbar script in `feedback` mode, which
 * mounts the toolbar with the form open (and can be closed from its options).
 */
export function openUierFeedback({ project, src = defaultToolbarScriptSrc, apiUrl }: Omit<UierToolbarProps, 'mode'> = {}) {
    window.dispatchEvent(new Event(openFeedbackEvent));
    if (document.querySelector('script[data-uier-mode="feedback"]')) {
        return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.uierMode = 'feedback';
    if (project) {
        script.dataset.uierProject = project;
    }
    if (apiUrl) {
        script.dataset.uierApiUrl = apiUrl;
    }
    document.body.appendChild(script);
}
