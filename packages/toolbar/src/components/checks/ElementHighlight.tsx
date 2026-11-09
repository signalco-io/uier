import { useLayoutVersion } from '../../hooks/useLayoutVersion';

/**
 * The element a panel's Highlight points at: the dashed accent outline of point mode with the
 * selection tint, following scrolls and layout changes. It never takes clicks, and it is in the
 * toolbar's shadow root, so screenshots and the audit leave it out.
 */
export function ElementHighlight({ element }: { element: Element }) {
    useLayoutVersion();
    const rect = element.isConnected ? element.getBoundingClientRect() : undefined;
    if (!rect || (!rect.width && !rect.height)) return null;
    return (
        <div
            aria-hidden="true"
            data-uier-check-highlight=""
            className="pointer-events-none fixed z-[49] select-none rounded-sm bg-[hsl(var(--brand-selection))] outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, willChange: 'left, top' }} />
    );
}
