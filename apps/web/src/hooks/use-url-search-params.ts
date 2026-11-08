'use client';

import { useSearchParams } from 'next/navigation';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

/*
 * The address's query as UI state that changes at once.
 *
 * Next.js applies `history.pushState`/`replaceState` and Back/Forward to `useSearchParams` in a
 * transition, and React holds a transition while an async one is pending (a server action started
 * with `useTransition`). A thread or filter read from `useSearchParams` then waits for that write to
 * reach the server and back. This store reads `location.search` instead: it updates during the
 * click that writes it (`setUrlSearchParams`) and on Back/Forward (`popstate`). Writes still go
 * through Next's patched history, so its router keeps the address for refreshes and later navigations.
 */

const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener('popstate', listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('popstate', listener);
    };
}

/** Serialized like `URLSearchParams`, so it matches the server's snapshot (and React compares strings by value) */
const currentSearch = () => new URLSearchParams(window.location.search).toString();

/**
 * The address's search params, current as soon as `setUrlSearchParams`, Back or Forward changes them
 * (`useSearchParams` follows them a transition later). Read-only: change them with `setUrlSearchParams`.
 */
export function useUrlSearchParams(): URLSearchParams {
    // Next's copy is the server render's and hydration's, and changes when a Next navigation commits
    const committed = useSearchParams().toString();
    const search = useSyncExternalStore(subscribe, currentSearch, () => committed);
    // A Next navigation (`router.push`, a link) writes the address while it commits, after this render
    // read it: read it again then
    useLayoutEffect(() => {
        if (currentSearch() !== search) notify();
    }, [committed, search]);
    return useMemo(() => new URLSearchParams(search), [search]);
}

/** The current address with these search params set (a value) or removed (`undefined`) */
export function urlWith(changes: Record<string, string | undefined>) {
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(changes)) {
        if (value === undefined) url.searchParams.delete(name);
        else url.searchParams.set(name, value);
    }
    return url;
}

/**
 * Sets (a value) or removes (`undefined`) search params without a server request, and updates
 * `useUrlSearchParams` during the call. `push` adds a history entry (Back undoes it), `replace`
 * (the default) changes the current one. Returns the new address, or `undefined` when nothing changed.
 */
export function setUrlSearchParams(changes: Record<string, string | undefined>, { history = 'replace' }: { history?: 'push' | 'replace' } = {}) {
    const url = urlWith(changes);
    if (url.searchParams.toString() === currentSearch()) return undefined;
    if (history === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    notify();
    return url;
}
