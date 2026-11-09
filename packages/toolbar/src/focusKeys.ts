import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import { rovingIndex, type FocusOrientation } from './keyboard';

/** Keys that are a text field's or a widget's own: the arrows move the caret or choose there */
const ownArrows = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"], [role="radiogroup"], [role="slider"]';

const plain = (event: KeyboardEvent) => !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/**
 * A toolbar popover or group of buttons that reads like a menu (Options, Thread options, a message's
 * options, Copy, the people to assign): ↑ and ↓ move between its buttons and links, Home and End to the
 * first and the last, and stop at the ends; from the popover itself ↓ goes to the first. A text field in
 * it keeps its keys. Pass as the popover content's (or the group's) `onKeyDown`.
 */
export function moveFocusInMenu(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!plain(event) || target.closest(ownArrows)) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
        .filter(item => item.tabIndex >= 0 && item.checkVisibility());
    const next = rovingIndex(event.key, items.indexOf(target), items.length, { orientation: 'vertical' });
    if (next === undefined) return;
    event.preventDefault();
    items[next]!.focus();
}

/**
 * One tab stop for a group of controls (a roving tab index), like the app's composites: the one last
 * focused, else the `preferred` one (a pressed tab), else the first. The arrow keys of `orientation`,
 * Home and End move the focus between them and stop at the ends; Tab leaves the group. The controls are
 * the group's buttons, outside its popovers; the tab indexes are set on them after every render.
 */
export function useRovingFocus(ref: RefObject<HTMLElement | null>, { orientation, preferred }: { orientation: FocusOrientation; preferred?: () => HTMLElement | null | undefined }) {
    const active = useRef<HTMLElement>(null);
    const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])]
        .filter(button => !button.closest('[role="dialog"]') && !(button as HTMLButtonElement).disabled && button.checkVisibility());
    const sync = () => {
        const list = items();
        const stop = list.find(item => item === active.current) ?? list.find(item => item === preferred?.()) ?? list[0];
        for (const item of list) item.tabIndex = item === stop ? 0 : -1;
    };
    // After every render: a control that appeared (About) starts out of the Tab order
    useLayoutEffect(sync);
    return {
        onFocus: (event: FocusEvent<HTMLElement>) => {
            const button = (event.target as Element).closest('button');
            if (!button || !items().includes(button) || active.current === button) return;
            active.current = button;
            sync();
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (!plain(event)) return;
            const list = items();
            const index = list.indexOf(event.target as HTMLElement);
            if (index < 0) return;
            const next = rovingIndex(event.key, index, list.length, { orientation });
            if (next === undefined) return;
            event.preventDefault();
            list[next]!.focus();
        }
    };
}
