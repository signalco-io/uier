'use client';

import { useContext, useRef, useState, type Ref } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { cx } from '@signalco/ui-primitives/cx';
import { Delete, MoreHorizontal } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { destructiveTextClassName, floatingShadowClassName } from './@types/Comments';

type CommentThreadItemMenuProps = {
    /** The comment (its first item) or one reply */
    kind: 'comment' | 'reply';
    /** Whether the reviewer wrote it (an admin of a project can delete others' items too) */
    own?: boolean;
    /** The confirmation question, saying what deleting does (e.g. "Delete this comment and your 2 replies?") */
    confirmText: string;
    disabled?: boolean;
    onDelete?: () => void;
    onEdit?: () => void;
    /** Pick the thread's element or text again (the first message of a thread on its own page) */
    onReattach?: () => void;
    triggerRef?: Ref<HTMLButtonElement>;
};

/**
 * Options of a thread item. A popover (instead of the UI kit's dropdown menu, which always
 * portals into the page's body) so it renders inside the toolbar's shadow root.
 * Deleting asks first, with `confirmText`: it can take the visitor's replies or the whole thread with it.
 */
export function CommentThreadItemMenu({ kind, own = true, confirmText, disabled, onDelete, onEdit, onReattach, triggerRef }: CommentThreadItemMenuProps) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const deleteRef = useRef<HTMLButtonElement>(null);
    const editRef = useRef<HTMLButtonElement>(null);
    const reattachRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) {
            setConfirming(false);
        }
    };

    const handleAskDelete = () => {
        setConfirming(true);
        // After the confirmation renders
        window.setTimeout(() => confirmRef.current?.focus(), 0);
    };

    const handleDelete = () => {
        handleOpenChange(false);
        onDelete?.();
    };

    // Radix props passed through the Popper to the popover content
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            (editRef.current ?? reattachRef.current ?? deleteRef.current)?.focus();
        }
    };

    return (
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={handleOpenChange}
            align="end"
            aria-label={kind === 'comment' ? 'Comment options' : 'Reply options'}
            className={cx('z-[70] w-auto min-w-32 max-w-64 rounded-xl p-1', floatingShadowClassName)}
            trigger={(
                <IconButton
                    ref={triggerRef}
                    size="xs"
                    variant="plain"
                    className="size-6 text-muted-foreground hover:text-foreground"
                    title="More options"
                    aria-label={`More options for ${own ? 'your' : 'this'} ${kind}`}
                    disabled={disabled}>
                    <MoreHorizontal size={16} />
                </IconButton>
            )}
            {...contentProps}>
            {confirming ? (
                <Stack spacing={1} className="p-2">
                    <p className="m-0 text-sm text-foreground">{confirmText}</p>
                    <Row spacing={1} justifyContent="end">
                        <Button variant="plain" size="sm" onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            ref={confirmRef}
                            variant="outlined"
                            size="sm"
                            className={destructiveTextClassName}
                            onClick={handleDelete}>
                            Delete
                        </Button>
                    </Row>
                </Stack>
            ) : (
                <Stack>
                    {onEdit && (
                        <Button ref={editRef} variant="plain" size="sm" fullWidth className="justify-start"
                            onClick={() => { handleOpenChange(false); onEdit(); }}>
                            Edit
                        </Button>
                    )}
                    {onReattach && (
                        <Button ref={reattachRef} variant="plain" size="sm" fullWidth className="justify-start"
                            onClick={() => { handleOpenChange(false); onReattach(); }}>
                            Reattach comment
                        </Button>
                    )}
                    {onDelete && (
                        <Button
                            ref={deleteRef}
                            variant="plain"
                            size="sm"
                            fullWidth
                            className={cx('justify-start', destructiveTextClassName)}
                            startDecorator={<Delete size={16} />}
                            onClick={handleAskDelete}>
                            Delete...
                        </Button>
                    )}
                </Stack>
            )}
        </Popper>
    );
}
