'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileIcon, KanbanIcon, ListIcon, UserIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { peopleFilterLabels, type CommentsView, type PeopleFilter } from './commentLabels';

const allPages = 'all';

/** View (list or board) and the people and page filters; all kept in the URL */
export function CommentFilters({ unread, unreadCount, view, people, page, pages, environment, environments }: {
    environment?: string;
    environments: import('../../../lib/app/environments').EnvironmentOption[];
    unread: boolean;
    unreadCount: number;
    view: CommentsView;
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
            <Button size="sm" variant="outline" aria-pressed={unread} onClick={() => go('unread', unread ? undefined : 'true')}>
                Unread {unreadCount}
            </Button>
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
