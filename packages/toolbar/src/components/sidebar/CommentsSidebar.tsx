import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { Stack } from '@signalco/ui-primitives/Stack';
import { useActivitySummary } from '../../hooks/useComments';
import { cx } from '@signalco/ui-primitives/cx';
import { useProjectViewer } from '../../project/ProjectGate';
import { CommentsSidebarHeader, CommentsStatusTabs, FilterChip } from './CommentsSidebarHeader';
import { CommentsSidebarCommentsList } from './CommentsSidebarCommentsList';
import { LocationPicker } from './LocationPicker';
import { useInboxComments } from './useInboxComments';
import type { CommentsFilter } from './CommentsFilter';
import { InkScope } from '../InkScope';
import { DockablePanel, panelEnter, panelExit, usePanelSlidesIn } from '../DockablePanel';
import { MarkAllRead } from './MarkAllRead';
import { InboxSearch } from './InboxSearch';
import { RestoredPanelContext } from '../../openPanel';
import { useMessages } from '../../i18n';
import { InboxDrafts, type InboxDraft } from './InboxDrafts';
import { inboxAppLink } from './inboxAppLink';
import { toolbarConfig } from '../../config';

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
    /** This page's unsent comments, listed above its threads (`InboxDrafts`) */
    pageDrafts?: InboxDraft[];
    onResumeDraft?: (draftKey: string) => void;
    onSendDraft?: (draftKey: string) => void;
    onDiscardDraft?: (draftKey: string) => void;
    /** A shortcut asked for the inbox (G then I) or its search (`/`): the focus goes there, each time `key` changes */
    focusRequest?: { target: 'inbox' | 'search'; key: number };
};

/**
 * The inbox: the search behind an icon in the title row (it applies whatever else is chosen), where the comments are from
 * (the environment, then this page by default, all pages, a section or another page) with the
 * unread and assigned filters, then the status tabs right above the comments.
 */
