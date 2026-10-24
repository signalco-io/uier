import { useSyncExternalStore } from 'react';

// One set of listeners for every pin and highlight: a number that changes (once per frame at most)
// when anything on the page may have moved, so positions are measured again.

let version = 0;
let frame = 0;
const listeners = new Set<() => void>();
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;

function schedule() {
    if (frame) {
        return;
    }
    frame = window.requestAnimationFrame(() => {
        frame = 0;
        version++;
        listeners.forEach(listener => listener());
    });
}

function start() {
    window.addEventListener('resize', schedule);
    // Capture: scrolling inside a scrollable element moves its content too
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    // The page's content changes size (images, fonts, content loaded later)
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
    resizeObserver?.observe(document.documentElement);
    if (document.body) {
        resizeObserver?.observe(document.body);
    }
    // The page changed (a `<details>` opened, content was added or edited). The toolbar's own
    // updates are in its shadow root, which this doesn't observe.
    mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(document.body ?? document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
    });
}

function stop() {
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, { capture: true });
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    window.cancelAnimationFrame(frame);
    frame = 0;
}

function subscribe(listener: () => void) {
    if (!listeners.size) {
        start();
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (!listeners.size) {
            stop();
        }
    };
}

/** Changes after the page scrolled, the window was resized or the page changed */
export function useLayoutVersion() {
    return useSyncExternalStore(subscribe, () => version);
}
