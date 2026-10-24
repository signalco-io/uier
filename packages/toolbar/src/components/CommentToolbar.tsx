'use client';

import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Inbox, Menu } from '@signalco/ui-icons';
import { CommentIcon } from './CommentIcon';

type CommentToolbarProps = {
    creatingPointComment: boolean;
    onAddPointComment: () => void;
    onShowSidebar: () => void;
    onExitReview: () => void;
};

export function CommentToolbar({ creatingPointComment, onAddPointComment, onShowSidebar, onExitReview }: CommentToolbarProps) {
    return (
        <div className="fixed bottom-4 left-1/2 z-[51] -translate-x-1/2 rounded-full border border-neutral-800 bg-black p-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
            <Row>
                <IconButton
                    title="Add comment"
                    variant={creatingPointComment ? 'soft' : 'plain'}
                    className="rounded-full"
                    onClick={onAddPointComment}>
                    <CommentIcon icon="add" size={24} variant="outlined" />
                </IconButton>
                <IconButton
                    variant="plain"
                    className="rounded-full"
                    onClick={onShowSidebar}
                    title="Inbox">
                    <Inbox />
                </IconButton>
                {/* TODO Enable when implemented */}
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
    );
}
