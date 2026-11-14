'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';

/** A list of more pages than this renders only the rows near the screen (uier #418); a shorter one renders them all */
export const VIRTUAL_FROM = 40;
/** Rows rendered above and below the screen: room for Tab and the arrow keys before the next scroll renders more */
const OVERSCAN = 6;

export type VirtualPart<T> =
    | { kind: 'row'; item: T; index: number }
    /** The room of the rows not rendered, so the list keeps its height and the scroll bar its place */
    | { kind: 'space'; key: string; height: number };

/**
 * The rows of the Page checks list near the screen (uier #418), for the table and the cards alike. The list follows
 * whatever scrolls the page (the window below lg, the app's panel from lg): its place is read from its box, on a
 * scroll anywhere (the capture phase of `document`), a resize or a change of its own size. Each rendered row is
 * measured (by `data-row-key`) and remembered, so the rows replaced by space keep their real height and nothing
 * on screen moves; rows never rendered count as `estimate`.
 *
 * - The row holding focus stays rendered wherever the page scrolls, and the rows around the screen are rendered too,
 *   so Tab moves through every row: the browser brings the focused row on screen, which renders the next ones.
 * - Find in page sees only rendered rows, so Ctrl or Cmd+F renders the whole visible list (at most the project's 200
 *   pages) until it changes; a list in a hidden layout (the cards beside the table) stays short.
 */
export function useVirtualRows<T extends { id: string }>(items: readonly T[], { estimate, gap = 0 }: { estimate: number; gap?: number }) {
    const ref = useRef<HTMLElement | null>(null);
    const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(() => new Map());
    // Before the first measure (the server render, hydration): the first screens' rows
    const [viewport, setViewport] = useState({ top: 0, height: 1200 });
    const [focused, setFocused] = useState<string>();
    // The list (its pages in order) Find in page asked to render whole
    const signature = items.map(item => item.id).join('\n');
    const [findAll, setFindAll] = useState<string>();
    const virtual = items.length > VIRTUAL_FROM && findAll !== signature;

    const offsets = [0];
    for (const item of items) offsets.push(offsets.at(-1)! + (sizes.get(item.id) ?? estimate) + gap);

    let start = 0;
    let end = items.length;
    if (virtual) {
        const top = viewport.top, bottom = viewport.top + viewport.height;
        // The first row whose bottom is below the top of the screen, and the first row below its bottom
        const first = items.findIndex((_, index) => offsets[index + 1]! - gap > top);
        const after = items.findIndex((_, index) => offsets[index]! >= bottom);
        start = Math.max(0, (first < 0 ? items.length : first) - OVERSCAN);
        end = Math.min(items.length, Math.max(after < 0 ? items.length : after, start + 1) + OVERSCAN);
    }
    const indexes = new Set(Array.from({ length: end - start }, (_, index) => start + index));
    const focusedIndex = focused ? items.findIndex(item => item.id === focused) : -1;
    if (focusedIndex >= 0) indexes.add(focusedIndex);

    const parts: VirtualPart<T>[] = [];
    let next = 0;
    for (const index of [...indexes].sort((a, b) => a - b)) {
        const space = offsets[index]! - offsets[next]! - gap;
        if (index > next && space > 0) parts.push({ kind: 'space', key: `space-${next}`, height: space });
        parts.push({ kind: 'row', item: items[index]!, index });
        next = index + 1;
    }
    const rest = offsets[items.length]! - offsets[next]! - gap;
    if (next < items.length && rest > 0) parts.push({ kind: 'space', key: `space-${next}`, height: rest });

    // Where the list is on the screen: the window's height from the list's top (negative while it starts below the top)
    useLayoutEffect(() => {
        const list = ref.current;
        if (!list || !virtual) return;
        const read = () => {
            const shown = list.getClientRects().length > 0;
            const next = shown ? { top: Math.round(-list.getBoundingClientRect().top), height: window.innerHeight } : { top: 0, height: 0 };
            setViewport(current => current.top === next.top && current.height === next.height ? current : next);
        };
        read();
        document.addEventListener('scroll', read, { passive: true, capture: true });
        window.addEventListener('resize', read);
        const resize = new ResizeObserver(read);
        resize.observe(list);
        return () => {
            document.removeEventListener('scroll', read, { capture: true });
            window.removeEventListener('resize', read);
            resize.disconnect();
        };
    }, [virtual]);

    // Each rendered row's height, kept by its key once it is known
    const rendered = parts.map(part => part.kind === 'row' ? part.item.id : part.key).join(' ');
    useLayoutEffect(() => {
        const list = ref.current;
        if (!list || !virtual) return;
        const measure = (rows: Iterable<Element>) => {
            const found: [string, number][] = [];
            for (const row of rows) {
                const key = row.getAttribute('data-row-key');
                const height = row.getBoundingClientRect().height;
                if (key && height > 0) found.push([key, height]);
            }
            setSizes(current => found.every(([key, height]) => current.get(key) === height) ? current : new Map([...current, ...found]));
        };
        const observer = new ResizeObserver(entries => measure(entries.map(entry => entry.target)));
        for (const row of list.querySelectorAll('[data-row-key]')) observer.observe(row);
        return () => observer.disconnect();
    }, [virtual, rendered]);

    // Find in page (Ctrl or Cmd+F) renders every row of a list that is on screen
    useEffect(() => {
        if (!virtual) return;
        const find = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f' && ref.current?.getClientRects().length)
                setFindAll(signature);
        };
        window.addEventListener('keydown', find, true);
        return () => window.removeEventListener('keydown', find, true);
    }, [virtual, signature]);

    const container = {
        ref: (element: HTMLElement | null) => { ref.current = element; },
        onFocus: (event: FocusEvent<HTMLElement>) => {
            const key = (event.target as Element).closest('[data-row-key]')?.getAttribute('data-row-key');
            if (key) setFocused(key);
        },
        onBlur: (event: FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(undefined);
        }
    };
    return { parts, virtual, container };
}
