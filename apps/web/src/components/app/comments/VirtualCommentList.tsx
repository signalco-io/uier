'use client';

import { useEffect, useLayoutEffect, useRef, useState, type AriaAttributes, type ReactNode, type RefObject } from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { useAppI18n } from '@/src/lib/i18n/client';
import { RowSkeleton } from './CommentsLoading';

export type CommentPageControl = { total: number; hasMore: boolean; loading: boolean; loadMore: () => void; error?: boolean };
export type CommentListPosition = Pick<AriaAttributes, 'aria-setsize' | 'aria-posinset'>;
/** The inbox list's next page while it loads: its first rows, outlined and pulsing (`RowSkeleton`) */
const nextRows = ['w-2/3', 'w-1/2', 'w-3/4'].map(width => <RowSkeleton key={width} pulse title={width} />);
const revealEvent = 'uier-reveal-comment';
export function revealVirtualComment(id: string) { document.dispatchEvent(new CustomEvent(revealEvent, { detail: id })); }

/** The element that scrolls the page around `element` (the app's panel from lg), or none where the window does */
function pageScroller(element: HTMLElement) {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return null;
}

/**
 * Measured rows with overscan.
 * - `pageScroll` (board columns): the list never scrolls itself, it grows with its rows and follows whatever scrolls
 *   the page (the window, or the app's panel from lg), so the whole board scrolls together (uier #400).
 * - `documentScroll` (the inbox): below lg it follows the document; from lg it scrolls itself and reaches the bottom of
 *   the page's scroller (`--list-room`, measured), less the page's padding there (uier #401).
 *
 * While the next page loads, outlines of its first rows stand in above Load more (`nextPage`), never more than the rows
 * still to come: a presentation item of its own, hidden from assistive technology and without the item attribute, so
 * it is no row to the measurements, the positions (`aria-setsize`, `aria-posinset`), the sentinel or the keys.
 */
