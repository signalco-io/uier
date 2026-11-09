import { pageSettled } from './pageSettled';

/**
 * Resolves when the page has loaded (its `load` event, at most `loadLimit` ms), stopped rendering
 * (`pageSettled`) and the browser is idle (`requestIdleCallback`, at most `idleLimit` ms; a short
 * timeout where it is missing). For the checks the toolbar runs in the background, so they never
 * compete with the page's own loading or with what the person is doing.
 */
export function pageIdle({ loadLimit = 10_000, idleLimit = 5000 }: { loadLimit?: number; idleLimit?: number } = {}) {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const promise = new Promise<void>(resolve => {
        const idle = () => {
            if (cancelled) return;
            if (typeof window.requestIdleCallback === 'function') {
                const id = window.requestIdleCallback(() => resolve(), { timeout: idleLimit });
                cleanups.push(() => window.cancelIdleCallback(id));
            } else {
                const id = window.setTimeout(resolve, 200);
                cleanups.push(() => window.clearTimeout(id));
            }
        };
        let loaded = false;
        const settle = () => {
            if (cancelled || loaded) return;
            loaded = true;
            const settled = pageSettled();
            cleanups.push(settled.cancel);
            settled.promise.then(idle);
        };
        if (document.readyState === 'complete') settle();
        else {
            window.addEventListener('load', settle, { once: true });
            const limit = window.setTimeout(settle, loadLimit);
            cleanups.push(() => {
                window.removeEventListener('load', settle);
                window.clearTimeout(limit);
            });
        }
    });
    return {
        promise,
        cancel: () => {
            cancelled = true;
            cleanups.forEach(cleanup => cleanup());
        }
    };
}

/** The browser asks to save data (`Save-Data`): nothing large is downloaded unasked */
export function savesData() {
    return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

/**
 * The browser's next idle moment (at most `limit` ms away), or the next task when `soon`: between the
 * steps of work the toolbar does in the background, so the page's own tasks go first. Rejects with the
 * signal's reason when it aborts first.
 */
export function nextIdle(signal?: AbortSignal, { soon = false, limit = 1000 }: { soon?: boolean; limit?: number } = {}) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        let cancel = () => {};
        const abort = () => {
            cancel();
            reject(signal!.reason);
        };
        const done = () => {
            signal?.removeEventListener('abort', abort);
            resolve();
        };
        if (!soon && typeof window.requestIdleCallback === 'function') {
            const id = window.requestIdleCallback(done, { timeout: limit });
            cancel = () => window.cancelIdleCallback(id);
        } else {
            const id = window.setTimeout(done, 0);
            cancel = () => window.clearTimeout(id);
        }
        signal?.addEventListener('abort', abort, { once: true });
    });
}
