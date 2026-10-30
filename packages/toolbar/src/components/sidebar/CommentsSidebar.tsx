import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { useActivitySummary } from '../../hooks/useComments';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { useProjectViewer } from '../../project/ProjectGate';
import { Search } from '@signalco/ui-icons';
import { CommentsSidebarHeader, CommentsStatusTabs, FilterChip } from './CommentsSidebarHeader';
import { CommentsSidebarCommentsList } from './CommentsSidebarCommentsList';
import { LocationPicker } from './LocationPicker';
import { useInboxComments } from './useInboxComments';
import type { CommentsFilter } from './CommentsFilter';
import { InkScope } from '../InkScope';
import { DockablePanel } from '../DockablePanel';
import { MarkAllRead } from './MarkAllRead';

// One element for every render: the kit's input wraps itself anew (and loses the focus) when its
// decorator changes
const searchIcon = <Search size={16} aria-hidden="true" className="ml-3 shrink-0 text-muted-foreground" />;

export type CommentsSidebarProps = {
    /**
     * The pages, status, search and the unread / assigned filters. Kept while the inbox is closed
     * (see CommentsGlobal), so it opens again as it was; a link to a done comment opens it on "Done".
     */
    filter: CommentsFilter;
    onFilterChange: (filter: CommentsFilter) => void;
    onClose: () => void;
    /** Closes the inbox and opens the thread on its pin */
    onShowOnPage: (commentId: string) => void;
};

/**
 * The inbox: the search on top (it applies whatever else is chosen), where the comments are from
 * (the environment, then this page by default, all pages, a section or another page) with the
 * unread and assigned filters, then the status tabs right above the comments.
 */
export function CommentsSidebar({ filter, onFilterChange: setFilter, onClose, onShowOnPage }: CommentsSidebarProps) {
    const { isMember, environment, environmentOptions, setEnvironment, environmentLabel } = useProjectViewer();
    const { data: activity } = useActivitySummary();
    const unread = activity?.unread ?? 0;
    const inbox = useInboxComments(filter);
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
            {/* Slides in from (and out to) the side it is docked on; only fades with reduced motion */}
            <DockablePanel id="inbox" label="Comments" onKeyDown={handleKeyDown}
                className={cx(hidding
                    ? 'animate-out fade-out fill-mode-forwards duration-150 ease-in motion-safe:data-[side=left]:slide-out-to-left motion-safe:data-[side=right]:slide-out-to-right'
                    : 'animate-in fade-in duration-200 ease-out motion-safe:data-[side=left]:slide-in-from-left motion-safe:data-[side=right]:slide-in-from-right')}>
                <Stack tabIndex={0} className="h-full overflow-y-auto rounded-b-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <Stack spacing={2} className="shrink-0 px-4 pt-3">
                        <CommentsSidebarHeader onClose={handleClose} />
                        {/* The search and filters are one group, closer together than the title and the tabs */}
                        <Stack spacing={1}>
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
                        {setEnvironment && <p className="m-0 text-xs text-muted-foreground">Reviewing {environmentLabel ?? window.location.origin}. New feedback stays here.</p>}
                        <div className="flex flex-wrap items-center gap-2">
                            <LocationPicker
                                value={inbox.scope}
                                pages={inbox.pages}
                                currentPath={inbox.currentPath}
                                currentCount={inbox.currentCount}
                                otherCount={inbox.otherCount}
                                environment={setEnvironment && { value: environment, options: environmentOptions ?? [], onChange: setEnvironment }}
                                onChange={(page) => setFilter({ ...filter, page })} />
                            {/* Unread threads can be done ones and on any page (the pill counts the whole
                                site): the filter shows every status, and turning it on every page */}
                            <FilterChip pressed={Boolean(filter.unread)} onClick={() => setFilter({ ...filter, unread: !filter.unread, status: 'all', ...(filter.unread ? {} : { page: 'all' as const }) })}>
                                {unread > 0 && <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />}
                                Unread <span className={cx('tabular-nums', unread > 0 ? 'text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>{unread}</span>
                            </FilterChip>
                            <MarkAllRead comments={inbox.state.error ? [] : inbox.comments ?? []} />
                            {isMember && (
                                <FilterChip pressed={Boolean(filter.assignedToMe)} onClick={() => setFilter({ ...filter, assignedToMe: !filter.assignedToMe })}>
                                    Assigned to me
                                </FilterChip>
                            )}
                        </div>
                        </Stack>
                        <CommentsStatusTabs
                            counts={inbox.counts}
                            status={filter.status}
                            onStatusChange={(status) => setFilter({ ...filter, status })} />
                    </Stack>
                    {/* Filters and comments share a scroll area, including short keyboard/orientation viewports. */}
                    <div className="shrink-0 p-3">
                        <CommentsSidebarCommentsList
                            inbox={inbox}
                            filter={filter}
                            onShowOnPage={onShowOnPage}
                            onShowAllPages={() => setFilter({ ...filter, page: 'all' })} />
                    </div>
                </Stack>
            </DockablePanel>
        </InkScope>
    );
}

