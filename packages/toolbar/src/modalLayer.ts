// A native modal dialog (`dialog.showModal()`) makes everything outside it inert and sits in the
// top layer: a toolbar appended to `<body>` stays visible but cannot be used, and no z-index raises
// it. A top-layer popover outside the modal is inert as well. So while a modal is open the review
// host moves into it, as its last child (stored anchors count only earlier siblings, as in
// `<body>`), and is shown as a manual popover: in the top layer above the modal, clear of the
// dialog's overflow and transforms (`:host([popover])` in styles/toolbar-theme.css). When the modal
// closes the host returns to `<body>`; the dialog restores the page's focus itself.

let activeModal: HTMLDialogElement | undefined;

/** The open modal dialog the review layer is in, if any */
export function activeModalDialog() {
    return activeModal?.isConnected ? activeModal : undefined;
}

/**
 * Whether the element belongs to what can be reviewed now: anything without an open modal,
 * otherwise the modal's content (the rest of the page is inert behind its backdrop). Elements in
 * shadow trees, such as the toolbar's own surfaces, count by their host.
 */
export function isInActiveModal(element: Element) {
    const modal = activeModalDialog();
    if (!modal) return true;
    let node: Node = element;
    for (let root = node.getRootNode(); root instanceof ShadowRoot; root = node.getRootNode()) node = root.host;
    return modal.contains(node);
}

function isModal(dialog: Element): dialog is HTMLDialogElement {
    try {
        return dialog instanceof HTMLDialogElement && dialog.isConnected && dialog.open && dialog.matches(':modal');
    } catch {
        return false;
    }
}

function showOnTop(host: HTMLElement) {
    try {
        if (host.matches(':popover-open')) host.hidePopover();
        host.showPopover();
    } catch (error) {
        console.debug('uier-toolbar: Could not show the toolbar above the dialog', error);
    }
}

/** Keeps the review host usable in the topmost open modal dialog. Returns the cleanup. */
export function followModalDialogs(host: HTMLElement) {
    if (typeof host.showPopover !== 'function') return () => {};

    // Open modals in the order they opened: the last one is on top
    let opened: HTMLDialogElement[] = [];
    const sync = (dialogChanged: boolean) => {
        opened = opened.filter(isModal);
        for (const dialog of document.querySelectorAll('dialog[open]')) {
            if (isModal(dialog) && !opened.includes(dialog)) opened.push(dialog);
        }
        const modal = opened.at(-1);
        if (modal === activeModal) {
            if (!modal) return;
            if (host.parentNode !== modal) modal.appendChild(host);
            // The same dialog closed and opened again is above the popover now
            if (dialogChanged || !host.matches(':popover-open')) showOnTop(host);
            return;
        }
        activeModal = modal;
        if (modal) {
            host.setAttribute('popover', 'manual');
            // Moving the host hides its popover; showing it again puts it above this modal
            modal.appendChild(host);
            showOnTop(host);
        } else {
            host.removeAttribute('popover');
            document.body.appendChild(host);
        }
    };

    const observer = new MutationObserver((records) => {
        const dialogChanged = records.some(record => record.type === 'attributes' && record.target instanceof HTMLDialogElement);
        // Also when the page removed the dialog, or replaced its content, with the host inside
        if (dialogChanged || (activeModal && (!host.isConnected || !activeModal.isConnected))) sync(dialogChanged);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });

    // Escape in the review layer is the review layer's: it never closes the page's modal as well.
    // Bubbling, so the toolbar's own controls (and their popovers) handle it first.
    const keepEscape = (event: KeyboardEvent) => {
        if (activeModal && event.key === 'Escape') event.preventDefault();
    };
    // Clicks on the toolbar are outside the dialog's box: a page that closes its dialog on such a
    // click (instead of on its backdrop) must not close it when the reviewer uses the toolbar
    const keepClick = (event: MouseEvent) => {
        if (activeModal) event.stopPropagation();
    };
    host.addEventListener('keydown', keepEscape);
    host.addEventListener('click', keepClick);
    sync(false);

    return () => {
        observer.disconnect();
        host.removeEventListener('keydown', keepEscape);
        host.removeEventListener('click', keepClick);
        if (activeModal) {
            activeModal = undefined;
            host.removeAttribute('popover');
        }
    };
}