export function VirtualCommentList<T extends { id: string }>({ items, label, render, control, focusedId, className, onFocus, listRef, footer, gap = 8, itemAttribute = 'data-board-card', documentScroll = false, pageScroll = false, nextPage = nextRows }: {
    items: T[]; label: string; render: (item: T, index: number, position: CommentListPosition) => ReactNode; control?: CommentPageControl;
    documentScroll?: boolean; pageScroll?: boolean;
    /** The outlines that stand in for the next page while it loads, shaped like its items: the list's rows unless given (the board's cards) */
    nextPage?: ReactNode[];
    focusedId?: string; className?: string; onFocus?: React.FocusEventHandler<HTMLUListElement>; itemAttribute?: string; listRef?: RefObject<HTMLUListElement | null>; footer?: ReactNode; gap?: number;
}) {
    const { t } = useAppI18n();
    const root = useRef<HTMLUListElement>(null), sentinel = useRef<HTMLLIElement>(null);
    const sizes = useRef(new Map<string, number>());
    const [viewport, setViewport] = useState({ top: 0, height: 600 });
    const [, setMeasure] = useState(0);
    const [revealed, setRevealed] = useState<string>();
    const [windowScroll, setWindowScroll] = useState(false);
    useLayoutEffect(() => {
        if (!documentScroll) return;
        const media = window.matchMedia('(max-width: 1023px)');
        const changed = () => setWindowScroll(media.matches);
        changed(); media.addEventListener('change', changed);
        return () => media.removeEventListener('change', changed);
    }, [documentScroll]);
    // From lg the inbox's list reaches the bottom of the page's scroller and scrolls inside (uier #401): its room is
    // measured from where it starts in the scroller's content (so scrolling the page does not change it) to the
    // scroller's bottom, less the padding of the page below it.
    useLayoutEffect(() => {
        const list = root.current;
        if (!documentScroll || windowScroll || !control || !list) return;
        const scroller = pageScroller(list);
        if (!scroller) return;
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
                let below = 0;
                for (let parent = list.parentElement; parent && parent !== scroller; parent = parent.parentElement) below += parseFloat(getComputedStyle(parent).paddingBottom) || 0;
                list.style.setProperty('--list-room', `${Math.round(scroller.clientHeight - top - below)}px`);
            });
        };
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(scroller);
        // Anything above the list that grows, shrinks, comes or goes (the headers, the filters in effect, the count
        // line) moves it, and changes the height of the scroller's content with it
        for (const content of scroller.children) resize.observe(content);
        return () => { cancelAnimationFrame(frame); resize.disconnect(); list.style.removeProperty('--list-room'); };
    }, [documentScroll, windowScroll, Boolean(control)]);
    const offsets = [0];
    for (const item of items) offsets.push(offsets.at(-1)! + (sizes.current.get(item.id) ?? 100) + gap);
    const virtual = Boolean(control) && items.length > 20;
    const first = offsets.findIndex(offset => offset >= viewport.top);
    const start = virtual ? Math.max(0, (first < 0 ? items.length : first) - 5) : 0;
    const end = virtual ? Math.min(items.length, Math.max(start + 1, offsets.findIndex(offset => offset > viewport.top + viewport.height) < 0 ? items.length : offsets.findIndex(offset => offset > viewport.top + viewport.height)) + 4) : items.length;
    const indexes = new Set(Array.from({ length: end - start }, (_, index) => start + index));
    for (const id of [focusedId, revealed]) { const index = items.findIndex(item => item.id === id); if (index >= 0) indexes.add(index); }
    const visible = [...indexes].sort((a, b) => a - b);
    useLayoutEffect(() => {
        const list = root.current;
        if (!list || !control) return;
        // The CSS already removes the narrow inbox's height constraint before hydration.
        // Read the media query on the first layout pass too: its full document height is
        // never a viewport, even before the window-mode state update has committed.
        // A list that follows the page reads its place in the window, whatever scrolls it: the window, or the app's
        // panel from lg (a scroll anywhere reaches the document in its capture phase).
        const followsPage = pageScroll || (documentScroll && window.matchMedia('(max-width: 1023px)').matches);
        const readViewport = () => {
            const next = followsPage ? { top: Math.max(0, -list.getBoundingClientRect().top), height: window.innerHeight }
                : { top: list.scrollTop, height: list.clientHeight || 600 };
            // Other scrollers (the board sideways, a thread) leave it where it was: no render
            setViewport(current => current.top === next.top && current.height === next.height ? current : next);
        };
        const scroller = followsPage ? document : list;
        readViewport(); scroller.addEventListener('scroll', readViewport, { passive: true, capture: followsPage });
        const resize = new ResizeObserver(readViewport); resize.observe(list);
        window.addEventListener('resize', readViewport);
        return () => { scroller.removeEventListener('scroll', readViewport, { capture: followsPage }); resize.disconnect(); window.removeEventListener('resize', readViewport); };
    }, [Boolean(control), windowScroll, documentScroll, pageScroll]);
    useLayoutEffect(() => {
        if (!virtual || !root.current) return;
        const observer = new ResizeObserver(entries => {
            let changed = false;
            for (const entry of entries) {
                const id = entry.target.getAttribute(itemAttribute);
                const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
                if (id && height > 0 && sizes.current.get(id) !== height) { sizes.current.set(id, height); changed = true; }
            }
            if (changed) setMeasure(value => value + 1);
        });
        for (const row of root.current.querySelectorAll(`[${itemAttribute}]`)) observer.observe(row);
        return () => observer.disconnect();
    }, [items, start, end, virtual, revealed, focusedId, itemAttribute]);
    useEffect(() => {
        const reveal = (event: Event) => {
            const id = (event as CustomEvent<string>).detail, index = items.findIndex(item => item.id === id);
            if (index < 0 || !root.current) return;
            setRevealed(id);
            const top = offsets[index]!;
            // Clear of a project's sticky tabs too (uier #413)
            const tabs = document.querySelector('[data-sticky-tabs]')?.getBoundingClientRect().height ?? 0;
            if (windowScroll) window.scrollTo({ top: window.scrollY + root.current.getBoundingClientRect().top + top - 56 - tabs });
            else if (pageScroll) {
                // Brought on screen in the page's scroller (the window below lg, clear of its sticky top bar)
                const scroller = pageScroller(root.current), box = scroller?.getBoundingClientRect() ?? { top: 56, bottom: window.innerHeight };
                const start = root.current.getBoundingClientRect().top + top, end = start + (sizes.current.get(id) ?? 100);
                if (start < box.top + tabs || end > box.bottom) (scroller ?? window).scrollBy({ top: start - box.top - tabs - 16 });
            } else if (top < root.current.scrollTop || top + (sizes.current.get(id) ?? 100) > root.current.scrollTop + root.current.clientHeight) root.current.scrollTop = top;
        };
        document.addEventListener(revealEvent, reveal);
        return () => document.removeEventListener(revealEvent, reveal);
    });
    const hasMore = control?.hasMore, loading = control?.loading, failed = control?.error;
    // The next page was asked for here, by the sentinel or Load more, and is on its way. `control.loading` alone does
    // not say so: it is also true while the loaded window is read again (a filter, a saved change), which brings no
    // rows after the last one. Forgotten as soon as nothing loads: the page arrived, failed, or was not asked for after all.
    const [asked, setAsked] = useState(false);
    if (asked && !loading) setAsked(false);
    const loadMore = () => { if (!loading) setAsked(true); control?.loadMore(); };
    const remaining = (control?.total ?? 0) - items.length;
    useEffect(() => {
        const marker = sentinel.current, list = root.current;
        if (!marker || !list || !hasMore || loading || failed) return;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting) && list.checkVisibility()) loadMore();
        }, { root: pageScroll || (documentScroll && window.matchMedia('(max-width: 1023px)').matches) ? null : list, rootMargin: '0px 0px 100px 0px' });
        observer.observe(marker); return () => observer.disconnect();
    }, [hasMore, loading, failed, items.length, control?.loadMore, windowScroll, documentScroll, pageScroll]);
    const children: ReactNode[] = [];
    let previous = 0;
    for (const index of visible) {
        const space = offsets[index]! - offsets[previous]!;
        if (space > 0) children.push(<li key={`space-${index}`} role="presentation" aria-hidden="true" style={{ height: Math.max(0, space - gap) }} />);
        children.push(render(items[index]!, index, { 'aria-setsize': control?.total ?? items.length, 'aria-posinset': index + 1 })); previous = index + 1;
    }
    if (previous < items.length) children.push(<li key="space-end" role="presentation" aria-hidden="true" style={{ height: Math.max(0, offsets[items.length]! - offsets[previous]! - gap) }} />);
    return <ul ref={node => { root.current = node; if (listRef) listRef.current = node; }} aria-label={label} aria-busy={loading || undefined} onFocus={onFocus} data-loaded-count={items.length} data-comment-window={control ? '' : undefined}
        // `--list-room` is measured after hydration; until then the list takes the window's height less the headers above it
        className={cn('m-0 flex list-none flex-col gap-2 p-0 [&>li]:shrink-0', control && !pageScroll && 'scrollbar-subtle max-h-[max(20rem,calc(var(--list-room,100svh_-_22rem)_-_var(--selection-bar,0px)))] overflow-y-auto overscroll-y-contain [overflow-anchor:none]', control && documentScroll && 'max-lg:max-h-none max-lg:overflow-x-clip max-lg:overflow-y-visible max-lg:overscroll-auto', className)}>
        {children}
        {footer}
        {/* The next page's first rows, as far apart as the rows (`gap`); the count is the total's, where it says fewer remain */}
        {control?.hasMore && asked && loading && <li role="presentation" aria-hidden="true" data-next-page="" className="flex flex-col" style={{ gap }}>
            {nextPage.slice(0, remaining > 0 ? remaining : nextPage.length)}
        </li>}
        {control?.hasMore && <li ref={sentinel} role="presentation" className="flex shrink-0 flex-col items-center justify-center p-2">
            {control.error && <p role="status" className="m-0 text-sm text-muted-foreground">{t('More comments could not be loaded.')}</p>}
            <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={control.loading} onClick={loadMore}>
                {control.loading && <Spinner />}{t(control.error ? 'Try again' : 'Load more')}
            </Button>
        </li>}
    </ul>;
}
