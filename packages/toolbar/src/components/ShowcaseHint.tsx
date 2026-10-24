'use client';

import React, { useId, useRef } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Close } from '@signalco/ui-icons';

const hintDismissedStorageKey = 'uier:showcase-hint-dismissed';

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
    /** `hadFocus` is set when the keyboard focus was inside the hint */
    onDismiss: (hadFocus: boolean) => void;
};

/** First-run hint shown above the toolbar pill in showcase mode */
export function ShowcaseHint({ onDismiss }: ShowcaseHintProps) {
    const titleId = useId();
    const hintRef = useRef<HTMLElement>(null);

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
            aria-labelledby={titleId}
            onKeyDown={handleKeyDown}
            className="fixed bottom-20 left-1/2 z-[51] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2">
            <Stack spacing={2}>
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
                    Click the comment button or select text to leave feedback. Comments are public.
                </Typography>
                <Row justifyContent="end">
                    <Button variant="solid" size="sm" onClick={handleDismiss}>
                        Got it
                    </Button>
                </Row>
            </Stack>
            {/* Points at the toolbar pill */}
            <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r bg-popover" />
        </section>
    );
}
