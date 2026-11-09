/**
 * Resolves once the page has stopped rendering: parsed, then no node added, removed or edited for
 * `quiet` ms, and at the latest after `limit` ms (a page that always changes). For checks that run
 * right after a navigation, when the new page can still be rendering or streaming in.
 */
export function pageSettled({ quiet = 300, limit = 3000 }: { quiet?: number; limit?: number } = {}) {
    let observer: MutationObserver | undefined;
    let quietTimer: number | undefined;
    let limitTimer: number | undefined;
    let onLoaded: (() => void) | undefined;
    const stop = () => {
        observer?.disconnect();
        window.clearTimeout(quietTimer);
        window.clearTimeout(limitTimer);
        if (onLoaded) document.removeEventListener('DOMContentLoaded', onLoaded);
    };
    const promise = new Promise<void>(resolve => {
        const done = () => { stop(); resolve(); };
        const watch = () => {
            const restart = () => {
                window.clearTimeout(quietTimer);
                quietTimer = window.setTimeout(done, quiet);
            };
            observer = new MutationObserver(restart);
            observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
            restart();
        };
        limitTimer = window.setTimeout(done, limit);
        if (document.readyState === 'loading') {
            onLoaded = watch;
            document.addEventListener('DOMContentLoaded', onLoaded, { once: true });
        } else watch();
    });
    return { promise, cancel: stop };
}
