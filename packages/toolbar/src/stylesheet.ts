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
