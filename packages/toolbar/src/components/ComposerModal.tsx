'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { IconTooltip, TooltipContainerContext } from './IconTooltip';
import { composerIconButtonClassName } from './ComposerAttachments';
import { floatingShadowClassName } from './@types/Comments';

/** Lucide's maximize-2 and minimize-2, drawn like the UI kit's icons (the kit has neither) */
function ExpandIcon({ expanded }: { expanded: boolean }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {expanded ? <>
                <path d="m14 10 7-7" />
                <path d="M20 10h-6V4" />
                <path d="m3 21 7-7" />
                <path d="M4 14h6v6" />
            </> : <>
                <path d="M15 3h6v6" />
                <path d="m21 3-7 7" />
                <path d="m3 21 7-7" />
                <path d="M9 21H3v-6" />
            </>}
        </svg>
    );
}

/**
 * Expand (in the popover) and Collapse (in the modal), at the end of a new comment's or feedback's
 * header: the same form, with more room for writing.
 */
export function ExpandComposerButton({ expanded, onExpandedChange }: { expanded: boolean; onExpandedChange: (expanded: boolean) => void }) {
    return (
        <IconTooltip label={expanded ? 'Back to the smaller form' : 'Expand for more room to write'} shortcut={expanded ? 'Esc' : undefined}>
            <IconButton
                variant="plain"
                size="xs"
                type="button"
                aria-label={expanded ? 'Collapse' : 'Expand'}
                aria-keyshortcuts={expanded ? 'Escape' : undefined}
                className={composerIconButtonClassName}
                onClick={() => onExpandedChange(!expanded)}>
                <ExpandIcon expanded={expanded} />
            </IconButton>
        </IconTooltip>
    );
}

/**
 * A new comment or feedback expanded from its popover for focused writing: a native modal dialog
 * (`showModal`) in the toolbar's shadow root, so it is in the top layer, the rest of the page and the
 * toolbar are inert behind its backdrop, and Tab stays in it. Its state (the text in the drafts, the
 * attached image, the screenshot and the choice to omit it) belongs to the form's owner, so the same
 * form goes on here and back in the popover. Escape and a press on the backdrop collapse it again.
 * Not a reviewable part of the toolbar: it holds the comment being written.
 */
export function ComposerModal({ container, label, onCollapse, className, children, ...rest }: {
    container: HTMLElement | null | undefined;
    label: string;
    onCollapse: () => void;
    className?: string;
    children: ReactNode;
} & Record<`data-${string}`, string>) {
    const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
    // The form mounts once the dialog is shown: a closed dialog has no layout, and the text box sizes
    // itself to its text when it mounts
    const [shown, setShown] = useState(false);
    const collapseRef = useRef(onCollapse);
    useLayoutEffect(() => { collapseRef.current = onCollapse; });

    useLayoutEffect(() => {
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
        setShown(true);
        // Escape is a `cancel`: it goes back to the popover instead of closing the form. A browser
        // may close the dialog anyway (a repeated Escape without other input in between can't be
        // cancelled): that goes back too.
        const cancel = (event: Event) => {
            event.preventDefault();
            collapseRef.current();
        };
        const closed = () => collapseRef.current();
        dialog.addEventListener('cancel', cancel);
        dialog.addEventListener('close', closed);
        return () => {
            dialog.removeEventListener('cancel', cancel);
            dialog.removeEventListener('close', closed);
            if (dialog.open) dialog.close();
        };
    }, [dialog]);

    if (!container) return null;
    return createPortal(
        <dialog
            ref={setDialog}
            aria-label={label}
            {...rest}
            className={cx(
                'm-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground',
                'backdrop:bg-black/10 backdrop:backdrop-blur-xs'
            )}
            // A press on the backdrop is on the dialog itself
            onClick={event => { if (event.target === event.currentTarget) onCollapse(); }}>
            <TooltipContainerContext value={dialog}>
                <div className={cx('flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border bg-popover text-popover-foreground', floatingShadowClassName, className)}>
                    {shown && children}
                </div>
            </TooltipContainerContext>
        </dialog>,
        container
    );
}
