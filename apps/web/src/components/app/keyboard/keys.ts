'use client';

import { useEffect, useEffectEvent, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { isLetterKeyTarget, rovingIndex, shortcutLetter, shortcutsEnabled, subscribeShortcutsEnabled, type FocusOrientation } from '@uier/toolbar/keyboard';

/**
 * Typing, or a popup that owns its keys: a menu, a list of options or a dialog. A dialog marked
 * `data-shortcuts` (the board's thread sheet) leaves the thread's shortcuts working in it.
 */
export function ownsKeys(element: Element) {
    const owner = element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]');
    return Boolean(owner && !owner.matches('[data-shortcuts]'));
}

/**
 * Whether a key went where a single-key shortcut may act: not a text field, a menu or a dialog, and not uier's
 * own review toolbar (its shadow root's events reach the page from its host, and its keys are its own).
 */
export function isShortcutTarget(event: KeyboardEvent) {
    if (isLetterKeyTarget(event)) return false;
    // `target` is retargeted to the toolbar host for events from its shadow root.
    // Check the composed path so app shortcuts never compete with toolbar fields,
    // dialogs or toolbar-owned controls.
    for (const node of event.composedPath()) {
        if (!(node instanceof Element)) continue;
        if (node.id === 'uier-toolbar' || ownsKeys(node)) return false;
    }
    return true;
}

/** Whether single-key shortcuts are on in this browser (the help dialog and the toolbar's Options turn them off) */
export function useShortcutsEnabled() {
    return useSyncExternalStore(subscribeShortcutsEnabled, shortcutsEnabled, () => true);
}

/**
 * Single-letter shortcuts while they are on: `handlers` by lower-case letter. A handler that returns
 * `false` leaves the key alone; otherwise the key is taken (`preventDefault`). Bubble phase on the
 * document, after the page's own handlers, so a key a control already used (M on a board card) stays
 * its own, and never with a modifier, while typing, or in a menu or dialog.
 */
export function useKeyShortcuts(handlers: Partial<Record<string, (event: KeyboardEvent) => boolean | void>>, { enabled = true }: { enabled?: boolean } = {}) {
    const on = useShortcutsEnabled() && enabled;
    const handle = useEffectEvent((event: KeyboardEvent) => {
        const letter = shortcutLetter(event);
        const handler = letter ? handlers[letter] : undefined;
        if (!handler || !isShortcutTarget(event)) return;
        if (handler(event) !== false) event.preventDefault();
    });
    useEffect(() => {
        if (!on) return;
        const listener = (event: KeyboardEvent) => handle(event);
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [on]);
}

/** The `aria-keyshortcuts` of a control a single-key shortcut presses: only while the shortcuts are on */
export function useKeyShortcutLabel(key: string) {
    return useShortcutsEnabled() ? key : undefined;
}

/**
 * A composite's one tab stop (a roving tab index), like the comments list's: the item last focused,
 * else `preferred` (the current tab or page), else the first. The arrow keys of `orientation`, Home and
 * End move the focus between the items (`itemProps`) and stop at the ends; Tab leaves the composite.
 * When `preferred` changes (another page is current), the tab stop follows it.
 */
export function useRovingTabStop(keys: string[], { preferred, orientation }: { preferred?: string; orientation: FocusOrientation }) {
    const [state, setState] = useState<{ preferred?: string; focused?: string }>({ preferred });
    if (state.preferred !== preferred) setState({ preferred });
    const { focused } = state;
    const tabStop = focused !== undefined && keys.includes(focused) ? focused
        : preferred !== undefined && keys.includes(preferred) ? preferred : keys[0];
    return {
        tabStop,
        containerProps: {
            onFocus: (event: FocusEvent<HTMLElement>) => {
                const key = (event.target as Element).closest<HTMLElement>('[data-roving-item]')?.dataset.rovingItem;
                if (key !== undefined && key !== focused) setState(current => ({ ...current, focused: key }));
            },
            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
                if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-roving-item]')].filter(item => item.checkVisibility());
                const index = items.findIndex(item => item === event.target);
                // Only from an item itself: a menu or a field inside the composite keeps its keys
                if (index < 0) return;
                const next = rovingIndex(event.key, index, items.length, { orientation });
                if (next === undefined) return;
                event.preventDefault();
                items[next]!.focus({ preventScroll: true });
                items[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        },
        itemProps: (key: string) => ({ 'data-roving-item': key, tabIndex: key === tabStop ? 0 : -1 })
    };
}
