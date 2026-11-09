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

/**
 * The window event that tells every copy of this module on the page that the switch changed (`detail`:
 * whether the shortcuts are on). The app and the toolbar injected into it each bundle their own copy, and
 * a browser sends no `storage` event to the window that wrote the value, so the event keeps them in step;
 * the `storage` event does that for the site's other tabs.
 */
export const shortcutsChangeEvent = 'uier:shortcuts-change';

let enabled: boolean | undefined;
let watching = false;

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

function isSwitchStorageEvent(event: StorageEvent) {
    return event.key === shortcutsOffStorageKey || event.key === null;
}

/** Keeps this copy's cached switch current, before any subscriber hears of a change */
function watch() {
    if (watching || typeof globalThis.addEventListener !== 'function') return;
    watching = true;
    globalThis.addEventListener(shortcutsChangeEvent, event => {
        const next = (event as CustomEvent<unknown>).detail;
        enabled = typeof next === 'boolean' ? next : readEnabled();
    });
    globalThis.addEventListener('storage', event => {
        if (isSwitchStorageEvent(event)) enabled = readEnabled();
    });
}

/** Whether single-key shortcuts are on (they are unless turned off in this browser) */
export function shortcutsEnabled() {
    watch();
    enabled ??= readEnabled();
    return enabled;
}

/**
 * Turns single-key shortcuts on or off in this browser (for this page only when storage is unavailable),
 * for the app and the toolbar on this page as well as the site's other tabs
 */
export function setShortcutsEnabled(next: boolean) {
    watch();
    enabled = next;
    try {
        if (next) storage()?.removeItem(shortcutsOffStorageKey);
        else storage()?.setItem(shortcutsOffStorageKey, 'true');
    } catch {
        // Not remembered: the shortcuts are on again on the next page
    }
    if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new CustomEvent(shortcutsChangeEvent, { detail: next }));
}

/**
 * Calls `listener` when the shortcuts are turned on or off: on this page (by the app or the toolbar) or in
 * another tab of the site
 */
export function subscribeShortcutsEnabled(listener: () => void) {
    if (typeof globalThis.addEventListener !== 'function') return () => {};
    watch();
    const onChange = () => listener();
    const onStorage = (event: StorageEvent) => {
        if (isSwitchStorageEvent(event)) listener();
    };
    globalThis.addEventListener(shortcutsChangeEvent, onChange);
    globalThis.addEventListener('storage', onStorage);
    return () => {
        globalThis.removeEventListener(shortcutsChangeEvent, onChange);
        globalThis.removeEventListener('storage', onStorage);
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
