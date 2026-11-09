/**
 * The keyboard vocabulary the toolbar and the uier app share (`@uier/toolbar/keyboard`): whether
 * single-key shortcuts are on in this browser, which key a shortcut press is, and where the arrow
 * keys move the focus in a composite control (a list, tabs, a toolbar, a menu, a board column).
 * Pure: no React and no DOM at import, so the app and server code can import it.
 */

/**
 * Single-key shortcuts can be turned off (WCAG 2.1.4): speech input or a page's own keys may need
 * the letters. One switch for the toolbar and the app (both on uier.io share it), kept per browser.
 */
export const shortcutsOffStorageKey = 'uier:shortcuts-off';

const listeners = new Set<() => void>();
let enabled: boolean | undefined;

function storage() {
    try {
        return globalThis.localStorage as Storage | undefined;
    } catch {
        return undefined;
    }
}

function readEnabled() {
    try {
        return storage()?.getItem(shortcutsOffStorageKey) !== 'true';
    } catch {
        return true;
    }
}

/** Whether single-key shortcuts are on (they are unless turned off in this browser) */
export function shortcutsEnabled() {
    enabled ??= readEnabled();
    return enabled;
}

/** Turns single-key shortcuts on or off in this browser (for this page only when storage is unavailable) */
export function setShortcutsEnabled(next: boolean) {
    enabled = next;
    try {
        if (next) storage()?.removeItem(shortcutsOffStorageKey);
        else storage()?.setItem(shortcutsOffStorageKey, 'true');
    } catch {
        // Not remembered: the shortcuts are on again on the next page
    }
    listeners.forEach(listener => listener());
}

/** Calls `listener` when the shortcuts are turned on or off, here or in another tab of the site */
export function subscribeShortcutsEnabled(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
        if (event.key !== shortcutsOffStorageKey && event.key !== null) return;
        enabled = readEnabled();
        listener();
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
        listeners.delete(listener);
        globalThis.removeEventListener?.('storage', onStorage);
    };
}

/**
 * A key press a single-key shortcut may take: not one the page already handled, not held down, not
 * composing text, and without Ctrl, ⌘ or Alt (those are the browser's and the system's).
 */
export function isShortcutPress(event: KeyboardEvent) {
    return !event.defaultPrevented && !event.repeat && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * The letter a shortcut press stands for, lower case, without Shift: the letter where the layout has
 * Latin letters (QWERTZ, AZERTY, Dvorak), else the key in its place. Autofill sends key events
 * without a key.
 */
export function shortcutLetter(event: KeyboardEvent) {
    if (!isShortcutPress(event) || event.shiftKey) return undefined;
    const key = event.key ?? '';
    if (/^[a-z]$/i.test(key)) return key.toLowerCase();
    const code = /^Key([A-Z])$/.exec(event.code ?? '');
    return key.length !== 1 || !/\p{L}/u.test(key) ? undefined : code?.[1]?.toLowerCase();
}

/** `?`, which opens the list of shortcuts (Shift is part of it on most layouts) */
export function isShortcutsHelpKey(event: KeyboardEvent) {
    return isShortcutPress(event) && event.key === '?';
}

/** `/`, which goes to the search */
export function isSearchKey(event: KeyboardEvent) {
    return isShortcutPress(event) && !event.shiftKey && event.key === '/';
}

/** How long the second key of a sequence (G, then I) may follow the first */
export const sequenceTimeoutMs = 1500;

/** Which arrow keys move in a composite: a row (←/→), a column (↑/↓) or either */
export type FocusOrientation = 'horizontal' | 'vertical' | 'both';

/**
 * Where a key moves the focus among `count` items from `index` (−1: none has it yet): the next or
 * the previous one for the arrows of its orientation, the first for Home, the last for End. At the
 * ends it stays (or wraps around with `loop`). `undefined`: the key does not move in this control.
 */
export function rovingIndex(key: string, index: number, count: number, { orientation = 'both', loop = false }: { orientation?: FocusOrientation; loop?: boolean } = {}) {
    if (!count) return undefined;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    const forward = (orientation !== 'vertical' && key === 'ArrowRight') || (orientation !== 'horizontal' && key === 'ArrowDown');
    const backward = (orientation !== 'vertical' && key === 'ArrowLeft') || (orientation !== 'horizontal' && key === 'ArrowUp');
    if (!forward && !backward) return undefined;
    if (index < 0) return forward ? 0 : count - 1;
    const next = index + (forward ? 1 : -1);
    if (loop) return (next + count) % count;
    return Math.min(count - 1, Math.max(0, next));
}
