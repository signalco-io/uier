/**
 * The keys that act on a thread (R, S, A) find it and its controls in the toolbar's shadow root: a
 * thread is a pin's popover or an inbox card (`data-uier-thread-scope`), with its header
 * (`data-uier-thread-header`), its status menu's badge (`data-uier-status`) and its reply box or Reply button
 * (`data-uier-reply`).
 */

/** Dispatched on a thread's header: A opens its people to assign (cancelled when it did) */
export const assignShortcutEvent = 'uier:assign';

/** The thread the keys act on: the one with the focus, else the only thread popover open on the page */
export function shortcutThread(root: ShadowRoot) {
    const focused = root.activeElement?.closest<HTMLElement>('[data-uier-thread-scope]');
    if (focused) return focused;
    const open = [...root.querySelectorAll<HTMLElement>('[data-uier-thread-scope][data-state="open"]')];
    return open.length === 1 ? open[0] : undefined;
}

/**
 * R: the reply box gets the focus (an inbox card's Reply opens it first); S: the focus goes to the status
 * menu (Enter opens it); A: the people to assign open, the first focused. Whether the thread had the control.
 */
export function actOnThread(thread: HTMLElement, letter: 'r' | 's' | 'a') {
    if (letter === 'r') {
        // The reply box comes after the messages (an edited message has a text box of its own)
        const box = [...thread.querySelectorAll<HTMLTextAreaElement>('textarea')].at(-1);
        if (box) {
            box.focus();
            return true;
        }
        const reply = thread.querySelector<HTMLButtonElement>('[data-uier-reply]:not(:disabled)');
        reply?.click();
        return Boolean(reply);
    }
    if (letter === 's') {
        const status = thread.querySelector<HTMLButtonElement>('[data-uier-status]:not(:disabled)');
        status?.focus();
        return Boolean(status);
    }
    const header = thread.querySelector('[data-uier-thread-header]');
    return Boolean(header && !header.dispatchEvent(new CustomEvent(assignShortcutEvent, { cancelable: true })));
}
