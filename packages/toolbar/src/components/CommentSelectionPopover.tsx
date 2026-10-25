'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';
import { orderBy } from '@signalco/js';
import { useResizeObserver } from '@enterwell/react-hooks';
import { popoverWidth, popoverWindowMargin } from './@types/Comments';
import { CommentIcon } from './CommentIcon';
import { InkScope } from './InkScope';
import { RewriteIcon } from './RewriteIcon';

type CommentSelectionPopoverProps = {
    rects: DOMRect[];
    /** Add comment: a comment about the selected text */
    onCreate: () => void;
    /** Rewrite: suggested text to replace the selected text */
    onRewrite: () => void;
};

/**
 * The toolbar for selected page text, ink and the size of the toolbar pill (BRAND.md, "The review layer"): below the selection, or above it near the window's bottom.
 * One Tab stop, like any toolbar: Left and Right arrows (Home, End) move between its buttons.
 */
export function CommentSelectionPopover({ rects, onCreate, onRewrite }: CommentSelectionPopoverProps) {
    const [popoverHeight, setPopoverHeight] = useState(0);
    const resizeObserverRef = useResizeObserver((_, entry) => {
        setPopoverHeight(entry.contentRect.height);
    });
    const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const actions = [
        { label: 'Add comment', icon: <CommentIcon icon="add" size={20} variant="outlined" aria-hidden="true" />, onClick: onCreate },
        { label: 'Rewrite', icon: <RewriteIcon size={20} aria-hidden="true" />, onClick: onRewrite }
    ];

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const last = actions.length - 1;
        const targets: Partial<Record<string, number>> = {
            ArrowRight: activeIndex === last ? 0 : activeIndex + 1,
            ArrowLeft: activeIndex === 0 ? last : activeIndex - 1,
            Home: 0,
            End: last
        };
        const next = targets[event.key];
        if (next === undefined) {
            return;
        }
        event.preventDefault();
        setActiveIndex(next);
        buttonsRef.current[next]?.focus();
    };

    // Calculate position of comment popover
    const lastRangeRect = orderBy(rects, rr => rr.bottom).at(-1);
    const { bottom, top, right } = lastRangeRect ?? { bottom: 0, top: 0, right: 0 };
    const leftFixed = Math.min(window.innerWidth - popoverWidth / 2 - popoverWindowMargin, Math.max(popoverWidth / 2 + popoverWindowMargin, right ?? 0));
    const topFixed = (bottom ?? 0) + popoverHeight + 20 + popoverWindowMargin > window.innerHeight
        ? window.scrollY + (top ?? 0) - popoverHeight - 40
        : window.scrollY + (bottom ?? 0) + 20;

    return (
        <InkScope>
            <div
                ref={resizeObserverRef}
                role="toolbar"
                aria-label="Selected text"
                aria-orientation="horizontal"
                onKeyDown={handleKeyDown}
                className="absolute z-[52] -translate-x-1/2 rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
                style={{ left: leftFixed, top: topFixed }}>
                <Row>
                    {actions.map((action, index) => (
                        <Button
                            key={action.label}
                            ref={(element: HTMLButtonElement | null) => {
                                buttonsRef.current[index] = element;
                            }}
                            variant="plain"
                            size="sm"
                            className="gap-1.5 rounded-full pl-2.5"
                            tabIndex={index === activeIndex ? 0 : -1}
                            onFocus={() => setActiveIndex(index)}
                            // Keep the page selection intact until its action has consumed it.
                            onPointerDown={event => event.preventDefault()}
                            onClick={action.onClick}
                            startDecorator={action.icon}>
                            {action.label}
                        </Button>
                    ))}
                </Row>
            </div>
        </InkScope>
    );
}
