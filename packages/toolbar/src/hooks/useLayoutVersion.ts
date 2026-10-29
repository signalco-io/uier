import { useSyncExternalStore } from 'react';
import { canReviewToolbar, toolbarReviewSurfaces } from '../toolbarReview';
import { getToolbarHost } from '../mount';

// One set of listeners for every pin and highlight: a number that changes (once per frame at most)
// when anything on the page may have moved, so positions are measured again.

let version = 0;
let domVersion = 0;
let observedBefore = false;
let frame = 0;
const listeners = new Set<() => void>();
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let toolbarObserver: MutationObserver | undefined;
let toolbarRoot: ShadowRoot | null | undefined;
const observedSurfaces = new Set<Element>();

function observeToolbarSurfaces() {
    for (const surface of observedSurfaces) {
        if (!surface.isConnected) {
            resizeObserver?.unobserve(surface);
            observedSurfaces.delete(surface);
        }
    }
    for (const surface of toolbarRoot?.querySelectorAll(toolbarReviewSurfaces) ?? []) {
        if (!observedSurfaces.has(surface)) {
            resizeObserver?.observe(surface);
            observedSurfaces.add(surface);
        }
    }
}

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
    // Invalidate text caches after a gap with no subscribers (and therefore no observer).
    if (observedBefore) domVersion++;
    observedBefore = true;
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
    mutationObserver = new MutationObserver(() => { domVersion++; schedule(); });
    mutationObserver.observe(document.body ?? document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
    });
    toolbarRoot = canReviewToolbar() ? getToolbarHost()?.shadowRoot : null;
    if (toolbarRoot) {
        toolbarRoot.addEventListener('scroll', schedule, { capture: true, passive: true });
        observeToolbarSurfaces();
        // Watch the shells, not their thread content: layout-triggered renders must not keep
        // interrupting React's deferred inbox rendering (or observe our own pin/outline updates).
        toolbarObserver = new MutationObserver(records => {
            const surfaceChanged = records.some(record => {
                return record.target instanceof Element && record.target.matches(toolbarReviewSurfaces)
                    || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
                        && (node.matches(toolbarReviewSurfaces) || node.querySelector(toolbarReviewSurfaces)));
            });
            if (surfaceChanged) {
                observeToolbarSurfaces();
                schedule();
            }
        });
        toolbarObserver.observe(toolbarRoot, { subtree: true, childList: true, attributes: true });
    }
}

function stop() {
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, { capture: true });
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    observedSurfaces.clear();
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    toolbarObserver?.disconnect();
    toolbarObserver = undefined;
    toolbarRoot?.removeEventListener('scroll', schedule, { capture: true });
    toolbarRoot = undefined;
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

/** Text/selector evidence changes only with the DOM, independently of scroll/resize geometry. */
export function getDomVersion() { return domVersion; }

/** Changes after the page scrolled, the window was resized or the page changed */
export function useLayoutVersion() {
    return useSyncExternalStore(subscribe, () => version);
}
