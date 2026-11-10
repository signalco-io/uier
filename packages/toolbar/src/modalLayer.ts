import { getToolbarHost } from './mount';
import { isLetterKeyTarget } from './keyboard';

// The review host follows the page's topmost open layer: a native modal dialog, an open popover,
// the popup of an expanded menu or select button, or a script dialog (`aria-modal`). It moves into
// the layer, as its last child (stored anchors count only earlier siblings, as in `<body>`), and is
// shown as a manual popover: in the top layer above it, clear of the layer's overflow and transforms
// (`:host([popover])` in styles/toolbar-theme.css). When the layer closes the host returns to `<body>`.
//
// A native modal makes everything outside it inert, and a top-layer popover outside the modal is
// inert as well, so only from inside it is the toolbar usable at all. For the other layers, being
// inside is what makes the toolbar's presses and focus count as inside: pages close menus, popovers
// and dialogs on a press or focus outside them (`contains`, `composedPath()` or, in React, the
// component tree), and a native popover closes on a press outside it whatever its listeners do.
// Focus traps keep the composer's focus, and `aria-hidden`/`inert` set on the host is taken off.
// While the host is in a layer, its keys, text input and clicks stay in the review layer: the page's
// layer must not take letters as typeahead, arrows and Tab as its navigation, or a click as a choice.

let activeModal: HTMLDialogElement | undefined;
let activeLayer: Element | undefined;
const recentLayerOpeners = new WeakMap<Element, Element>();
const layersByOpener = new WeakMap<Element, Element>();
/** Events of the review layer that the host kept from the page (and from the window) */
const keptEvents = new WeakSet<Event>();
const keptEventTypes = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'click', 'dblclick', 'auxclick', 'contextmenu'];

/** The open modal dialog the review layer is in, if any */
export function activeModalDialog() {
    return activeModal?.isConnected ? activeModal : undefined;
}

/** The page layer the review host is in, if any: a modal dialog, a popover, a menu or a dialog */
export function activePageLayer() {
    return activeLayer?.isConnected ? activeLayer : undefined;
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

/**
 * Listens to keys on the window, including the review layer's own when its host keeps editing
 * events or events inside a page layer from the window. Returns the cleanup.
 */
export function listenToWindowKeydown(listener: (event: KeyboardEvent) => void, options?: { capture?: boolean }) {
    const host = getToolbarHost();
    const kept = (event: Event) => {
        if (keptEvents.has(event)) listener(event as KeyboardEvent);
    };
    window.addEventListener('keydown', listener, options);
    // A capture listener on the window runs before the host keeps anything
    if (!options?.capture) host?.addEventListener('keydown', kept);
    return () => {
        window.removeEventListener('keydown', listener, options);
        host?.removeEventListener('keydown', kept);
    };
}

function isModal(dialog: Element): dialog is HTMLDialogElement {
    try {
        return dialog instanceof HTMLDialogElement && dialog.isConnected && dialog.open && dialog.matches(':modal');
    } catch {
        return false;
    }
}

function isShown(element: Element) {
    try {
        return element.isConnected && (typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkVisibilityCSS: true }));
    } catch {
        return false;
    }
}

/**
 * An open popover that closes on a press outside it. Not `manual` (it stays), nor `hint`: tooltips
 * open on hover and close when the pointer leaves for the toolbar anyway.
 */
function isOpenLightDismissPopover(element: Element) {
    const type = element.getAttribute('popover')?.toLowerCase();
    try {
        return (type === '' || type === 'auto') && element.matches(':popover-open');
    } catch {
        return false;
    }
}

/**
 * The popup an expanded trigger controls: a menu, listbox, dialog, tree or grid (`aria-haspopup`),
 * or a select-only combobox's list. Not a disclosure (an accordion's panel) or the suggestions of a
 * text field, which change as the reviewer types.
 */
function controlledPopup(trigger: Element) {
    const haspopup = trigger.getAttribute('aria-haspopup');
    const selectOnly = trigger.getAttribute('role') === 'combobox'
        && !trigger.matches('input,textarea,[contenteditable]:not([contenteditable="false"])');
    if (!selectOnly && (haspopup === null || haspopup === 'false')) return undefined;
    for (const id of (trigger.getAttribute('aria-controls') ?? '').split(/\s+/)) {
        const popup = id ? document.getElementById(id) : null;
        if (popup && isShown(popup)) return popup;
    }
    return undefined;
}

