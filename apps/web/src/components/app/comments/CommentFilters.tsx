'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';
import { SelectItems } from '@signalco/ui-primitives/SelectItems';
import { LayoutGrid, LayoutList } from '@signalco/ui-icons';
import { peopleFilterLabels, type CommentsView, type PeopleFilter } from './commentLabels';

const allPages = 'all';

/** View (list or board) and the people and page filters; all kept in the URL */
export function CommentFilters({ view, people, page, pages }: {
    view: CommentsView;
    people: PeopleFilter;
    page: string | undefined;
    /** Relative URLs (paths) that have comments */
    pages: string[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const hrefWith = (name: string, value: string | undefined) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value === undefined)
            params.delete(name);
        else
            params.set(name, value);
        const query = params.toString();
        return `${pathname}${query ? `?${query}` : ''}#comments`;
    };

    return (
        <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="View" className="flex gap-1">
                <Button
                    href={hrefWith('view', undefined)}
                    variant={view === 'list' ? 'soft' : 'plain'}
                    size="sm"
                    aria-current={view === 'list' ? 'true' : undefined}
                    startDecorator={<LayoutList className="size-4" />}>
                    List
                </Button>
                <Button
                    href={hrefWith('view', 'board')}
                    variant={view === 'board' ? 'soft' : 'plain'}
                    size="sm"
                    aria-current={view === 'board' ? 'true' : undefined}
                    startDecorator={<LayoutGrid className="size-4" />}>
                    Board
                </Button>
            </div>
            <div className="w-48">
                <SelectItems
                    label="People"
                    value={people}
                    onValueChange={(value) => router.push(hrefWith('people', value === 'all' ? undefined : value))}
                    items={(Object.keys(peopleFilterLabels) as PeopleFilter[]).map(value => ({ value, label: peopleFilterLabels[value] }))} />
            </div>
            <div className="w-64">
                <SelectItems
                    label="Page"
                    value={page ?? allPages}
                    onValueChange={(value) => router.push(hrefWith('page', value === allPages ? undefined : value))}
                    items={[
                        { value: allPages, label: 'All pages' },
                        ...pages.map(path => ({ value: path, label: <span className="font-mono text-[13px]">{path}</span> }))
                    ]} />
            </div>
        </div>
    );
}
