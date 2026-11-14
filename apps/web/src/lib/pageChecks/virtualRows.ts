// Which rows of the app's Page checks list render (uier #418): pure, so the API tests can check it. The view's
// `useVirtualRows` measures the rows and the screen; this decides what renders and the room left for the rest.

/** A list of more pages than this renders only the rows near the screen; a shorter one renders them all */
export const VIRTUAL_FROM = 40;
/** Rows rendered above and below the screen: room for Tab and the arrow keys before the next scroll renders more */
export const OVERSCAN = 6;

export type VirtualPart<T> =
    | { kind: 'row'; item: T; index: number }
    /** The room of the rows not rendered, so the list keeps its height and the scroll bar its place */
    | { kind: 'space'; key: string; height: number };

/**
 * The rows near the screen (and `OVERSCAN` more each way), with space for the rest. Rows never measured count as
 * `estimate`; `gap` is the room between two rows. The row holding focus stays rendered wherever the page scrolls,
 * and so do the rows beside it up to the nearest one with something to focus (`focusable`), on both sides: Tab and
 * Shift+Tab then always land on the next row, which the browser brings on screen (and the rows around it with it),
 * never on a row far away because the ones between were not rendered.
 */
export function virtualParts<T extends { id: string }>(items: readonly T[], {
    virtual, sizes, estimate, gap = 0, viewport, focusedId, focusable = () => true
}: {
    virtual: boolean;
    sizes: ReadonlyMap<string, number>;
    estimate: number;
    gap?: number;
    /** Where the screen is, from the list's top: `top` is negative while the list starts below the screen's top */
    viewport: { top: number; height: number };
    focusedId?: string;
    focusable?: (item: T) => boolean;
}): VirtualPart<T>[] {
    if (!virtual) return items.map((item, index) => ({ kind: 'row', item, index }));
    const offsets = [0];
    for (const item of items) offsets.push(offsets.at(-1)! + (sizes.get(item.id) ?? estimate) + gap);

    const top = viewport.top, bottom = viewport.top + viewport.height;
    // The first row whose bottom is below the top of the screen, and the first row below its bottom
    const first = items.findIndex((_, index) => offsets[index + 1]! - gap > top);
    const after = items.findIndex((_, index) => offsets[index]! >= bottom);
    const start = Math.max(0, (first < 0 ? items.length : first) - OVERSCAN);
    const end = Math.min(items.length, Math.max(after < 0 ? items.length : after, start + 1) + OVERSCAN);
    const indexes = new Set(Array.from({ length: end - start }, (_, index) => start + index));

    const focused = focusedId === undefined ? -1 : items.findIndex(item => item.id === focusedId);
    if (focused >= 0) {
        indexes.add(focused);
        // Up to the nearest focusable row each way (or the list's end), so Tab and Shift+Tab reach it
        for (const step of [-1, 1]) {
            for (let index = focused + step; index >= 0 && index < items.length; index += step) {
                indexes.add(index);
                if (focusable(items[index]!)) break;
            }
        }
    }

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
    return parts;
}
