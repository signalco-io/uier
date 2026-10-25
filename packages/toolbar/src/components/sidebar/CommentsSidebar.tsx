import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Divider } from '@signalco/ui-primitives/Divider';
import { useActivitySummary } from '../../hooks/useComments';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Button } from '@signalco/ui-primitives/Button';
import { useProjectViewer } from '../../project/ProjectGate';
import { Search } from '@signalco/ui-icons';
import { CommentsSidebarHeader } from './CommentsSidebarHeader';
import { CommentsSidebarCommentsList } from './CommentsSidebarCommentsList';
import type { CommentsFilter } from './CommentsFilter';
import { InkScope } from '../InkScope';
import { DockablePanel } from '../DockablePanel';

// One element for every render: the kit's input wraps itself anew (and loses the focus) when its
// decorator changes
const searchIcon = <Search size={16} aria-hidden="true" className="ml-3 shrink-0 text-muted-foreground" />;

export type CommentsSidebarProps = {
    /**
     * The status and search. Kept while the inbox is closed (see CommentsGlobal), so it opens
     * again as it was; a link to a done comment opens it on "Done".
     */
    filter: CommentsFilter;
    onFilterChange: (filter: CommentsFilter) => void;
    onClose: () => void;
    /** Closes the inbox and opens the thread on its pin */
    onShowOnPage: (commentId: string) => void;
};

/**
 * The inbox: the comments of this page and of the site's other pages, searched and filtered by
 * status
 */
export function CommentsSidebar({ filter, onFilterChange: setFilter, onClose, onShowOnPage }: CommentsSidebarProps) {
    const { isMember } = useProjectViewer();
    const { data: activity } = useActivitySummary();
    const unread = activity?.unread ?? 0;
    const [hidding, setHidding] = useState<boolean>(false);

    const handleClose = () => {
        setHidding(true);
        setTimeout(() => {
            onClose();
        }, 150);
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            handleClose();
        }
    };

    // Escape in a search with text clears it (and the inbox stays open); in an empty one it closes the inbox
    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && filter.keywords) {
            e.stopPropagation();
            e.preventDefault();
            setFilter({ ...filter, keywords: '' });
        }
    };

    return (
        <InkScope>
            <DockablePanel id="inbox" label="Comments" onKeyDown={handleKeyDown}
                className={cx('transition-opacity', hidding ? 'animate-out fade-out' : 'animate-in fade-in')}>
                <Stack className="h-full">
                    <Stack spacing={1.5} className="px-4 py-3">
                        <CommentsSidebarHeader
                            counts={{ unresolved: activity?.open ?? 0, resolved: activity?.done ?? 0, all: activity?.total ?? 0 }}
                            status={filter.status}
                            onStatusChange={(status) => setFilter({ ...filter, status })}
                            onClose={handleClose} />
                        {/* With a decorator the kit's focus ring is on the box, which never has the focus itself */}
                        <Input
                            type="search"
                            aria-label="Search comments"
                            placeholder="Search comments"
                            autoComplete="off"
                            fullWidth
                            startDecorator={searchIcon}
                            className="focus-within:ring-2 focus-within:ring-ring"
                            value={filter.keywords ?? ''}
                            onChange={(e) => setFilter({ ...filter, keywords: e.target.value })}
                            onKeyDown={handleSearchKeyDown} />
                        {isMember && <Button size="sm" variant="plain" className="min-h-11" aria-pressed={Boolean(filter.assignedToMe)} onClick={() => setFilter({ ...filter, assignedToMe: !filter.assignedToMe })}>Assigned to me</Button>}
                        <Button size="sm" variant="plain" aria-pressed={Boolean(filter.unread)}
                            className="self-start text-[hsl(var(--brand-accent-text))] pointer-coarse:min-h-11"
                            onClick={() => setFilter({ ...filter, unread: !filter.unread, status: 'all' })}>
                            Unread {unread}
                        </Button>
                    </Stack>
                    <Divider />
                    {/* Focusable so the list can be scrolled with the keyboard */}
                    <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <CommentsSidebarCommentsList filter={filter} onShowOnPage={onShowOnPage} />
                    </div>
                </Stack>
            </DockablePanel>
        </InkScope>
    );
}
