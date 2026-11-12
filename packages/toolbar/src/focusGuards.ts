// What Radix renders for a layer that traps the focus: a popover's or a menu's positioned wrapper, an open dialog or menu
const openLayer = '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="menu"][data-state="open"]';

/**
 * Marks the focus guards the toolbar's own Radix layers add to the page's body (`data-radix-focus-guard`, a pair of
 * transparent spans with tabindex 0 that hand the focus on) with `data-uier-focus-guard`, so the Keyboard check leaves
 * them out while a menu that opened a panel is closing. The page's own guards stay unmarked and are reported: a guard
 * is the toolbar's only when it is new (never seen on the page before) and appears while one of the toolbar's layers
 * is open in its shadow root (Radix adds them as that layer mounts). Guards the toolbar's Radix reuses (the page's,
 * moved to the body's edges) are not new.
 */
export function markToolbarFocusGuards(root: ShadowRoot) {
    const guard = '[data-radix-focus-guard]';
    const seen = new WeakSet<Element>(document.querySelectorAll(guard));
    const observer = new MutationObserver(records => {
        let toolbarLayer: boolean | undefined;
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element) || !node.matches(guard) || seen.has(node)) continue;
                seen.add(node);
                toolbarLayer ??= Boolean(root.querySelector(openLayer));
                if (toolbarLayer) node.setAttribute('data-uier-focus-guard', '');
            }
        }
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
}
