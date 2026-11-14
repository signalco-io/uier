'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { KanbanIcon, ListIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import type { CommentsView } from './commentLabels';

/** Tab-like toggles, as `LinkTabs`' segmented filter (the projects list's Active and Done) */
export const segmentedGroup = 'gap-0.5 rounded-lg bg-muted p-[3px]';
export const segmentedItem = 'h-[26px] min-w-[26px] shrink-0 rounded-md px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm pointer-coarse:min-h-11';

/**
 * The search, on the right of the filter row directly left of Filter, Group by and List/Board (uier #403), in the list
 * and the board; on a phone it shares its row with them and takes the room they leave. Where there is no room it gives
 * up its own, down to 6rem (its placeholder then ends in an ellipsis). Shared by `CommentFilters` and the loading
 * header (`CommentsLoading`).
 */
// A set width rather than a flex basis, so the controls' box takes it whatever the search holds (its clear button too)
export const searchInput = 'w-64 min-w-24 shrink max-sm:w-auto max-sm:flex-1 pointer-coarse:min-h-11';
/** The search with Filter, Group by and List/Board after it, at the right end of the row (uier #403); a phone's whole row */
export const filterControls = 'ml-auto flex shrink-[4] items-center gap-2 max-sm:w-full';
/**
 * The list's status tabs' box: first in the row, at the list's left edge (uier #405), scrolling sideways when their words
 * don't fit; on a phone their own line under the row, filling the width (uier #278). Shared with the loading header.
 */
export const statusTabsBox = 'order-last -mx-1 -my-0.5 max-w-[calc(100%+0.5rem)] basis-[calc(100%+0.5rem)] overflow-x-auto px-1 py-0.5 sm:order-none sm:min-w-0 sm:basis-auto';
/** Filter and Group by: icon-only and without an outline (uier #404), named and with a tooltip; 44 px on a touch screen */
export const filterIconButton = 'relative shrink-0 pointer-coarse:size-11';

/**
 * List and Board, as icon-only tabs; the tooltip and the accessible name say which. On a touch screen the group, not each
 * tab, takes the 44 px of the search and Filter (its 3 px padding around 38 px tabs; uier #277). A project's
 * comments (`CommentFilters`) and My work (`MyWorkViews`, through `CommentFilters`' `onView`) keep the choice in the address and remember it.
 */
export function CommentsViewToggle({ view, onChange, className }: { view: CommentsView; onChange: (view: CommentsView) => void; className?: string }) {
    const { t } = useAppI18n();
    return (
        <ToggleGroup size="sm" spacing={0.5} aria-label={t("View")} className={cn(segmentedGroup, 'shrink-0', className)} value={[view]}
            onValueChange={([value]) => {
                if (!value) return;
                onChange(value === 'board' ? 'board' : 'list');
            }}>
            {([['list', t("List"), ListIcon], ['board', t("Board"), KanbanIcon]] as const).map(([value, label, Icon]) => (
                <Tooltip key={value}>
                    <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} className={cn(segmentedItem, 'px-0 pointer-coarse:min-h-[38px] pointer-coarse:min-w-11')} />}>
                        <Icon />
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                </Tooltip>
            ))}
        </ToggleGroup>
    );
}
