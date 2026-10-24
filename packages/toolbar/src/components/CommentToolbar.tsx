'use client';

import { Ref } from 'react';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Inbox, Info, Menu } from '@signalco/ui-icons';
import type { ToolbarMode } from '../config';
import { CommentIcon } from './CommentIcon';
import { InkScope } from './InkScope';

type CommentToolbarProps = {
    mode: ToolbarMode;
    creatingPointComment: boolean;
    /** Number of unresolved comments on this page */
    commentsCount?: number;
    hintOpen?: boolean;
    hintButtonRef?: Ref<HTMLButtonElement>;
    onAddPointComment: () => void;
    onShowSidebar: () => void;
    onToggleHint?: () => void;
    onExitReview: () => void;
};

export function CommentToolbar({ mode, creatingPointComment, commentsCount, hintOpen, hintButtonRef, onAddPointComment, onShowSidebar, onToggleHint, onExitReview }: CommentToolbarProps) {
    return (
        <InkScope>
            <div
                role="group"
                aria-label="uier feedback toolbar"
                className="fixed bottom-4 left-1/2 z-[51] -translate-x-1/2 rounded-full border bg-background p-1 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
                <Row>
                    <IconButton
                        title="Add comment"
                        aria-label="Add comment"
                        aria-pressed={creatingPointComment}
                        variant={creatingPointComment ? 'soft' : 'plain'}
                        className="rounded-full"
                        onClick={onAddPointComment}>
                        <CommentIcon icon="add" size={24} variant="outlined" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                        variant="plain"
                        className="relative rounded-full"
                        onClick={onShowSidebar}
                        title="Inbox"
                        aria-label={commentsCount ? `Inbox, ${commentsCount} ${commentsCount === 1 ? 'comment' : 'comments'}` : 'Inbox'}>
                        <Inbox />
                        {Boolean(commentsCount) && (
                            <span
                                aria-hidden="true"
                                className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground">
                                {(commentsCount ?? 0) > 99 ? '99+' : commentsCount}
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
                            aria-expanded={hintOpen}>
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
        </InkScope>
    );
}
