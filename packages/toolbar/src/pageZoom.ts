/**
 * A page's own CSS `zoom` on the review host's ancestors (`html { zoom: 1.25 }`, a zoomed dialog the host
 * moved into) would scale the toolbar and draw its fixed boxes away from the page coordinates it measures.
 * The host takes the inverse in a sheet of its own, so the toolbar is drawn at 1. The person's browser zoom
 * is not CSS zoom and still applies. docs/host-styles.md
 */
const updates = new WeakMap<HTMLElement, () => void>();

/** Follows the zoom while the toolbar is mounted. Returns the cleanup. */
export function followPageZoom(host: HTMLElement) {
    const root = host.shadowRoot;
    if (!root) return () => {};
    // Adopted only once a page zooms
    let sheet: CSSStyleSheet | undefined;
    let applied = 1;
    const update = () => {
        const zoom = host.parentElement?.currentCSSZoom ?? 1;
        if (!(zoom > 0) || zoom === applied) return;
        applied = zoom;
        if (!sheet) {
            sheet = new CSSStyleSheet();
            root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        }
        // Above `:host(:where(#uier-toolbar))`, whose reset sets the host's own zoom to 1 (styles/toolbar-theme.css)
        sheet.replaceSync(zoom === 1 ? '' : `:host(#uier-toolbar) { zoom: ${1 / zoom} !important; }`);
    };
    update();
    updates.set(host, update);
    // A media query or a class or style on <html> or <body> can change it
    window.addEventListener('resize', update);
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
        observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    return () => {
        window.removeEventListener('resize', update);
        observer.disconnect();
        updates.delete(host);
        if (sheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter(value => value !== sheet);
    };
}

/** After the host moved into or out of a page layer (src/modalLayer.ts) */
export function matchPageZoom(host: HTMLElement) {
    updates.get(host)?.();
}
