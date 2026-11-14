// One parsed sheet shared by every review shadow root. Constructed sheets do not need an
// inline-style CSP exception, and never put toolbar selectors into the reviewed document.
let sheet: CSSStyleSheet;

export function adoptToolbarStyles(root: ShadowRoot) {
    // Ordinary visitors do not need to parse review CSS before a review actually mounts.
    if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync('__uier_toolbar_css__');
    }
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return () => { root.adoptedStyleSheets = root.adoptedStyleSheets.filter(value => value !== sheet); };
}

/**
 * Readies a `[data-uier-root]` once it is in the document (docs/host-styles.md): left to right, like the
 * toolbar's six languages, and `--uier-rem` (what `rem` is in the toolbar's CSS) at the person's default font
 * size, the browser's setting. The root's own size is `medium`, which a page's styles do not change.
 */
export function prepareToolbarRoot(element: HTMLElement) {
    element.dir = 'ltr';
    const size = getComputedStyle(element).fontSize;
    if (/^\d+(\.\d+)?px$/.test(size)) element.style.setProperty('--uier-rem', size);
}
