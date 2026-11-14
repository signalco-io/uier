'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react';
import { virtualParts, VIRTUAL_FROM } from '@/src/lib/pageChecks/virtualRows';

/**
 * The rows of the Page checks list near the screen (uier #418), for the table and the cards alike. The list follows
 * whatever scrolls the page (the window below lg, the app's panel from lg): its place is read from its box, on a
 * scroll anywhere (the capture phase of `document`), a resize or a change of its own size. Each rendered row is
 * measured (by `data-row-key`) and remembered, so the rows replaced by space keep their real height and nothing
 * on screen moves; rows never rendered count as `estimate`.
 *
 * - Which rows render is `virtualParts` (`src/lib/pageChecks/virtualRows.ts`): the ones near the screen, and the row
 *   holding focus with its neighbours up to the nearest `focusable` row each way, so Tab and Shift+Tab reach the next
 *   row even after the page scrolled away from the focus.
 * - Find in page sees only rendered rows, so Ctrl or Cmd+F renders the whole visible list (at most the project's 200
 *   pages) until it changes; a list in a hidden layout (the cards beside the table) stays short.
 */
export function useVirtualRows<T extends { id: string }>(items: readonly T[], { estimate, gap = 0, focusable }: {
    estimate: number;
    gap?: number;
    /** Whether a row has something to focus (a link, a vital); one without is passed over to the next */
    focusable?: (item: T) => boolean;
}) {
    const ref = useRef<HTMLElement | null>(null);
    const [sizes, setSizes] = useState<ReadonlyMap<string, number>>(() => new Map());
    // Before the first measure (the server render, hydration): the first screens' rows
    const [viewport, setViewport] = useState({ top: 0, height: 1200 });
    const [focused, setFocused] = useState<string>();
    // The list (its pages in order) Find in page asked to render whole
    const signature = items.map(item => item.id).join('\n');
    const [findAll, setFindAll] = useState<string>();
    const virtual = items.length > VIRTUAL_FROM && findAll !== signature;

    const parts = virtualParts(items, { virtual, sizes, estimate, gap, viewport, focusedId: focused, focusable });

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
