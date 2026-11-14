'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import {
    AccessibilityIcon,
    ArrowDownAZIcon,
    ArrowDownUpIcon,
    CircleAlertIcon,
    CircleCheckIcon,
    CircleDashedIcon,
    ClockIcon,
    FlameIcon,
    GaugeIcon,
    ListFilterIcon,
    ListIcon,
    ScanSearchIcon,
    SearchCheckIcon,
    TrendingDownIcon,
    TrendingUpIcon,
    XIcon,
    type LucideIcon
} from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
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
import { filterIconButton } from '../comments/CommentsViewToggle';
import { RelativeTime } from '../comments/DateTime';
import { AcrossPages } from './AcrossPages';
import { AccessibilityResult, ChangeResult, PageCell, SeoResult, VitalsResult, type PageEnvironment } from './PageCheckParts';
import { useVirtualRows } from './useVirtualRows';

/** Each order's and filter's icon in their menus and in the chip of the one in effect (uier #417) */
const orderIcons: Record<PageCheckOrder, LucideIcon> = {
    attention: CircleAlertIcon,
    issues: FlameIcon,
    fixed: TrendingDownIcon,
    new: TrendingUpIcon,
    accessibility: AccessibilityIcon,
    seo: SearchCheckIcon,
    vitals: GaugeIcon,
    checked: ClockIcon,
    page: ArrowDownAZIcon
};
const filterIcons: Record<PageCheckFilter, LucideIcon> = {
    all: ListIcon,
    attention: CircleAlertIcon,
    accessibility: AccessibilityIcon,
    seo: SearchCheckIcon,
    vitals: GaugeIcon,
    passing: CircleCheckIcon,
    incomplete: CircleDashedIcon
};

/** The filter or order in effect, left of the actions: its name, its value and a button that clears it */
function SettingChip({ name, icon: Icon, value, label, onClear }: { name: string; icon: LucideIcon; value: string; label: string; onClear: () => void }) {
    return (
        <Button size="xs" variant="outline" className="max-w-full font-normal pointer-coarse:min-h-11" aria-label={label} onClick={onClear}>
            <Icon data-icon="inline-start" aria-hidden="true" className="text-muted-foreground" />
            <span className="shrink-0 text-muted-foreground">{name}:</span>
            <span className="truncate">{value}</span>
            <XIcon data-icon="inline-end" aria-hidden="true" className="text-muted-foreground" />
        </Button>
    );
}

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
    vitals: { column: 'vitals', direction: 'descending' },
    checked: { column: 'checked', direction: 'descending' }
};

function Checked({ page }: { page: PageCheckRow }) {
    return (
        <span className="flex flex-col gap-0.5">
            <RelativeTime value={page.checkedAt} short />
            <ChangeResult page={page} />
        </span>
    );
}

type Links = { projectId: string; environments: PageEnvironment[] };

/**
 * The pages as a table, from the `@3xl` width of the list (uier #418): only the rows near the screen render
 * (`useVirtualRows`), under a header that sticks below the project's sticky tabs (`--project-tabs`, under the top
 * bar where the window scrolls below lg; at the panel's top from lg), one layer under them (`z-[9]`). The columns have fixed shares (`table-fixed`), so the rows that come and go never move them.
 */
