'use client';

import { useContext, useRef, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Stack } from '@signalco/ui-primitives/Stack';
import { cx } from '@signalco/ui-primitives/cx';
import { Mail, MoreHorizontal } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { floatingShadowClassName } from './@types/Comments';

/**
 * Thread options, the last of its header's icon actions (the app's More actions menu): Mark as
 * unread once it is read. A popover, like `CommentThreadItemMenu` (a message's More options), so it
 * renders inside the toolbar's shadow root.
 */
export function CommentThreadMenu({ className, disabled, onMarkUnread }: { className?: string; disabled?: boolean; onMarkUnread: () => void }) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);
    const unreadRef = useRef<HTMLButtonElement>(null);

    // Radix props passed through the Popper to the popover content
    const contentProps = {
        onOpenAutoFocus: (event: Event) => {
            event.preventDefault();
            unreadRef.current?.focus();
        }
    };

    return (
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={setOpen}
            align="end"
            aria-label="Thread options"
            className={cx('z-[70] w-auto min-w-32 max-w-64 rounded-xl p-1', floatingShadowClassName)}
            trigger={(
                <IconButton
                    size="xs"
                    variant="plain"
                    className={className}
                    title="Thread options"
                    aria-label="Thread options"
                    disabled={disabled}>
                    <MoreHorizontal size={16} />
                </IconButton>
            )}
            {...contentProps}>
            <Stack>
                <Button ref={unreadRef} variant="plain" size="sm" fullWidth className="justify-start"
                    startDecorator={<Mail size={16} />}
                    onClick={() => { setOpen(false); onMarkUnread(); }}>
                    Mark as unread
                </Button>
            </Stack>
        </Popper>
    );
}
