'use client';

import { useSyncExternalStore } from 'react';

/**
 * The board columns a person collapsed (uier #464), remembered in this browser only: it is how one person reads a
 * board, not a setting of the project (unlike the sorts and Archive's expansion, which everyone shares). One record
 * per board: a project's id, or `my-work`, each holding the status ids collapsed there.
 */
const storageKey = 'uier:board-collapsed';
const listeners = new Set<() => void>();
// Blocked storage keeps the choices in this page until it is opened again
let memory = '';

// What the board reads: the stored text, which stays the same string until a toggle changes it
const snapshot = () => {
    try {
        return window.localStorage.getItem(storageKey) ?? '';
    } catch {
        return memory;
    }
};
const serverSnapshot = () => '';

/** Every board's collapsed ids; anything malformed reads as nothing collapsed */
function parse(text: string): Record<string, string[]> {
    if (!text) return {};
    try {
        const saved: unknown = JSON.parse(text);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
        return Object.fromEntries(Object.entries(saved).flatMap(([scope, ids]) =>
            Array.isArray(ids) ? [[scope, ids.filter((id): id is string => typeof id === 'string')]] : []));
    } catch {
        return {};
    }
}

function subscribe(onChange: () => void) {
    listeners.add(onChange);
    // Another tab's toggle shows here too
    const fromOtherTab = (event: StorageEvent) => { if (event.key === storageKey) onChange(); };
    window.addEventListener('storage', fromOtherTab);
    return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', fromOtherTab);
    };
}

function write(scope: string, ids: string[]) {
    const all = parse(snapshot());
    if (ids.length) all[scope] = ids;
    else delete all[scope];
    const text = Object.keys(all).length ? JSON.stringify(all) : '';
    memory = text;
    try {
        if (text) window.localStorage.setItem(storageKey, text);
        else window.localStorage.removeItem(storageKey);
    } catch { /* Private windows and blocked site data: `memory` holds it for this page. */ }
    for (const listener of listeners) listener();
}

/**
 * The status ids collapsed on a board (`scope`) and a toggle for one. The server and the first paint show every
 * column; a remembered choice applies as soon as the board hydrates. Without a scope nothing collapses.
 */
export function useCollapsedColumns(scope: string | undefined) {
    const text = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
    const collapsed = new Set(scope ? parse(text)[scope] : []);
    const setCollapsed = (id: string, next: boolean) => {
        if (!scope) return;
        const ids = (parse(snapshot())[scope] ?? []).filter(other => other !== id);
        write(scope, next ? [...ids, id] : ids);
    };
    return { collapsed, setCollapsed, enabled: Boolean(scope) };
}
