'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { boardCollapseCookieLifetime, boardCollapseCookieNames, parseBoardCollapseCookie, serializeBoardCollapseCookie } from '@/src/lib/app/boardCollapseCookie';

/**
 * The board columns a person collapsed (uier #464), remembered in this browser only: it is how one person reads a
 * board, not a setting of the project (unlike the sorts and Archive's expansion, which everyone shares). One record
 * per board: a project's id, or `my-work`, each holding the status ids collapsed there.
 */
const storageKey = 'uier:board-collapsed';
const listeners = new Set<() => void>();
// Blocked storage keeps the choices in this page until it is opened again
const memory = new Map<string, string[]>();

// What the board reads: the stored text, which stays the same string until a toggle changes it
const snapshot = (scope?: string, initial = '') => {
    try {
        return window.localStorage.getItem(storageKey) ?? '';
    } catch {
        const stored = scope && memory.get(scope);
        return stored ? JSON.stringify({ [scope]: stored }) : initial;
    }
};

function readCookie(name: string) {
    return parseBoardCollapseCookie(document.cookie.split('; ').find(cookie => cookie.startsWith(`${name}=`))?.slice(name.length + 1));
}

/** Mirror project folds for the next server render. Local storage still holds all boards and notifies other tabs. */
function rememberProject(scope: string, ids: string[]) {
    const secure = location.protocol === 'https:';
    const name = secure ? boardCollapseCookieNames.secure : boardCollapseCookieNames.local;
    try {
        const projects = readCookie(name);
        if (JSON.stringify(projects.get(scope) ?? []) === JSON.stringify(ids)) return;
        projects.delete(scope);
        if (ids.length) projects.set(scope, ids);
        const value = serializeBoardCollapseCookie(projects);
        document.cookie = `${name}=${value}; Path=/; Max-Age=${value ? boardCollapseCookieLifetime : 0}; SameSite=Lax${secure ? '; Secure' : ''}`;
    } catch { /* Local storage still remembers folds when cookies are blocked. */ }
}

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
    const all = parse(snapshot(scope));
    if (ids.length) all[scope] = ids;
    else delete all[scope];
    const text = Object.keys(all).length ? JSON.stringify(all) : '';
    memory.set(scope, ids);
    try {
        if (text) window.localStorage.setItem(storageKey, text);
        else window.localStorage.removeItem(storageKey);
    } catch { /* Private windows and blocked site data: `memory` holds it for this page. */ }
    if (scope !== 'my-work') rememberProject(scope, ids);
    for (const listener of listeners) listener();
}

/**
 * The status ids collapsed on a board (`scope`) and a toggle for one. A project can render its saved folds on the
 * server. A localStorage-only preference applies after hydration and is mirrored for subsequent loads.
 */
export function useCollapsedColumns(scope: string | undefined, initialCollapsed?: string[]) {
    const initial = scope && initialCollapsed?.length ? JSON.stringify({ [scope]: initialCollapsed }) : '';
    const read = () => snapshot(scope, initial);
    const text = useSyncExternalStore(subscribe, read, () => initial);
    useEffect(() => {
        if (scope && scope !== 'my-work' && text !== initial) rememberProject(scope, parse(snapshot(scope, initial))[scope] ?? []);
    }, [scope, text, initial]);
    const collapsed = new Set(scope ? parse(text)[scope] : []);
    const setCollapsed = (id: string, next: boolean) => {
        if (!scope) return;
        const ids = (parse(read())[scope] ?? []).filter(other => other !== id);
        write(scope, next ? [...ids, id] : ids);
    };
    return { collapsed, setCollapsed, enabled: Boolean(scope) };
}
