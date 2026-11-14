'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui/popover';
import { cn } from '@/src/lib/utils';
import { hoverPopoverTrigger } from './hoverPopover';

const triggerClassName = 'inline-flex cursor-pointer items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A label in a page header with more about it in a popover (the project's client and who can comment;
 * uier #420, #421). The popover opens on hover. With `href` the label is a link: a click or Enter goes
 * there, keyboard focus opens the popover (Tab moves into it), and a tap on a touch screen opens it
 * instead of following the link, so it must hold a way there. Without `href` the label is a button
 * that opens the popover. `onOpen` runs each time it opens, so its content can load only when someone
 * looks at it.
 */
export function LinkPopover({ href, label, trigger, className, contentClassName, onOpen, children }: {
    href?: string;
    /** The popover's accessible name */
    label: string;
    trigger: ReactNode;
    className?: string;
    contentClassName?: string;
    onOpen?: () => void;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    // Whether the press on the label is a tap (touch or pen), which opens the popover rather than following the link
    const tap = useRef(false);
    // Opened by keyboard focus: the focus stays on the label until Tab moves it in
    const focusOpened = useRef(false);
    const popupRef = useRef<HTMLDivElement>(null);

    function change(next: boolean, byFocus = false) {
        if (next && !open) {
            focusOpened.current = byFocus;
            onOpen?.();
        }
        setOpen(next);
    }

    return (
        <Popover
            open={open}
            // A click on the link goes there; it doesn't keep the popover open over the next page
            onOpenChange={(next, details) => change(next && !(href && details.reason === 'trigger-press' && !tap.current))}>
            <PopoverTrigger
                className={cn(triggerClassName, className)}
                {...(href ? { render: <Link href={href} />, nativeButton: false, role: 'link' } : {})}
                {...hoverPopoverTrigger}
                onPointerDown={event => { tap.current = event.pointerType === 'touch' || event.pointerType === 'pen'; }}
                onKeyDown={() => { tap.current = false; }}
                onClick={(event) => {
                    if (!href)
                        return;
                    if (tap.current)
                        event.preventDefault();
                    else
                        change(false);
                }}
                // Enter follows a link, so keyboard focus opens its popover and Tab moves into it (Enter opens a button's)
                onFocus={(event) => {
                    // Not when Escape brings the focus back from the popover
                    if (href && event.currentTarget.matches(':focus-visible') && !popupRef.current?.contains(event.relatedTarget as Node | null))
                        change(true, true);
                }}
                onBlur={(event) => {
                    const trigger = event.currentTarget;
                    // After the move: Tab from the label goes into the popover through its focus guard
                    setTimeout(() => {
                        const active = document.activeElement;
                        const keep = (element: Element | null | undefined) => !!element && (element.contains(active) || element.matches(':hover'));
                        if (!keep(trigger) && !keep(popupRef.current))
                            setOpen(false);
                    });
                }}>
                {trigger}
            </PopoverTrigger>
            <PopoverContent ref={popupRef} initialFocus={() => !focusOpened.current}
                // Back to the label only from inside the popover; closing one the pointer opened leaves the focus where it is
                finalFocus={() => !!popupRef.current?.contains(document.activeElement)}
                // A link in it goes on to another page, which may keep this header (a project's settings)
                onClick={(event) => {
                    if ((event.target as Element).closest('a[href]'))
                        setOpen(false);
                }} align="start" aria-label={label} className={cn('w-80', contentClassName)}>
                {children}
            </PopoverContent>
        </Popover>
    );
}
