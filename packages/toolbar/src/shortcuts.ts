import { useSyncExternalStore } from 'react';

/**
 * The toolbar's keyboard shortcut: C starts point mode (or ends it), like the comment tool of design
 * tools; with page text selected, it comments on the selection. One letter without a modifier, so it can
 * be turned off in Options (WCAG 2.1.4) and never fires while the reviewer types or uses a widget whose
 * letters choose an item.
 */
export const addCommentShortcut = 'C';

const disabledStorageKey = 'uier:shortcuts-off';

/** Inputs that take no text: a letter on them does nothing */
const nonTextInputTypes = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Widgets whose letter keys type or choose an item (typeahead) */
const letterKeyRoles = new Set(['application', 'combobox', 'grid', 'listbox', 'menu', 'menubar', 'searchbox', 'slider', 'spinbutton', 'textbox', 'tree', 'treegrid']);

/** Whether the key is the Add comment shortcut, pressed alone and not already handled by the page */
export function isAddCommentShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return false;
    }
    // The letter where the layout has Latin letters (QWERTZ, AZERTY, Dvorak), else the key in its place.
    // Autofill sends key events without a key.
    const key = event.key ?? '';
    return key.toLowerCase() === 'c' || (!/^[a-z]$/i.test(key) && event.code === 'KeyC');
}

/** Whether the key went to a text field or a widget that uses letters, on the page or in the toolbar */
export function isLetterKeyTarget(event: KeyboardEvent) {
    return event.composedPath().some(node => {
        if (!(node instanceof HTMLElement)) return false;
        if (node.isContentEditable || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
        if (node instanceof HTMLInputElement) return !nonTextInputTypes.has(node.type);
        const role = node.getAttribute('role');
        return role !== null && letterKeyRoles.has(role);
    });
}

const listeners = new Set<() => void>();
let enabled: boolean | undefined;

function readEnabled() {
    try {
        return window.localStorage.getItem(disabledStorageKey) !== 'true';
    } catch {
        return true;
    }
}

function getEnabled() {
    enabled ??= readEnabled();
    return enabled;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    // Turned on or off in another tab of the site
    const onStorage = (event: StorageEvent) => {
        if (event.key !== disabledStorageKey && event.key !== null) return;
        enabled = readEnabled();
        listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
    };
}

/** Turns the shortcut on or off in this browser (for this page only when storage is unavailable) */
export function setShortcutsEnabled(next: boolean) {
    enabled = next;
    try {
        if (next) {
            window.localStorage.removeItem(disabledStorageKey);
        } else {
            window.localStorage.setItem(disabledStorageKey, 'true');
        }
    } catch {
        // Not remembered: the shortcut is on again on the next page
    }
    listeners.forEach(listener => listener());
}

/** Whether the keyboard shortcut is on (it is unless the reviewer turned it off in Options) */
export function useShortcutsEnabled() {
    return useSyncExternalStore(subscribe, getEnabled, () => true);
}
