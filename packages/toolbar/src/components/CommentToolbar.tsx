'use client';

import React, { Ref } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Inbox, Info, Menu } from '@signalco/ui-icons';
import type { ToolbarMode } from '../config';
import { CommentIcon } from './CommentIcon';
import { InkScope } from './InkScope';
import { commentsListMaxLength } from './@types/Comments';

type CommentToolbarProps = {
    mode: ToolbarMode;
    creatingPointComment: boolean;
    /** Number of unresolved comments on this page */
    commentsCount?: number;
    /** Whether the API returned a full list (there may be more comments than `commentsCount`) */
    commentsCountCapped?: boolean;
    hintOpen?: boolean;
    /** `id` of the first-run hint, while it is open */
    hintId?: string;
    addButtonRef?: Ref<HTMLButtonElement>;
    inboxButtonRef?: Ref<HTMLButtonElement>;
    hintButtonRef?: Ref<HTMLButtonElement>;
    /** `fromKeyboard` is set when the button was activated with the keyboard (Enter or Space) */
    onAddPointComment: (fromKeyboard: boolean) => void;
    onShowSidebar: () => void;
    onToggleHint?: () => void;
    onExitReview: () => void;
};

function isCoarsePointer() {
    return window.matchMedia('(pointer: coarse)').matches;
}

function countText(count: number, capped: boolean) {
    return capped ? `${count}+` : String(count);
}

export function CommentToolbar({
    mode, creatingPointComment, commentsCount = 0, commentsCountCapped = false, hintOpen, hintId,
    addButtonRef, inboxButtonRef, hintButtonRef, onAddPointComment, onShowSidebar, onToggleHint, onExitReview
}: CommentToolbarProps) {
    const capped = commentsCountCapped || commentsCount >= commentsListMaxLength;
    const badgeText = commentsCount > 99 && !capped ? '99+' : countText(commentsCount, capped);

    // `detail` is 0 for clicks synthesized from Enter or Space
    const handleAddClick = (event: React.MouseEvent) => onAddPointComment(event.detail === 0);

    return (
        <InkScope>
            {/* Always rendered, so screen readers announce the instruction when point mode starts */}
            <div
                role="status"
                className="pointer-events-none fixed bottom-[4.5rem] left-1/2 z-[51] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
                {creatingPointComment && (
                    <p className="m-0 rounded-full border bg-background px-3 py-1.5 text-center text-sm text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                        {isCoarsePointer()
                            ? 'Tap anywhere to pin a comment. Tap + to cancel.'
                            : 'Click anywhere to pin a comment. Esc to cancel.'}
                    </p>
                )}
            </div>
            <nav
                aria-label="uier feedback"
                className="fixed bottom-4 left-1/2 z-[51] -translate-x-1/2">
                <div
                    role="group"
                    aria-label="uier feedback toolbar"
                    className="rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                    <Row>
                        <IconButton
                            ref={addButtonRef}
                            title="Add comment"
                            aria-label="Add comment"
                            aria-pressed={creatingPointComment}
                            // Pressed: white on the black pill (21:1), not a faint tint
                            variant={creatingPointComment ? 'solid' : 'plain'}
                            className="rounded-full"
                            onClick={handleAddClick}>
                            <CommentIcon icon="add" size={24} variant="outlined" aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            ref={inboxButtonRef}
                            variant="plain"
                            className="relative rounded-full"
                            onClick={onShowSidebar}
                            title="Inbox"
                            aria-label={commentsCount
                                ? `Inbox, ${countText(commentsCount, capped)} ${commentsCount === 1 && !capped ? 'comment' : 'comments'}`
                                : 'Inbox'}>
                            <Inbox />
                            {Boolean(commentsCount) && (
                                // The unread count is a blue pill (BRAND.md, "The review layer")
                                <span
                                    aria-hidden="true"
                                    className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[hsl(var(--brand-accent))] px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-[hsl(var(--brand-accent-foreground))]">
                                    {badgeText}
                                </span>
                            )}
                        </IconButton>
                        {mode === 'showcase' && (
                            <IconButton
                                ref={hintButtonRef}
                                variant={hintOpen ? 'soft' : 'plain'}
                                className="rounded-full"
                                onClick={onToggleHint}
                                title="About uier"
                                aria-label="About uier"
                                aria-expanded={hintOpen}
                                aria-controls={hintOpen ? hintId : undefined}>
                                <Info />
                            </IconButton>
                        )}
                        {/* TODO Enable when implemented (review mode only) */}
                        {/* <Divider orientation="vertical" flex className="my-2" />
                        <IconButton
                            variant="plain"
                            className="rounded-full"
                            onClick={onExitReview}
                            title="Toolbar menu">
                            <Menu />
                        </IconButton> */}
                    </Row>
                </div>
            </nav>
        </InkScope>
    );
}
