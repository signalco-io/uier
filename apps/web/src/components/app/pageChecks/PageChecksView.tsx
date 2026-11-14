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
import { cn } from '@/src/lib/utils';
import { filterIconButton } from '../comments/CommentsViewToggle';
import { RelativeTime } from '../comments/DateTime';
import { AcrossPages } from './AcrossPages';
import { AccessibilityResult, ChangeResult, PageCell, SeoResult, VitalsResult, type PageEnvironment } from './PageCheckParts';

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
                        {/* The filter and order sit with the list they change (uier #256) */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 id="checked-pages-title" className="m-0 text-base font-semibold tracking-[-0.01em]">
                                {t("Pages ")}<span className="font-normal text-muted-foreground tabular-nums">
                                    {filter === 'all' ? pages.length : t("{shown} of {total}", { shown: sorted.length, total: pages.length })}
                                </span>
                            </h2>
                            <div className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
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
                                {/* Icon-only ghost buttons with a tooltip, like the comments' Filter and Group by (uier #417) */}
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
                        <div className={cn('hidden rounded-xl border', sorted.length > 0 && '@3xl/page-checks:block')}>
                            <Table aria-labelledby="checked-pages-title" data-page-checks-table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead scope="col" aria-sort={ariaSort('page')} className="pl-4">{t("Page")}</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('accessibility')}>{t("Accessibility")}</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('seo')}>{t("SEO")}</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('vitals')}>{t("Core Web Vitals")}</TableHead>
                                        <TableHead scope="col" aria-sort={ariaSort('checked')} className="pr-4">{t("Checked")}</TableHead>
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
                                        {([[t("Accessibility"), <AccessibilityResult key="a" page={page} />], ['SEO', <SeoResult key="s" page={page} />],
                                            [t("Core Web Vitals"), <VitalsResult key="v" page={page} />], [t("Checked"), <Checked key="c" page={page} />]] as const).map(([label, value]) => (
                                            <div key={label} className="flex min-w-0 flex-col gap-1">
                                                <dt className="text-xs text-muted-foreground">{t(label)}</dt>
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
