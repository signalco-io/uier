'use client';

import { ScanSearchIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { setUrlSearchParams, useUrlSearchParams } from '@/src/hooks/use-url-search-params';
import {
    filterPageChecks,
    isPageCheckFilter,
    isPageCheckOrder,
    pageCheckFilterLabels,
    pageCheckFilters,
    pageCheckInsights,
    pageCheckOrderLabels,
    pageCheckOrders,
    sortPageChecks,
    type PageCheckFilter,
    type PageCheckOrder
} from '@/src/lib/pageChecks/insights';
import type { PageCheckRow } from '@/src/lib/pageChecks/model';
import { cn } from '@/src/lib/utils';
import { RelativeTime } from '../comments/DateTime';
import { AcrossPages } from './AcrossPages';
import { AccessibilityResult, changeText, PageCell, SeoResult, VitalsResult, type PageEnvironment } from './PageCheckParts';

const orderItems = pageCheckOrders.map(order => ({ value: order, label: pageCheckOrderLabels[order] }));
const filterItems = pageCheckFilters.map(filter => ({ value: filter, label: pageCheckFilterLabels[filter] }));
/** Why a filter shows no page */
const noneShown: Record<PageCheckFilter, string> = {
    all: 'No pages checked yet.',
    attention: 'No checked page has anything to look at.',
    accessibility: 'No checked page has accessibility issues.',
    seo: 'No checked page has SEO checks to look at.',
    vitals: 'No checked page has Core Web Vitals over target.',
    passing: 'No page has complete results with all checks passing.',
    incomplete: 'Every page has results for all check categories.'
};

/** The column a sort is by, for its header's `aria-sort` (Needs attention weighs several) */
const sortedColumn: Partial<Record<PageCheckOrder, { column: string; direction: 'ascending' | 'descending' }>> = {
    page: { column: 'page', direction: 'ascending' },
    accessibility: { column: 'accessibility', direction: 'descending' },
    seo: { column: 'seo', direction: 'descending' },
    checked: { column: 'checked', direction: 'descending' }
};

function Checked({ page }: { page: PageCheckRow }) {
    return (
        <span className="flex flex-col gap-0.5">
            <RelativeTime value={page.checkedAt} short />
            <span className="text-muted-foreground">{changeText(page)}</span>
        </span>
    );
}

/**
 * A project's Page checks (`/app/projects/<id>/page-checks`): what the toolbar's background checks
 * found on each page its members reviewed. Across pages first (shared titles and descriptions, pages
 * without a description, pages not indexed), then every page (or the ones a filter shows, `?show=`, chosen in the list's heading row), ordered by what needs most attention
 * (or another order, kept in the address as `?sort=`): a table on a wide column, a card per page on a
 * narrow one.
 */
export function PageChecksView({ projectId, pages, environments }: {
    projectId: string;
    pages: PageCheckRow[];
    environments: PageEnvironment[];
}) {
    const params = useUrlSearchParams();
    const requested = params.get('sort');
    const order: PageCheckOrder = isPageCheckOrder(requested) ? requested : 'attention';
    // Which pages the list shows (uier #221): all by default, kept in the address as `?show=`
    const requestedFilter = params.get('show');
    const filter: PageCheckFilter = isPageCheckFilter(requestedFilter) ? requestedFilter : 'all';
    const sorted = sortPageChecks(filterPageChecks(pages, filter), order);
    const showAll = () => setUrlSearchParams({ show: undefined });
    const links = { projectId, environments };
    const sortedBy = sortedColumn[order];
    const ariaSort = (column: string) => sortedBy?.column === column ? sortedBy.direction : undefined;

    return (
        // Full width like the comments (uier #214): the panel's width less the gutters (`page-wide`, app-shell.md), capped
        // at 96rem; data-header-wide gives the project header above the same width
        <section aria-label="Page checks" data-page-width="wide" data-header-wide="list"
            className="flex w-[min(var(--page-wide),96rem)] flex-col gap-6 mx-[calc((100%-min(var(--page-wide),96rem))/2)]">
            {/* No heading or intro of its own (uier #255, uier #273): the project's Page checks tab above names it, so its
                sections are h2 under the project's h1 */}

            {pages.length === 0 ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><ScanSearchIcon /></EmptyMedia>
                        <EmptyTitle>No pages checked yet</EmptyTitle>
                        <EmptyDescription>
                            Pages appear here as project members review the site with the toolbar. Each page a member opens is checked in their browser.
                            Reviews in the browser extension are not included yet.
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <>
                    <AcrossPages checkedPages={pages} insights={pageCheckInsights(pages)} {...links} />
                    <section aria-labelledby="checked-pages-title" className="@container/page-checks flex flex-col gap-3">
                        {/* The filter and order sit with the list they change (uier #256) */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 id="checked-pages-title" className="m-0 text-base font-semibold tracking-[-0.01em]">
                                Pages <span className="font-normal text-muted-foreground tabular-nums">
                                    {filter === 'all' ? pages.length : `${sorted.length} of ${pages.length}`}
                                </span>
                            </h2>
                            <div className="flex max-w-full flex-wrap gap-2">
                                <Select items={filterItems} value={filter}
                                    onValueChange={next => setUrlSearchParams({ show: next && next !== 'all' ? next : undefined })}>
                                    <SelectTrigger size="sm" aria-label="Show pages" className="w-56 max-w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {filterItems.map(item => (
                                                <SelectItem key={item.value} value={item.value}>
                                                    <span className="flex-1">{item.label}</span>{' '}
                                                    <span className="text-muted-foreground tabular-nums">
                                                        {filterPageChecks(pages, item.value).length}<span className="sr-only"> pages</span>
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <Select items={orderItems} value={order}
                                    onValueChange={next => setUrlSearchParams({ sort: next && next !== 'attention' ? next : undefined })}>
                                    <SelectTrigger size="sm" aria-label="Sort pages" className="w-48 max-w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {orderItems.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        {sorted.length === 0 && (
                            <Empty className="border" data-page-checks-filtered>
                                <EmptyHeader>
                                    <EmptyTitle>No pages to show</EmptyTitle>
                                    <EmptyDescription>
                                        {noneShown[filter]}
                                    </EmptyDescription>
                                </EmptyHeader>
                                <Button variant="outline" size="sm" onClick={showAll}>Show all pages</Button>
                            </Empty>
                        )}
                        {/* A table where the column is wide enough; a card per page under it */}
                        <div className={cn('hidden rounded-xl border', sorted.length > 0 && '@3xl/page-checks:block')}>
                            <Table aria-labelledby="checked-pages-title" data-page-checks-table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead scope="col" aria-sort={ariaSort('page')} className="pl-4">Page</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('accessibility')}>Accessibility</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('seo')}>SEO</TableHead>
                                        <TableHead scope="col">Core Web Vitals</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('checked')} className="pr-4">Checked</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sorted.map(page => (
                                        <TableRow key={page.id} data-page-check={page.path} className="align-top">
                                            <TableCell className="max-w-80 py-3 pl-4 align-top whitespace-normal">
                                                <PageCell page={page} {...links} />
                                            </TableCell>
                                            <TableCell className="py-3 align-top"><AccessibilityResult page={page} /></TableCell>
                                            <TableCell className="py-3 align-top"><SeoResult page={page} /></TableCell>
                                            <TableCell className="py-3 align-top"><VitalsResult page={page} /></TableCell>
                                            <TableCell className="min-w-36 py-3 pr-4 align-top whitespace-normal"><Checked page={page} /></TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {sorted.length > 0 && <ul aria-labelledby="checked-pages-title" className="m-0 flex list-none flex-col gap-3 p-0 @3xl/page-checks:hidden">
                            {sorted.map(page => (
                                <li key={page.id} data-page-check={page.path} className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
                                    <PageCell page={page} {...links} />
                                    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
                                        {([['Accessibility', <AccessibilityResult key="a" page={page} />], ['SEO', <SeoResult key="s" page={page} />],
                                            ['Core Web Vitals', <VitalsResult key="v" page={page} />], ['Checked', <Checked key="c" page={page} />]] as const).map(([label, value]) => (
                                            <div key={label} className="flex min-w-0 flex-col gap-1">
                                                <dt className="text-xs text-muted-foreground">{label}</dt>
                                                <dd className="m-0 min-w-0">{value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </li>
                            ))}
                        </ul>}
                    </section>
                </>
            )}
        </section>
    );
}
