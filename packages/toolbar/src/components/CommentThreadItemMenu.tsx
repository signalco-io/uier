'use client';

import { useContext, useState } from 'react';
import { Popper } from '@signalco/ui-primitives/Popper';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Delete, MoreHorizontal } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';

type CommentThreadItemMenuProps = {
    disabled?: boolean;
    onDelete: () => void;
};

/**
 * Options of a thread item. A popover (instead of the UI kit's dropdown menu, which always
 * portals into the page's body) so it renders inside the toolbar's shadow root.
 */
export function CommentThreadItemMenu({ disabled, onDelete }: CommentThreadItemMenuProps) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const [open, setOpen] = useState(false);

    const handleDelete = () => {
        setOpen(false);
        onDelete();
    };

    return (
        <Popper
            container={rootElement}
            open={open}
            onOpenChange={setOpen}
            align="end"
            className="w-auto min-w-32 p-1"
            trigger={(
                <IconButton size="xs" variant="plain" title="More options" aria-label="More options" disabled={disabled}>
                    <MoreHorizontal />
                </IconButton>
            )}>
            <Button
                variant="plain"
                size="sm"
                fullWidth
                className="justify-start text-red-300 hover:text-red-200"
                startDecorator={<Delete size={16} />}
                onClick={handleDelete}>
                Delete
            </Button>
        </Popper>
    );
}