/** The page's open layers that are not modal dialogs, in document order */
function openLayers(host: HTMLElement, modal: HTMLDialogElement | undefined) {
    const scope = modal ?? document;
    const layers = new Set<Element>();
    for (const popover of scope.querySelectorAll('[popover]')) {
        if (popover !== host && isOpenLightDismissPopover(popover)) layers.add(popover);
    }
    for (const trigger of scope.querySelectorAll('[aria-expanded="true"]')) {
        const popup = controlledPopup(trigger);
        if (popup) layers.add(popup);
    }
    for (const dialog of scope.querySelectorAll('[aria-modal="true"]')) {
        if (!(dialog instanceof HTMLDialogElement) && isShown(dialog)) layers.add(dialog);
    }
    // In a modal, only its own content is usable; and never a layer the host itself is in the way of
    return [...layers].filter(layer => (!modal || modal.contains(layer)) && !host.contains(layer));
}

/** Native and framework layers, including non-modal dialogs and manual popovers, for anchoring. */
function openAnchorLayers(host: HTMLElement) {
    return [...document.querySelectorAll('dialog[open],[popover],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tree"],[role="grid"]')]
        .filter(layer => layer !== host && !host.contains(layer) && pageLayerIsOpen(layer));
}

function pageLayerIsOpen(layer: Element) {
    if (!isShown(layer)) return false;
    if (layer instanceof HTMLDialogElement) return layer.open;
    if (layer.hasAttribute('popover')) {
        try { return layer.matches(':popover-open'); } catch { return false; }
    }
    return true;
}

/** Open state for saved page openers, including invokers that have no aria-expanded attribute. */
export function layerOpenerIsExpanded(opener: Element) {
    if (opener.hasAttribute('aria-expanded')) return opener.getAttribute('aria-expanded') === 'true';
    const remembered = layersByOpener.get(opener);
    if (remembered && pageLayerIsOpen(remembered)) return true;
    for (const id of [opener.getAttribute('popovertarget'), opener.getAttribute('commandfor'), ...(opener.getAttribute('aria-controls') ?? '').split(/\s+/)]) {
        const layer = id ? document.getElementById(id) : null;
        if (layer && (layer instanceof HTMLDialogElement || layer.hasAttribute('popover')) && pageLayerIsOpen(layer)) return true;
    }
    return false;
}

/** The page element outside the layer that opens it: its expanded trigger, else a popover or command invoker */
function openerOf(layer: Element) {
    const recorded = recentLayerOpeners.get(layer);
    const validRecorded = recorded?.isConnected && !layer.contains(recorded) && !recorded.contains(layer) && isShown(recorded) ? recorded : undefined;
    if (!layer.id) return validRecorded;
    const id = CSS.escape(layer.id);
    const outside = (element: Element) => !layer.contains(element) && !element.contains(layer) && isShown(element);
    try {
        const triggers = [...document.querySelectorAll(`[aria-controls~="${id}"]`)].filter(outside);
        const command = [...document.querySelectorAll(`[popovertarget="${id}"],[commandfor="${id}"]`)].filter(outside);
        return triggers.find(trigger => trigger.getAttribute('aria-expanded') === 'true')
            ?? validRecorded
            ?? command.find(trigger => trigger.matches(':focus'))
            ?? command[0]
            ?? triggers.find(trigger => trigger.hasAttribute('aria-haspopup'));
    } catch {
        return undefined;
    }
}

/**
 * The page element that opens the open menu, popover or dialog the element is in: of nested ones
 * (a submenu in a menu), the outermost, which is what is on the page when they are all closed.
 */
export function layerOpener(element: Element) {
    const host = getToolbarHost();
    if (!host) return undefined;
    const layers = openAnchorLayers(host);
    let opener: Element | undefined;
    for (let node: Element = element, depth = 0; depth < 8; depth++) {
        // A static grid/listbox inside a dialog is content, not a layer with its own opener.
        const containing = layers.filter(layer => layer.contains(node))
            .map(layer => ({ layer, opener: openerOf(layer) })).filter(entry => entry.opener);
        const innermost = containing.find(entry => !containing.some(other => other !== entry && entry.layer.contains(other.layer)));
        if (!innermost?.opener) break;
        opener = node = innermost.opener;
    }
    return opener;
}

function showOnTop(host: HTMLElement) {
    try {
        if (host.matches(':popover-open')) host.hidePopover();
        host.showPopover();
    } catch (error) {
        console.debug('uier-toolbar: Could not show the toolbar above the page layer', error);
    }
}

