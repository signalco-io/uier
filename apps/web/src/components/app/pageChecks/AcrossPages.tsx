'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRightIcon, SearchIcon } from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/src/components/ui/input-group';
import type { PageCheckInsights, SharedText } from '@/src/lib/pageChecks/insights';
import type { PageCheckRow } from '@/src/lib/pageChecks/model';
import { pathTree, type PathNode } from '@/src/lib/pageChecks/pathTree';
import { cn } from '@/src/lib/utils';
import { PageLink, type PageEnvironment } from './PageCheckParts';

type Links = { projectId: string; environments: readonly PageEnvironment[] };

/** A finding with more pages than this gets a search field */
const SEARCH_FROM = 6;

/** The search, case aside, in the page's address or title */
const normalized = (text: string) => text.toLocaleLowerCase('en');
const pageMatches = (page: PageCheckRow, query: string) =>
    !query || normalized(`${page.sourcePath ?? page.path}\n${page.title ?? ''}`).includes(query);

/**
 * One finding across pages: a card with its count and what it means. Its pages are closed until asked
 * for (uier #219), then listed in a bounded scroll, with a search when there are many.
 */
function Finding({ id, title, description, count, empty, children }: {
    id: string;
    title: string;
    description: string;
    count: number;
    empty: string;
    /** The pages, for the search (lowercase, trimmed; empty for all) */
    children: (query: string) => ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    return (
        <Card size="sm" role="region" aria-labelledby={`${id}-title`} data-page-checks-finding={id}>
            <CardHeader>
                <CardTitle>
                    <h4 id={`${id}-title`} className="m-0 text-sm leading-5 font-medium">{title}</h4>
                </CardTitle>
                <CardDescription>{description}</CardDescription>
                <CardAction>
                    <Badge variant="outline" className="font-mono tabular-nums">
                        {count}<span className="sr-only"> {count === 1 ? 'page' : 'pages'}</span>
                    </Badge>
                </CardAction>
            </CardHeader>
            <CardContent>
                {count ? (
                    <Collapsible open={open} onOpenChange={setOpen} className="flex min-w-0 flex-col gap-2">
                        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group/pages -ml-2 self-start text-muted-foreground pointer-coarse:min-h-11" />}>
                            <ChevronRightIcon data-icon="inline-start" aria-hidden="true" className="transition-transform group-data-[panel-open]/pages:rotate-90 motion-reduce:transition-none" />
                            {open ? 'Hide pages' : count === 1 ? 'Show the page' : `Show ${count} pages`}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="flex min-w-0 flex-col gap-2">
                            {count > SEARCH_FROM && (
                                <InputGroup className="h-8">
                                    <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
                                    <InputGroupInput type="search" value={search} onChange={event => setSearch(event.target.value)}
                                        aria-label={`Search ${title.toLocaleLowerCase('en')}`} placeholder="Search pages" className="pointer-coarse:min-h-11" />
                                </InputGroup>
                            )}
                            <div className="max-h-80 min-w-0 overflow-y-auto overscroll-contain">
                                {children(normalized(search.trim()))}
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                ) : <p className="m-0 text-sm text-muted-foreground">{empty}</p>}
            </CardContent>
        </Card>
    );
}

const noMatch = <p className="m-0 text-sm text-muted-foreground">No pages match the search.</p>;

/** One level of the hierarchy and the levels under it, each under a line from its parent */
function Levels({ nodes, label, links, nested }: { nodes: PathNode<PageCheckRow>[]; label?: string; links: Links; nested?: boolean }) {
    return (
        <ul aria-label={label} className={cn('m-0 flex min-w-0 list-none flex-col gap-0.5 p-0', nested && 'mt-0.5 ml-1.5 border-l pl-3')}>
            {nodes.map(node => (
                <li key={node.path} className="flex min-w-0 flex-col">
                    {node.item
                        ? <span className="flex min-w-0"><PageLink page={node.item} base={node.base} {...links} /></span>
                        // A part of the addresses under it, not a checked page
                        : <span className="truncate font-mono text-xs text-muted-foreground" title={node.path}>{node.path.slice(node.base.length)}</span>}
                    {node.children.length > 0 && <Levels nodes={node.children} links={links} nested />}
                </li>
            ))}
        </ul>
    );
}

/** The pages as a hierarchy of their addresses; under each environment's name when they are from several */
function PageTree({ pages, label, links }: { pages: readonly PageCheckRow[]; label: string; links: Links }) {
    const origins = [...new Set(pages.map(page => page.origin))];
    if (origins.length < 2) return <Levels nodes={pathTree(pages, page => page.path)} label={label} links={links} />;
    return (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
            {origins.map(origin => (
                <li key={origin} className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-xs text-muted-foreground">{links.environments.find(item => item.origin === origin)?.label ?? origin}</span>
                    <Levels nodes={pathTree(pages.filter(page => page.origin === origin), page => page.path)} links={links} />
                </li>
            ))}
        </ul>
    );
}

function PageList({ pages, label, links, query }: { pages: readonly PageCheckRow[]; label: string; links: Links; query: string }) {
    const shown = pages.filter(page => pageMatches(page, query));
    return shown.length ? <PageTree pages={shown} label={label} links={links} /> : noMatch;
}

/** Each shared text with its pages; the search finds the text or its pages */
function SharedList({ groups, links, query }: { groups: SharedText[]; links: Links; query: string }) {
    const shown = groups
        .map(group => normalized(group.text).includes(query) ? group : { ...group, pages: group.pages.filter(page => pageMatches(page, query)) })
        .filter(group => group.pages.length);
    if (!shown.length) return noMatch;
    return (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {shown.map(group => (
                <li key={`${group.pages[0]!.origin}:${group.text}`} className="flex min-w-0 flex-col gap-1">
                    <span className="min-w-0 text-sm break-words">{group.text}</span>
                    <PageTree pages={group.pages} label={`Pages with “${group.text}”`} links={links} />
                </li>
            ))}
        </ul>
    );
}

const pagesIn = (groups: SharedText[]) => groups.reduce((total, group) => total + group.pages.length, 0);

/**
 * What only shows across pages, above the table: indexable pages of one site address that share a
 * title or a meta description, indexable pages without a description, and pages that ask search
 * engines not to index them. Each lists its pages when opened, as a hierarchy of their addresses.
 */
export function AcrossPages({ insights, ...links }: Links & { insights: PageCheckInsights }) {
    return (
        <section aria-labelledby="across-pages-title" className="flex flex-col gap-3">
            <h3 id="across-pages-title" className="m-0 text-base font-semibold tracking-[-0.01em]">Across pages</h3>
            <div className="grid items-start gap-4 md:grid-cols-2">
                <Finding id="shared-titles" title="Shared titles" count={pagesIn(insights.sharedTitles)}
                    description="Indexable pages of one site address with the same title." empty="No pages share a title.">
                    {query => <SharedList groups={insights.sharedTitles} links={links} query={query} />}
                </Finding>
                <Finding id="shared-descriptions" title="Shared descriptions" count={pagesIn(insights.sharedDescriptions)}
                    description="Indexable pages of one site address with the same meta description." empty="No pages share a description.">
                    {query => <SharedList groups={insights.sharedDescriptions} links={links} query={query} />}
                </Finding>
                <Finding id="without-description" title="Without a description" count={insights.withoutDescription.length}
                    description="Indexable pages with no meta description." empty="Every indexable page has one.">
                    {query => <PageList pages={insights.withoutDescription} label="Pages without a description" links={links} query={query} />}
                </Finding>
                <Finding id="not-indexed" title="Not indexed" count={insights.noindex.length}
                    description="Pages that ask search engines not to index them." empty="No page asks not to be indexed.">
                    {query => <PageList pages={insights.noindex} label="Pages not indexed" links={links} query={query} />}
                </Finding>
            </div>
        </section>
    );
}
