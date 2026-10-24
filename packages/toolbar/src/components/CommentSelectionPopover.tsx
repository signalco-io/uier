'use client';

import React, { useRef, useState } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { Button } from '@signalco/ui-primitives/Button';
import { Row } from '@signalco/ui-primitives/Row';
import { Comment, Replace } from '@signalco/ui-icons';
import { orderBy } from '@signalco/js';
import { useResizeObserver } from '@enterwell/react-hooks';
import { floatingShadowClassName, popoverWidth, popoverWindowMargin } from './@types/Comments';

type CommentSelectionPopoverProps = {
    rects: DOMRect[];
    /** Add comment: a comment about the selected text */
    onCreate: () => void;
    /** Rewrite: suggested text to replace the selected text */
    onRewrite: () => void;
};

/**
 * The toolbar for selected page text: below the selection, or above it near the window's bottom.
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
        { label: 'Add comment', icon: <Comment />, onClick: onCreate },
        { label: 'Rewrite', icon: <Replace />, onClick: onRewrite }
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
        <div
            ref={resizeObserverRef}
            role="toolbar"
            aria-label="Selected text"
            aria-orientation="horizontal"
            onKeyDown={handleKeyDown}
            className={cx(
                'absolute z-[52] bg-card border rounded-full p-1 -translate-x-1/2', floatingShadowClassName
            )}
            style={{ left: leftFixed, top: topFixed }}>
            <Row spacing={0.5}>
                {actions.map((action, index) => (
                    <Button
                        key={action.label}
                        ref={(element: HTMLButtonElement | null) => {
                            buttonsRef.current[index] = element;
                        }}
                        variant="plain"
                        className="gap-2 rounded-full"
                        tabIndex={index === activeIndex ? 0 : -1}
                        onFocus={() => setActiveIndex(index)}
                        onClick={action.onClick}
                        startDecorator={action.icon}>
                        {action.label}
                    </Button>
                ))}
            </Row>
        </div>
    );
}
