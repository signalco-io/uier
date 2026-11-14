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
 * For the header over the list with its thread beside it, from the width it is split (`@3xl/comments`): the search with
 * Filter (uier #393) is exactly as wide as the list (`--search-width`, not just at most) and the status tabs start where the thread does, the
 * row's 0.5rem gap and 0.5rem more making the columns' 1rem gap (uier #384). Set on the header around `CommentFilters`
 * (and the loading one, `CommentsLoading`).
 */
export const searchBesideList = '@3xl/comments:[&_[data-search-field]]:flex-none @3xl/comments:[&_[data-search-field]]:w-(--search-width) @3xl/comments:[&_[data-search-field]]:mr-2';

/**
 * List and Board, as icon-only tabs; the tooltip and the accessible name say which. On a touch screen the group, not each
 * tab, takes the 44 px of the search and Filter beside it (its 3 px padding around 38 px tabs; uier #277). A project's
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
