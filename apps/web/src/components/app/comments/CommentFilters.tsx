'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileIcon, KanbanIcon, ListIcon, UserIcon, XIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/button';
import { Toggle } from '@/src/components/ui/toggle';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { peopleFilterLabels, statusFilterLabels, type AuthorFilter, type CommentsView, type PeopleFilter, type StatusFilter } from './commentLabels';
import type { ReactNode } from 'react';

const allPages = 'all';

/** View (list or board), the list's status and the people and page filters; all kept in the URL */
export function CommentFilters({ unread, unreadCount, view, status, statusCounts, people, page, pages, environment, environments, readAction, author }: {
    author?: AuthorFilter;
    readAction?: ReactNode;
    environment?: string;
    environments: import('../../../lib/app/environments').EnvironmentOption[];
    unread: boolean;
    unreadCount: number;
    view: CommentsView;
    status: StatusFilter;
    /** Comments in each status with the other filters applied */
    statusCounts: Record<StatusFilter, number>;
    people: PeopleFilter;
    page: string | undefined;
    /** Relative URLs (paths) that have comments */
    pages: string[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (name: string, value: string | undefined) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === undefined)
            params.delete(name);
        else
            params.set(name, value);
        const query = params.toString();
        router.push(`${pathname}${query ? `?${query}` : ''}#comments`);
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Select value={environment} onValueChange={value => go('environment', value)}>
                <SelectTrigger size="sm" aria-label="Environment" className="max-w-80 min-w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>
                    {environments.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                    <SelectItem value="all">All environments</SelectItem>
                    <SelectItem value="removed">Removed addresses</SelectItem>
                    <SelectItem value="unknown">Source not recorded</SelectItem>
                </SelectGroup></SelectContent>
            </Select>
            {/* The toolbar inbox's status tabs; the board already shows Open and Done side by side */}
            {view === 'list' && (
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    aria-label="Status"
                    value={status}
                    onValueChange={(value) => value && go('status', value === 'open' ? undefined : value)}>
                    {(Object.keys(statusFilterLabels) as StatusFilter[]).map(value => (
                        <ToggleGroupItem key={value} value={value}>
                            {statusFilterLabels[value]} <span className="tabular-nums text-muted-foreground">{statusCounts[value]}</span>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            )}
            {/* The toolbar inbox's Unread chip: a blue dot and count while there is unread activity */}
            <Toggle size="sm" variant="outline" pressed={unread} onPressedChange={pressed => go('unread', pressed ? 'true' : undefined)}
                className={cn('rounded-full px-3', !unread && 'text-muted-foreground')}>
                {unreadCount > 0 && <span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--brand-accent))]" />}
                Unread <span className={cn('tabular-nums', unreadCount > 0 ? 'text-[hsl(var(--brand-accent-text))]' : 'text-muted-foreground')}>{unreadCount}</span>
            </Toggle>
            {readAction}
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-label="View"
                value={view}
                onValueChange={(value) => value && go('view', value === 'board' ? 'board' : undefined)}>
                <ToggleGroupItem value="list">
                    <ListIcon data-icon="inline-start" />
                    List
                </ToggleGroupItem>
                <ToggleGroupItem value="board">
                    <KanbanIcon data-icon="inline-start" />
                    Board
                </ToggleGroupItem>
            </ToggleGroup>
            <Select value={people} onValueChange={(value) => go('people', value === 'all' ? undefined : value)}>
                <SelectTrigger size="sm" aria-label="People" className="min-w-36">
                    <UserIcon className="text-muted-foreground" />
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {(Object.keys(peopleFilterLabels) as PeopleFilter[]).map(value => (
                            <SelectItem key={value} value={value}>{peopleFilterLabels[value]}</SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            {author && (
                <Button size="sm" variant="outline" className="max-w-full" onClick={() => go('author', undefined)} aria-label={`Clear author filter: ${author.name}`}>
                    <UserIcon data-icon="inline-start" />
                    <span className="truncate">Author: {author.name}</span>
                    <XIcon data-icon="inline-end" />
                </Button>
            )}
            <Select value={page ?? allPages} onValueChange={(value) => go('page', value === allPages ? undefined : value)}>
                <SelectTrigger size="sm" aria-label="Page" className="max-w-64 min-w-36">
                    <FileIcon className="text-muted-foreground" />
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value={allPages}>All pages</SelectItem>
                        {pages.map(path => (
                            <SelectItem key={path} value={path}><span className="font-mono text-[13px]">{path}</span></SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    );
}
