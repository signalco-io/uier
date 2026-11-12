/**
 * A `fetch` the page has not wrapped: the one of a fresh, hidden `about:blank` frame (a new realm with the page's
 * origin, so same-origin requests stay same-origin). A page script can replace `window.fetch` and add credentials or
 * headers to every request, or change what it returns; the frame's own `fetch` is out of its reach, unless the page
 * also intercepts frame creation, which no ordinary wrapper does. `undefined` when the frame cannot give one (then the
 * caller reports the check as not done, never falls back to the page's `fetch`). `release` removes the frame: call it
 * after the response's headers are read (removing it aborts a request still on its way).
 */
export function pristineFetch(): { fetch: typeof fetch; release: () => void } | undefined {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.setProperty('display', 'none', 'important');
    try {
        document.documentElement.appendChild(frame);
        const own = frame.contentWindow?.fetch;
        if (typeof own !== 'function') {
            frame.remove();
            return undefined;
        }
        return { fetch: own.bind(frame.contentWindow), release: () => frame.remove() };
    } catch {
        frame.remove();
        return undefined;
    }
}