function PageTable({ pages, ariaSort, links }: { pages: PageCheckRow[]; ariaSort: (column: string) => 'ascending' | 'descending' | undefined; links: Links }) {
    const { t } = useAppI18n();
    const { parts, virtual, container } = useVirtualRows(pages, { estimate: 100 });
    return (
        // The kit's table container scrolls sideways, which would hold the sticky header; these columns fit their room
        <div className="hidden rounded-xl border @3xl/page-checks:block [&>[data-slot=table-container]]:overflow-visible">
            <Table aria-labelledby="checked-pages-title" aria-rowcount={virtual ? pages.length + 1 : undefined} data-page-checks-table className="table-fixed">
                <colgroup>
                    <col className="w-[32%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                    <col className="w-[16%]" />
                    <col className="w-[20%]" />
                </colgroup>
                {/* Its line is a shadow: a collapsed table's border stays behind when the header sticks */}
                <TableHeader className="sticky top-[calc(3rem+var(--project-tabs,0px))] z-[9] lg:top-[var(--project-tabs,0px)] [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_hsl(var(--border))] [&_th:first-child]:rounded-tl-[11px] [&_th:last-child]:rounded-tr-[11px] [&_tr]:border-b-0">
                    <TableRow aria-rowindex={virtual ? 1 : undefined} className="hover:bg-transparent">
                        <TableHead scope="col" aria-sort={ariaSort('page')} className="pl-4">{t("Page")}</TableHead>
                        <TableHead scope="col" aria-sort={ariaSort('accessibility')}>{t("Accessibility")}</TableHead>
                        <TableHead scope="col" aria-sort={ariaSort('seo')}>{t("SEO")}</TableHead>
                        <TableHead scope="col" aria-sort={ariaSort('vitals')} className="whitespace-normal">{t("Core Web Vitals")}</TableHead>
                        <TableHead scope="col" aria-sort={ariaSort('checked')} className="pr-4">{t("Checked")}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody {...container}>
                    {parts.map(part => part.kind === 'space' ? (
                        <tr key={part.key} aria-hidden="true" data-virtual-space="">
                            <td colSpan={5} className="p-0" style={{ height: part.height }} />
                        </tr>
                    ) : (
                        <TableRow key={part.item.id} data-page-check={part.item.path} data-row-key={part.item.id}
                            aria-rowindex={virtual ? part.index + 2 : undefined} className="align-top">
                            <TableCell className="py-3 pl-4 align-top whitespace-normal">
                                <PageCell page={part.item} {...links} />
                            </TableCell>
                            <TableCell className="py-3 align-top whitespace-normal"><AccessibilityResult page={part.item} /></TableCell>
                            <TableCell className="py-3 align-top whitespace-normal"><SeoResult page={part.item} /></TableCell>
                            <TableCell className="py-3 align-top whitespace-normal"><VitalsResult page={part.item} /></TableCell>
                            <TableCell className="py-3 pr-4 align-top whitespace-normal"><Checked page={part.item} /></TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

/** A card per page under the `@3xl` width of the list, only the ones near the screen rendered (uier #418) */
function PageCards({ pages, links }: { pages: PageCheckRow[]; links: Links }) {
    const { t } = useAppI18n();
    // 12 px between the cards (`gap-3`)
    const { parts, virtual, container } = useVirtualRows(pages, { estimate: 220, gap: 12 });
    return (
        <ul aria-labelledby="checked-pages-title" className="m-0 flex list-none flex-col gap-3 p-0 @3xl/page-checks:hidden" {...container}>
            {parts.map(part => {
                if (part.kind === 'space') return <li key={part.key} aria-hidden="true" data-virtual-space="" style={{ height: part.height }} />;
                const page = part.item;
                return (
                    <li key={page.id} data-page-check={page.path} data-row-key={page.id} className="flex flex-col gap-3 rounded-xl border p-4 text-sm"
                        aria-setsize={virtual ? pages.length : undefined} aria-posinset={virtual ? part.index + 1 : undefined}>
                        <PageCell page={page} {...links} />
                        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
                            {([[t("Accessibility"), <AccessibilityResult key="a" page={page} />], ['SEO', <SeoResult key="s" page={page} />],
                                [t("Core Web Vitals"), <VitalsResult key="v" page={page} />], [t("Checked"), <Checked key="c" page={page} />]] as const).map(([label, value]) => (
                                <div key={label} className="flex min-w-0 flex-col gap-1">
                                    <dt className="text-xs text-muted-foreground">{t(label)}</dt>
                                    <dd className="m-0 min-w-0">{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </li>
                );
            })}
        </ul>
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
    const { t } = useAppI18n();
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
        // Full width like the comments (uier #214): the panel's width less the gutters (`page-wide`, app-shell.md), from
        // the left, however wide (uier #363); data-header-wide gives the project header above the same width
        <section aria-label={t("Page checks")} data-page-width="wide" data-header-wide="list"
            className="flex flex-col gap-6 page-wide">
            {/* No heading or intro of its own (uier #255, uier #273): the project's Page checks tab above names it, so its
                sections are h2 under the project's h1 */}

            {pages.length === 0 ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><ScanSearchIcon /></EmptyMedia>
                        <EmptyTitle>{t("No pages checked yet")}</EmptyTitle>
                        <EmptyDescription>
                            {t("Pages appear as members review the site with the toolbar. Extension reviews are not included yet.")}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <>
                    <AcrossPages checkedPages={pages} insights={pageCheckInsights(pages)} {...links} />
                    <section aria-labelledby="checked-pages-title" className="@container/page-checks flex flex-col gap-3">
                        {/* The filter and order sit with the list they change (uier #256). The heading and the two buttons share a
                            line; what is in effect sits between them, or on a phone on its own line under them, like the
                            comments' filters in effect */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <h2 id="checked-pages-title" className="m-0 mr-auto text-base font-semibold tracking-[-0.01em]">
                                {t("Pages ")}<span className="font-normal text-muted-foreground tabular-nums">
                                    {filter === 'all' ? pages.length : t("{shown} of {total}", { shown: sorted.length, total: pages.length })}
                                </span>
                            </h2>
                            {(filter !== 'all' || order !== 'attention') && <div className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2 max-sm:order-last max-sm:w-full max-sm:justify-start">
                                {/* What is in effect beside the actions, each with its own clear, like the comments' filters */}
                                {filter !== 'all' && (
                                    <SettingChip name={t("Show")} icon={filterIcons[filter]} value={t(pageCheckFilterLabels[filter])}
                                        label={t("{value0}{value1}, clear filter", { value0: `${t("Show")}: `, value1: t(pageCheckFilterLabels[filter]) })}
                                        onClear={showAll} />
                                )}
                                {order !== 'attention' && (
                                    <SettingChip name={t("Sort")} icon={orderIcons[order]} value={t(pageCheckOrderLabels[order])}
                                        label={t("{value0}{value1}, reset order", { value0: `${t("Sort")}: `, value1: t(pageCheckOrderLabels[order]) })}
                                        onClear={() => setUrlSearchParams({ sort: undefined })} />
                                )}
                            </div>}
                            {/* Icon-only ghost buttons with a tooltip, like the comments' Filter and Group by (uier #417) */}
                            <div className="flex shrink-0 items-center gap-1">
                                <DropdownMenu>
                                    <Tooltip>
                                        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("Filter pages")} className={filterIconButton} />} />}>
                                            <ListFilterIcon />
                                        </TooltipTrigger>
                                        <TooltipContent>{t("Filter pages")}</TooltipContent>
                                    </Tooltip>
                                    <DropdownMenuContent align="end" className="w-auto min-w-64">
                                        <DropdownMenuRadioGroup value={filter} onValueChange={(next: PageCheckFilter) => setUrlSearchParams({ show: next !== 'all' ? next : undefined })}>
                                            {pageCheckFilters.map(item => {
                                                const Icon = filterIcons[item];
                                                const count = filterPageChecks(pages, item).length;
                                                return (
                                                    <DropdownMenuRadioItem key={item} value={item} closeOnClick className="pointer-coarse:min-h-11">
                                                        <Icon aria-hidden="true" className="text-muted-foreground" />
                                                        <span className="flex-1">{t(pageCheckFilterLabels[item])}</span>{' '}
                                                        <span className="text-muted-foreground tabular-nums">
                                                            <span aria-hidden="true">{count}</span><span className="sr-only">{count === 1 ? t('1 page') : t('{count} pages', { count })}</span>
                                                        </span>
                                                    </DropdownMenuRadioItem>
                                                );
                                            })}
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <DropdownMenu>
                                    <Tooltip>
                                        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("Sort pages")} className={filterIconButton} />} />}>
                                            <ArrowDownUpIcon />
                                        </TooltipTrigger>
                                        <TooltipContent>{t("Sort pages")}</TooltipContent>
                                    </Tooltip>
                                    <DropdownMenuContent align="end" className="w-auto min-w-56">
                                        <DropdownMenuRadioGroup value={order} onValueChange={(next: PageCheckOrder) => setUrlSearchParams({ sort: next !== 'attention' ? next : undefined })}>
                                            {pageCheckOrders.map(item => {
                                                const Icon = orderIcons[item];
                                                return (
                                                    <DropdownMenuRadioItem key={item} value={item} closeOnClick className="pointer-coarse:min-h-11">
                                                        <Icon aria-hidden="true" className="text-muted-foreground" />
                                                        {t(pageCheckOrderLabels[item])}
                                                    </DropdownMenuRadioItem>
                                                );
                                            })}
                                        </DropdownMenuRadioGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                        {sorted.length === 0 && (
                            <Empty className="border" data-page-checks-filtered>
                                <EmptyHeader>
                                    <EmptyTitle>{t("No pages to show")}</EmptyTitle>
                                    <EmptyDescription>
                                        {t(noneShown[filter])}
                                    </EmptyDescription>
                                </EmptyHeader>
                                <Button variant="outline" size="sm" onClick={showAll}>{t("Show all pages")}</Button>
                            </Empty>
                        )}
                        {/* A table where the column is wide enough; a card per page under it */}
                        {sorted.length > 0 && <PageTable pages={sorted} ariaSort={ariaSort} links={links} />}
                        {sorted.length > 0 && <PageCards pages={sorted} links={links} />}
                    </section>
                </>
            )}
        </section>
    );
}
