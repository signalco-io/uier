import type { ReactNode } from 'react';
import { Badge } from '@/src/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/src/components/ui/card';
import type { PageCheckInsights, SharedText } from '@/src/lib/pageChecks/insights';
import type { PageCheckRow } from '@/src/lib/pageChecks/model';
import { PageLink, type PageEnvironment } from './PageCheckParts';

type Links = { projectId: string; environments: readonly PageEnvironment[] };

/** One finding across pages: a card with its count, what it means and the pages it lists */
function Finding({ id, title, description, count, empty, children }: {
    id: string;
    title: string;
    description: string;
    count: number;
    empty: string;
    children: ReactNode;
}) {
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
                {count ? children : <p className="m-0 text-sm text-muted-foreground">{empty}</p>}
            </CardContent>
        </Card>
    );
}

function PageList({ pages, label, links }: { pages: readonly PageCheckRow[]; label: string; links: Links }) {
    return (
        <ul aria-label={label} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {pages.map(page => <li key={page.id} className="flex min-w-0"><PageLink page={page} {...links} /></li>)}
        </ul>
    );
}

function SharedList({ groups, links }: { groups: SharedText[]; links: Links }) {
    return (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {groups.map(group => (
                <li key={`${group.pages[0]!.origin}:${group.text}`} className="flex min-w-0 flex-col gap-1">
                    <span className="min-w-0 text-sm break-words">{group.text}</span>
                    <PageList pages={group.pages} label={`Pages with “${group.text}”`} links={links} />
                </li>
            ))}
        </ul>
    );
}

const pagesIn = (groups: SharedText[]) => groups.reduce((total, group) => total + group.pages.length, 0);

/**
 * What only shows across pages, above the table: indexable pages of one site address that share a
 * title or a meta description, indexable pages without a description, and pages that ask search
 * engines not to index them. Each lists its pages.
 */
export function AcrossPages({ insights, ...links }: Links & { insights: PageCheckInsights }) {
    return (
        <section aria-labelledby="across-pages-title" className="flex flex-col gap-3">
            <h3 id="across-pages-title" className="m-0 text-base font-semibold tracking-[-0.01em]">Across pages</h3>
            <div className="grid gap-4 md:grid-cols-2">
                <Finding id="shared-titles" title="Shared titles" count={pagesIn(insights.sharedTitles)}
                    description="Indexable pages of one site address with the same title." empty="No pages share a title.">
                    <SharedList groups={insights.sharedTitles} links={links} />
                </Finding>
                <Finding id="shared-descriptions" title="Shared descriptions" count={pagesIn(insights.sharedDescriptions)}
                    description="Indexable pages of one site address with the same meta description." empty="No pages share a description.">
                    <SharedList groups={insights.sharedDescriptions} links={links} />
                </Finding>
                <Finding id="without-description" title="Without a description" count={insights.withoutDescription.length}
                    description="Indexable pages with no meta description." empty="Every indexable page has one.">
                    <PageList pages={insights.withoutDescription} label="Pages without a description" links={links} />
                </Finding>
                <Finding id="not-indexed" title="Not indexed" count={insights.noindex.length}
                    description="Pages that ask search engines not to index them." empty="No page asks not to be indexed.">
                    <PageList pages={insights.noindex} label="Pages not indexed" links={links} />
                </Finding>
            </div>
        </section>
    );
}
