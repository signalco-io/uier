import { useSyncExternalStore } from 'react';
import { getToolbarHost } from './mount';
import { shortcutLetter, shortcutsEnabled, subscribeShortcutsEnabled } from './keyboard';

export { setShortcutsEnabled } from './keyboard';

/**
 * The toolbar's main keyboard shortcut: C starts point mode (or ends it), like the comment tool of design
 * tools; with page text selected, it comments on the selection. One letter without a modifier, like the
 * others (`toolbarShortcuts`), so they can be turned off in Options (WCAG 2.1.4) and never fire while the
 * reviewer types or uses a widget whose letters choose an item.
 */
export const addCommentShortcut = 'C';

/** A key as it is printed, and its name where the print is a symbol (screen readers read "Left arrow") */
type ShortcutKey = string | { print: string; name: string };

/**
 * Every keyboard shortcut of the toolbar, as Options lists them (`?`). `letter`: a single-key shortcut,
 * which the switch turns off. Keep it in step with the handlers (`CommentsGlobal`, the pill, the menus).
 */
export const toolbarShortcuts: { label: string; keys: ShortcutKey[]; join?: 'or' | 'then'; letter?: boolean }[] = [
    { label: 'Add comment', keys: [addCommentShortcut], letter: true },
    { label: 'Open the inbox', keys: ['G', 'I'], join: 'then', letter: true },
    { label: 'Search the inbox', keys: ['/'], letter: true },
    { label: 'Next thread', keys: ['J'], letter: true },
    { label: 'Previous thread', keys: ['K'], letter: true },
    { label: 'Reply', keys: ['R'], letter: true },
    { label: 'Go to Mark as done', keys: ['S'], letter: true },
    { label: 'Assign', keys: ['A'], letter: true },
    { label: 'Show shortcuts', keys: ['?'], letter: true },
    { label: 'Send a comment', keys: ['Enter'] },
    { label: 'New line in a comment', keys: ['Shift', 'Enter'] },
    { label: 'Move along the toolbar', keys: [{ print: '←', name: 'Left arrow' }, { print: '→', name: 'Right arrow' }], join: 'or' },
    { label: 'Move in a menu', keys: [{ print: '↑', name: 'Up arrow' }, { print: '↓', name: 'Down arrow' }], join: 'or' },
    { label: 'Close', keys: ['Esc'] }
];

/** Inputs that take no text: a letter on them does nothing */
const nonTextInputTypes = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Widgets whose letter keys type or choose an item (typeahead) */
const letterKeyRoles = new Set(['application', 'combobox', 'grid', 'listbox', 'menu', 'menubar', 'searchbox', 'slider', 'spinbutton', 'textbox', 'tree', 'treegrid']);

/** Whether the key is the Add comment shortcut, pressed alone and not already handled by the page */
export function isAddCommentShortcut(event: KeyboardEvent) {
    return shortcutLetter(event) === 'c';
}

/** Whether the key went to a text field or a widget that uses letters, on the page or in the toolbar */
export function isLetterKeyTarget(event: KeyboardEvent) {
    const host = getToolbarHost();
    for (const node of event.composedPath()) {
        // A key in the toolbar did not go to the page's menu or dialog that its host is in (modalLayer.ts)
        if (host && node === host) return false;
        if (!(node instanceof HTMLElement)) continue;
        if (node.isContentEditable || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
        if (node instanceof HTMLInputElement) {
            if (nonTextInputTypes.has(node.type)) continue;
            return true;
        }
        const role = node.getAttribute('role');
        if (role !== null && letterKeyRoles.has(role)) return true;
    }
    return false;
}

/** Whether the keyboard shortcuts are on (they are unless the reviewer turned them off in Options) */
export function useShortcutsEnabled() {
    return useSyncExternalStore(subscribeShortcutsEnabled, shortcutsEnabled, () => true);
}

// A mouse or trackpad comes with a keyboard. A phone's on-screen keyboard has no Shift+Enter: its
// Enter key sends (the text boxes label it with `enterKeyHint`).
const keyboardQuery = '(any-pointer: fine)';
const subscribeKeyboard = (listener: () => void) => {
    const query = window.matchMedia(keyboardQuery);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
};

/** Whether a keyboard is likely: Options offers the shortcuts' switch, composers describe Enter and Shift+Enter */
export function useKeyboardLikely() {
    return useSyncExternalStore(subscribeKeyboard, () => window.matchMedia(keyboardQuery).matches, () => true);
}
