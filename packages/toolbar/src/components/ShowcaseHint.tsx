'use client';

import React, { RefObject, useId, useLayoutEffect, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Close } from '@signalco/ui-icons';
import { floatingShadowClassName } from './@types/Comments';
import { toolbarConfig } from '../config';

const hintDismissedStorageKey = toolbarConfig.project
    ? `uier:hint:v1:${toolbarConfig.apiUrl}:${toolbarConfig.project}`
    : 'uier:showcase-hint-dismissed';

/** Whether the first-run hint was dismissed before (storage can be unavailable) */
export function isShowcaseHintDismissed() {
    try {
        return window.localStorage.getItem(hintDismissedStorageKey) === 'true';
    } catch {
        return false;
    }
}

export function rememberShowcaseHintDismissed() {
    try {
        window.localStorage.setItem(hintDismissedStorageKey, 'true');
    } catch {
        // Not persisted, the hint shows again on the next visit
    }
}

type ShowcaseHintProps = {
    /** `id` of the hint (the "About uier" button controls it) */
    id?: string;
    access?: 'invited' | 'guests' | 'disabled';
    privateAppFeedback?: boolean;
    brief?: string;
    /** The button the hint's arrow points at (Add comment) */
    pointAtRef?: RefObject<HTMLElement | null>;
    /** `hadFocus` is set when the keyboard focus was inside the hint */
    onDismiss: (hadFocus: boolean) => void;
};

/**
 * First-run hint shown above the toolbar pill. Rendered after the pill, so
 * forward Tab from "About uier" reaches it.
 */
export function ShowcaseHint({ id, pointAtRef, onDismiss, access, privateAppFeedback, brief }: ShowcaseHintProps) {
    const titleId = useId();
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const hintRef = useRef<HTMLElement>(null);

    // The arrow points at the middle of the button, wherever it is in the pill
    const [arrowLeft, setArrowLeft] = useState<number>();
    useLayoutEffect(() => {
        const update = () => {
            const target = pointAtRef?.current?.getBoundingClientRect();
            const hint = hintRef.current?.getBoundingClientRect();
            setArrowLeft(target && hint ? target.left + target.width / 2 - hint.left : undefined);
        };
        update();
        // The pill centres itself after its first size measurement. Observe that settled layout.
        const observer = new ResizeObserver(update);
        const toolbar = pointAtRef?.current?.closest('nav');
        if (toolbar) observer.observe(toolbar);
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [pointAtRef]);

    const handleDismiss = () => {
        const root = hintRef.current?.getRootNode() as Document | ShadowRoot | undefined;
        const hadFocus = Boolean(root?.activeElement && hintRef.current?.contains(root.activeElement));
        onDismiss(hadFocus);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            handleDismiss();
        }
    };

    return (
        <section
            ref={hintRef}
            id={id}
            aria-labelledby={titleId}
            onKeyDown={handleKeyDown}
            className={cx(
                'fixed bottom-20 left-1/2 z-[51] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 rounded-xl border bg-popover p-4 text-popover-foreground',
                'animate-in fade-in slide-in-from-bottom-2',
                floatingShadowClassName
            )}>
            <Stack spacing={2} className="max-h-[calc(100dvh-8rem)] overflow-y-auto">
                <Row spacing={1} justifyContent="space-between" alignItems="start">
                    <Typography id={titleId} component="h2" level="body1" semiBold className="text-foreground">
                        Try uier on this page
                    </Typography>
                    <IconButton
                        size="xs"
                        variant="plain"
                        title="Dismiss"
                        aria-label="Dismiss"
                        className="-mr-1 -mt-0.5 shrink-0"
                        onClick={handleDismiss}>
                        <Close />
                    </IconButton>
                </Row>
                <Typography level="body2" className="text-secondary-foreground">
                    uier is a feedback toolbar for websites: visitors and teammates comment right on the
                    page, pinned to an element or to selected text.
                </Typography>
                <Typography level="body2" className="text-foreground">
                    {coarsePointer ? 'Tap' : 'Click'} the + button, or select text, to leave feedback.
                    {' '}{privateAppFeedback ? 'Feedback is private to its author and the uier team.' : access === 'invited' ? 'Only invited people can see and leave comments. Some comments may be private.' : access === 'guests' ? 'Anyone with the review link can see and leave comments. Some comments may be private.' : 'Anyone can see and reply to comments. Visitor threads are deleted after 90 days. Starter threads and their replies stay.'}
                </Typography>
                <Typography level="body2" className="text-foreground">
                    Pin a comment to an element, or comment on selected text. Use Send feedback for the whole page. Find threads in the inbox.
                </Typography>
                {brief && <div>
                    <Typography component="h3" level="body2" semiBold>Review brief</Typography>
                    <p className="m-0 whitespace-pre-wrap break-words text-sm text-foreground">{brief}</p>
                </div>}
                <Row justifyContent="end">
                    <Button variant="solid" size="sm" onClick={handleDismiss}>
                        Got it
                    </Button>
                </Row>
            </Stack>
            {/* Points at the + (Add comment) button */}
            {arrowLeft !== undefined && (
                <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 size-3 -translate-x-1/2 rotate-45 border-b border-r bg-popover"
                    style={{ left: arrowLeft }} />
            )}
        </section>
    );
}
