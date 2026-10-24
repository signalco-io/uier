import React, { useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Divider } from '@signalco/ui-primitives/Divider';
import { cx } from '@signalco/ui-primitives/cx';
import { Collapse } from '@signalco/ui-primitives/Collapse';
import { CommentsSidebarHeader } from './CommentsSidebarHeader';
import { CommentsSidebarFilter } from './CommentsSidebarFilter';
import { CommentsSidebarCommentsList } from './CommentsSidebarCommentsList';
import { CommentsFilter } from './CommentsFilter';
import { InkScope } from '../InkScope';

export type CommentsSidebarProps = {
    onClose: () => void;
    rootElement?: HTMLElement;
};

export function CommentsSidebar({ onClose, rootElement }: CommentsSidebarProps) {
    const [filterOpen, setFilterOpen] = useState<boolean>(false);
    const [filter, setFilter] = useState<CommentsFilter>();
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
                    <div className="px-4 py-3">
                        <CommentsSidebarHeader
                            filterOpen={filterOpen}
                            status={filter?.status ?? 'unresolved'}
                            onStatusChange={(status) => setFilter({ ...filter, status })}
                            onToggleFilter={() => setFilterOpen(!filterOpen)}
                            onClose={handleClose} />
                    </div>
                    {/* Mounted only when open: the collapsed filter still exposes its (unlabelled) inputs */}
                    {filterOpen && (
                        <Collapse appear={filterOpen}>
                            <Divider />
                            <div className="p-3">
                                <CommentsSidebarFilter
                                    filter={filter}
                                    onFilterChange={setFilter}
                                    rootElement={rootElement} />
                            </div>
                        </Collapse>
                    )}
                    <Divider />
                    {/* Focusable so the list can be scrolled with the keyboard */}
                    <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto rounded-b-2xl p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <CommentsSidebarCommentsList status={filter?.status ?? 'unresolved'} />
                    </div>
                </Stack>
            </aside>
        </InkScope>
    );
}
