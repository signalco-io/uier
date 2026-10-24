import { useEffect } from 'react';

/**
 * React integration of the uier toolbar (`@uier/toolbar/react`, built to `dist/react.js`).
 *
 * Renders nothing: it adds the toolbar script to the page once, exactly like the script tag in
 * the README does. Render it once, e.g. in the root layout:
 *
 *     <UierToolbar />                     // review links (?toolbar-code=..., ?review=true)
 *     <UierToolbar mode="showcase" />     // always shown
 */

export type UierToolbarProps = {
    /**
     * - `review` (default): the toolbar appears when the page is opened with a review link
     *   (`?toolbar-code=<project code>` or `?review=true`) and stays for the browser tab
     * - `showcase`: always shown
     */
    mode?: 'review' | 'showcase';
    /** URL of the toolbar script. Default: https://uier.io/toolbar.js */
    src?: string;
    /** Base URL of the uier API. Default: the origin of `src` */
    apiUrl?: string;
};

export const defaultToolbarScriptSrc = 'https://uier.io/toolbar.js';

export function UierToolbar({ mode = 'review', src = defaultToolbarScriptSrc, apiUrl }: UierToolbarProps) {
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
        if (apiUrl) {
            script.dataset.uierApiUrl = apiUrl;
        }
        document.body.appendChild(script);
    }, [mode, src, apiUrl]);

    return null;
}