/** Keeps the review host usable in the page's topmost open layer. Returns the cleanup. */
export function followPageLayers(host: HTMLElement) {
    if (typeof host.showPopover !== 'function') return () => {};

    // Modals and other layers in the order they opened: the last one is on top
    let openedModals: HTMLDialogElement[] = [];
    let openedLayers: Element[] = [];
    // Popovers that are closing: moved out of before they hide (a hidden ancestor would hide the host)
    const closing = new Set<Element>();
    // The review layer's focused element, given back when moving the host took it away
    let lastFocused: Element | undefined;

    // Capture before page handlers (including pointerdown menus and keyboard-only triggers).
    // Only layers that actually open during this activation are associated with the trigger.
    let activation: { trigger: Element; before: Set<Element>; time: number } | undefined;
    const remember = (layer: Element, trigger: Element) => {
        if (layer === host || layer.contains(trigger) || trigger.contains(layer) || host.contains(trigger)) return;
        // A click near newly rendered page content is not evidence that it opened an overlay.
        const native = layer instanceof HTMLDialogElement || layer.hasAttribute('popover') || layer.getAttribute('aria-modal') === 'true';
        const declared = trigger.matches('[aria-haspopup]:not([aria-haspopup="false"]),[aria-controls],[popovertarget],[commandfor]');
        if (!native && !(declared && layer.matches('[role="dialog"],[role="alertdialog"],[role="menu"]'))) return;
        recentLayerOpeners.set(layer, trigger);
        layersByOpener.set(trigger, layer);
    };
    const rememberOpenedLayers = () => {
        if (!activation || performance.now() - activation.time > 1000) return;
        for (const layer of openAnchorLayers(host)) {
            if (!activation.before.has(layer)) remember(layer, activation.trigger);
        }
    };
    const rememberOpener = (event: Event) => {
        if (event.composedPath().includes(host)) return;
        if (event instanceof KeyboardEvent && !['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(event.key)) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const trigger = target.closest('button,[role="button"],[role="combobox"],[role="menuitem"],[aria-haspopup],[aria-controls],[popovertarget],[commandfor]');
        rememberOpenedLayers();
        activation = undefined;
        if (!trigger || trigger.matches(':disabled,[aria-disabled="true"]')) return;
        activation = { trigger, before: new Set(openAnchorLayers(host)), time: performance.now() };
        // Framework portals often mount in a microtask, or the frame after the event.
        schedule();
    };
    for (const type of ['pointerdown', 'click', 'keydown']) window.addEventListener(type, rememberOpener, true);

    const sync = (raise: boolean) => {
        rememberOpenedLayers();
        openedModals = openedModals.filter(isModal);
        for (const dialog of document.querySelectorAll('dialog[open]')) {
            if (isModal(dialog) && !openedModals.includes(dialog)) openedModals.push(dialog);
        }
        const modal = openedModals.at(-1);
        const layers = openLayers(host, modal).filter(layer => !closing.has(layer));
        openedLayers = openedLayers.filter(layer => layers.includes(layer));
        for (const layer of layers) if (!openedLayers.includes(layer)) openedLayers.push(layer);
        const layer = openedLayers.at(-1) ?? modal;

        const disconnected = !host.isConnected;
        const focused = host.shadowRoot?.activeElement ?? (disconnected ? lastFocused : undefined);
        const changed = layer !== activeLayer;
        activeModal = modal;
        activeLayer = layer;
        if (changed) watchLayer(layer);
        if (layer) {
            if (host.getAttribute('popover') !== 'manual') host.setAttribute('popover', 'manual');
            // Moving the host hides its popover; showing it again puts it above this layer.
            // The same layer opened again, or another one above it, is above the popover now.
            if (host.parentNode !== layer) {
                layer.appendChild(host);
                showOnTop(host);
            } else if (changed || raise || !host.matches(':popover-open')) {
                showOnTop(host);
            }
            // Set on the host by the page for what is outside its layer, while the host was outside
            host.removeAttribute('inert');
            host.removeAttribute('aria-hidden');
        } else if (changed || disconnected || host.parentNode !== document.body) {
            if (host.matches(':popover-open')) host.hidePopover();
            host.removeAttribute('popover');
            if (host.parentNode !== document.body) document.body.appendChild(host);
        }
        // Moving or hiding the host took the focus (to the page, or nowhere): give it back
        if (focused?.isConnected && host.shadowRoot?.activeElement !== focused
            && (!document.activeElement || document.activeElement === document.body || document.activeElement === host || !disconnected)) {
            (focused as HTMLElement).focus?.({ preventScroll: true });
        }
    };

    let scheduled = false;
    let raiseScheduled = false;
    // After the page's own changes in the same task, before the next frame
    const schedule = (raise = false) => {
        raiseScheduled ||= raise;
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            const raiseNow = raiseScheduled;
            raiseScheduled = false;
            sync(raiseNow);
        });
    };

    // A layer that the page hides with a class or style (not an attribute watched below) would hide the
    // host with it: its own and its ancestors' changes are checked, and only while the host is in it
    const layerObserver = new MutationObserver(() => {
        if (activeLayer && activeLayer !== activeModal && !isShown(activeLayer)) schedule();
    });
    function watchLayer(layer: Element | undefined) {
        layerObserver.disconnect();
        for (let node: Element | null | undefined = layer; node && node !== document.documentElement; node = node.parentElement) {
            layerObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        }
    }

    const observer = new MutationObserver((records) => {
        const layerChanged = records.some(record => record.type === 'attributes' && record.target !== host
            && !['class', 'style', 'data-state'].includes(record.attributeName ?? ''));
        // The page removed the layer, or replaced its content, with the host inside
        const awaitingLayer = activation && performance.now() - activation.time <= 1000
            && records.some(record => record.target !== host);
        if (layerChanged || awaitingLayer || !host.isConnected || (activeLayer && !activeLayer.isConnected)) {
            schedule(records.some(record => record.target instanceof HTMLDialogElement));
        }
    });
    observer.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['open', 'aria-expanded', 'aria-controls', 'aria-modal', 'hidden', 'popover', 'class', 'style', 'data-state']
    });
    // Taken off again whenever the page sets them on the host while it is in a layer
    const hostObserver = new MutationObserver(() => {
        if (activeLayer) {
            host.removeAttribute('inert');
            host.removeAttribute('aria-hidden');
        }
    });
    hostObserver.observe(host, { attributes: true, attributeFilter: ['inert', 'aria-hidden'] });

    // Popovers open and close without an attribute change
    const toggled = (event: Event) => {
        const target = event.target;
        if (target === host || !(target instanceof Element)) return;
        const newState = (event as ToggleEvent).newState;
        if (newState === 'open') {
            const source = (event as ToggleEvent & { source?: Element | null }).source;
            if (source) remember(target, source);
            else if (activation && performance.now() - activation.time <= 1000 && !activation.before.has(target)) {
                remember(target, activation.trigger);
            }
        }
        if (event.type === 'beforetoggle') {
            if (newState !== 'closed' || !target.contains(host)) return;
            closing.add(target);
            sync(false);
            return;
        }
        closing.delete(target);
        schedule(newState === 'open');
    };
    document.addEventListener('beforetoggle', toggled, true);
    document.addEventListener('toggle', toggled, true);
    // A script dialog shown with a class (no attribute change) moves the focus into itself
    const pageFocused = (event: Event) => {
        if (!event.composedPath().includes(host)) schedule();
    };
    document.addEventListener('focusin', pageFocused, true);

    const trackFocus = (event: Event) => {
        const target = event.composedPath()[0];
        if (target instanceof Element) lastFocused = target;
    };
    const forgetFocus = (event: Event) => {
        const next = (event as FocusEvent).relatedTarget;
        if (next instanceof Node && !host.contains(next) && next !== host) lastFocused = undefined;
    };
    host.shadowRoot?.addEventListener('focusin', trackFocus);
    host.shadowRoot?.addEventListener('focusout', forgetFocus);

    // Page shortcut handlers see the shadow host as the target, hiding editable controls.
    // Keep their keyboard events inside even without a page layer; toolbar window listeners
    // still receive them through listenToWindowKeydown. Other controls keep normal shortcuts.
    const keep = (event: Event) => {
        const editing = event instanceof KeyboardEvent && isLetterKeyTarget(event, host);
        if (!activePageLayer() && !editing) return;
        keptEvents.add(event);
        event.stopPropagation();
    };
    for (const type of keptEventTypes) host.addEventListener(type, keep);
    // Escape in the review layer is the review layer's: it never closes the page's dialog or popover
    // as well. Bubbling, so the toolbar's own controls (and their popovers) handle it first.
    const keepEscape = (event: KeyboardEvent) => {
        if (activePageLayer() && event.key === 'Escape') event.preventDefault();
    };
    host.addEventListener('keydown', keepEscape);
    sync(false);

    return () => {
        for (const type of ['pointerdown', 'click', 'keydown']) window.removeEventListener(type, rememberOpener, true);
        observer.disconnect();
        hostObserver.disconnect();
        layerObserver.disconnect();
        document.removeEventListener('beforetoggle', toggled, true);
        document.removeEventListener('toggle', toggled, true);
        document.removeEventListener('focusin', pageFocused, true);
        host.shadowRoot?.removeEventListener('focusin', trackFocus);
        host.shadowRoot?.removeEventListener('focusout', forgetFocus);
        for (const type of keptEventTypes) host.removeEventListener(type, keep);
        host.removeEventListener('keydown', keepEscape);
        if (activeLayer) {
            activeModal = undefined;
            activeLayer = undefined;
            host.removeAttribute('popover');
        }
    };
}
