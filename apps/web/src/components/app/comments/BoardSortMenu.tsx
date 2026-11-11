'use client';

import { ArrowUpDownIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { boardSortOptions, defaultBoardSort, type BoardColumn, type BoardSort } from '@/src/lib/app/boardSort';
import { commentStatusLabels } from './CommentStatus';

export const boardSortLabels: Record<BoardSort, string> = {
    priority: 'Priority',
    newest: 'Newest first',
    oldest: 'Oldest first',
    updated: 'Recently updated',
    completed: 'Recently completed',
    archived: 'Recently archived'
};

/** The trigger's word for a column that is not in its usual order, so everyone sees the board's order */
const shortLabels: Record<BoardSort, string> = {
    priority: 'Priority',
    newest: 'Newest',
    oldest: 'Oldest',
    updated: 'Updated',
    completed: 'Completed',
    archived: 'Archived'
};

/**
 * A board column's sort, at the right end of its header: the choices the column offers (`boardSortOptions`), one
 * at a time. It is the project's (saved for everyone who opens the board), so a column in another order than
 * its default says which beside the icon. Only for the people who may change it.
 */
export function BoardSortMenu({ status, sort, onChange, className }: {
    status: BoardColumn;
    sort: BoardSort;
    onChange: (sort: BoardSort) => void;
    /** Beside another header button (Archive's Collapse): its spacing */
    className?: string;
}) {
    const column = status === 'archive' ? 'Archive' : commentStatusLabels[status];
    const usual = sort === defaultBoardSort(status);
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger render={(
                    <DropdownMenuTrigger render={(
                        // Takes no more height than the column's name; 44 px to tap on a touch screen
                        <Button variant="ghost" size={usual ? 'icon-xs' : 'xs'} aria-label={`Sort ${column}: ${boardSortLabels[sort]}`} data-board-sort={status}
                            className={cn('relative -my-1 -mr-1.5 ml-auto font-normal text-muted-foreground hover:text-foreground',
                                'after:absolute after:-inset-2.5 pointer-fine:after:hidden', className)} />
                    )} />
                )}>
                    <ArrowUpDownIcon />
                    {!usual && shortLabels[sort]}
                </TooltipTrigger>
                <TooltipContent side="bottom">{`Sort ${column}`}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuRadioGroup value={sort} onValueChange={(next: BoardSort) => { if (next !== sort) onChange(next); }}>
                    <DropdownMenuLabel>{`Sort ${column}`}</DropdownMenuLabel>
                    {boardSortOptions(status).map(option => (
                        <DropdownMenuRadioItem key={option} value={option} closeOnClick>{boardSortLabels[option]}</DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
