import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Divider } from '@signalco/ui-primitives/Divider';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Search } from '@signalco/ui-icons';
import { CommentsSidebarHeader } from './CommentsSidebarHeader';
import { CommentsSidebarCommentsList } from './CommentsSidebarCommentsList';
import type { CommentsFilter } from './CommentsFilter';
import { InkScope } from '../InkScope';

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
            <aside
                aria-label="Comments"
                onKeyDown={handleKeyDown}
                className={cx(
                    // Leaves room for the toolbar pill (bottom center) where the sidebar would cover it
                    'fixed top-4 bottom-20 lg:bottom-4 right-4 left-4 sm:left-auto sm:w-80 rounded-2xl border bg-background text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition-opacity z-50',
                    'slide-in-from-right-5 fade-in ease-in-out slide-out-to-right-5 fade-out',
                    hidding ? 'animate-out' : 'animate-in',
                )}>
                <Stack className="h-full">
                    <Stack spacing={1.5} className="px-4 py-3">
                        <CommentsSidebarHeader
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
                    </Stack>
                    <Divider />
                    {/* Focusable so the list can be scrolled with the keyboard */}
                    <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <CommentsSidebarCommentsList filter={filter} onShowOnPage={onShowOnPage} />
                    </div>
                </Stack>
            </aside>
        </InkScope>
    );
}