export function CommentsSidebar({ filter, onFilterChange: setFilter, onClose, onShowOnPage, pageDrafts = [], onResumeDraft, onSendDraft, onDiscardDraft, focusRequest }: CommentsSidebarProps) {
    const t = useMessages();
    const { verificationEnabled, isMember, environment, environmentOptions, setEnvironment } = useProjectViewer();
    const { data: activity } = useActivitySummary();
    const unread = activity?.unread ?? 0;
    const inbox = useInboxComments(filter);
    const archiveUnreadId = useId();
    const [hidding, setHidding] = useState<boolean>(false);
    // Open on the previous page: it stays without sliding in or taking the focus
    const restored = useContext(RestoredPanelContext).includes('inbox');
    const slidesIn = usePanelSlidesIn('inbox');
    const contentRef = useRef<HTMLDivElement>(null);
    // The search popover; `/` opens it
    const [searchOpen, setSearchOpen] = useState(focusRequest?.target === 'search');
    useEffect(() => {
        if (!focusRequest) return;
        const content = contentRef.current;
        const active = (content?.getRootNode() as ShadowRoot | Document | undefined)?.activeElement;
        // The inbox: Close, as when it opens, unless the focus is in it already
        if (focusRequest.target === 'inbox' && active && content?.contains(active)) return;
        if (focusRequest.target === 'search') {
            // The search's popover focuses its field and selects its text as it opens
            const field = content?.querySelector<HTMLInputElement>('input[type="search"]');
            if (!field) setSearchOpen(true);
            field?.focus();
            field?.select();
            return;
        }
        content?.querySelector<HTMLElement>('button[data-uier-close-inbox]')?.focus();
    }, [focusRequest?.key]);

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
            {/* Slides in from (and out to) the side it is docked on; only fades with reduced motion */}
            <DockablePanel id="inbox" label={t.inbox.label} onKeyDown={handleKeyDown}
                className={cx(hidding ? panelExit : !restored && slidesIn && panelEnter)}>
                <Stack ref={contentRef} tabIndex={0} data-uier-inbox-scroll="" className="h-full overflow-y-auto rounded-b-2xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <Stack spacing={2} className="shrink-0 px-4 pt-3">
                        <CommentsSidebarHeader onClose={handleClose} autoFocus={!restored}
                            // The same comments in the uier app, for members (only they can open the project there)
                            appLink={isMember && toolbarConfig.project
                                ? inboxAppLink({ apiUrl: toolbarConfig.apiUrl, project: toolbarConfig.project, filter, scope: inbox.scope, currentPath: inbox.currentPath, environment })
                                : undefined}
                            search={<InboxSearch value={filter.keywords ?? ''} onChange={keywords => setFilter({ ...filter, keywords })}
                                open={searchOpen} onOpenChange={setSearchOpen} />} />
                        {/* The search and filters are one group, closer together than the title and the tabs */}
                        <Stack spacing={1}>
                        <LocationPicker
                            value={inbox.scope}
                            pages={inbox.pages}
                            currentPath={inbox.currentPath}
                            currentCount={inbox.currentCount}
                            otherCount={inbox.otherCount}
                            loaded={inbox.locationsLoaded}
                            environment={setEnvironment && { value: environment, options: environmentOptions ?? [], onChange: setEnvironment }}
                            onChange={(page) => setFilter({ ...filter, page })} />
                        {/* Unread threads can be done ones and on any page (the pill counts the whole site): "N unread"
                            shows every status, and turning it on every page. Then Mark all as read, as in the app */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {isMember && (
                                <FilterChip pressed={Boolean(filter.assignedToMe)} onClick={() => setFilter({ ...filter, assignedToMe: !filter.assignedToMe })}>
                                    {t.inbox.assignedToMe}
                                </FilterChip>
                            )}
                            <span id={archiveUnreadId} hidden>{t.inbox.hasUnread}</span>
                            <FilterChip pressed={Boolean(filter.archived)} describedBy={inbox.archiveUnread ? archiveUnreadId : undefined}
                                onClick={() => setFilter({ ...filter, archived: !filter.archived, status: filter.archived ? 'unresolved' : 'all' })}>
                                {t.inbox.filters.archived}{inbox.archiveCount !== undefined && <span className="tabular-nums text-muted-foreground">{inbox.archiveCount}</span>}
                                {inbox.archiveUnread && <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-accent))]" />}
                            </FilterChip>
                            <MarkAllRead comments={inbox.state.error ? [] : inbox.comments ?? []}
                                loading={inbox.state.isPending}
                                unreadTotal={unread}
                                filtering={Boolean(filter.unread)}
                                narrowed={Boolean(filter.keywords?.trim() || filter.assignedToMe)}
                                onFilterChange={on => setFilter({ ...filter, unread: on, status: 'all', ...(on ? { page: 'all' as const } : {}) })} />
                        </div>
                        </Stack>
                        <CommentsStatusTabs
                            counts={inbox.counts}
                            countsLoaded={inbox.countsLoaded}
                            unread={inbox.unread}
                            status={verificationEnabled !== true && filter.status === 'ready' ? filter.archived ? 'all' : 'unresolved' : filter.status}
                            onStatusChange={(status) => setFilter({ ...filter, status })} />
                    </Stack>
                    {/* Filters and comments share a scroll area, including short keyboard/orientation viewports. */}
                    <div className="shrink-0 p-3">
                        {/* This page's drafts first, while it is listed with what is not done yet; they are not threads, so
                            the unread and assigned filters leave them out */}
                        {inbox.listsThisPage && !filter.archived && !filter.unread && !filter.assignedToMe && (filter.status === 'unresolved' || filter.status === 'all')
                            && onResumeDraft && onSendDraft && onDiscardDraft && (
                            <div className="mb-4 empty:hidden">
                                <InboxDrafts drafts={pageDrafts} keywords={filter.keywords} onResume={onResumeDraft} onSend={onSendDraft} onDiscard={onDiscardDraft} />
                            </div>
                        )}
                        <CommentsSidebarCommentsList
                            inbox={inbox}
                            filter={filter}
                            scrollRef={contentRef}
                            onShowOnPage={onShowOnPage}
                            onShowAllPages={() => setFilter({ ...filter, page: 'all' })} />
                    </div>
                </Stack>
            </DockablePanel>
        </InkScope>
    );
}

