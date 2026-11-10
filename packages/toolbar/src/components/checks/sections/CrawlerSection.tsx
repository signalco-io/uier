import { Down } from '@signalco/ui-icons';
import type { AiCrawlerVerdict } from '../../../checks/lazy/crawler';
import { CheckItem, CheckSection } from '../ChecksParts';
import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's Crawlers section: the page's response, the HTML the server sends, robots.txt for
// search and AI crawlers, the sitemap and llms.txt (src/checks/lazy/crawler.ts,
// docs/page-checks-crawler.md). It sends requests, so it runs when the panel opens and on Check
// again, never in the background.

export const crawlerSection = defineSection({
    id: 'crawler', panel: 'seo', when: 'panel',
    run: (checks, context) => checks.crawler.checkCrawler(context)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const crawlerSections: readonly SectionDefinition[] = [crawlerSection];

/** Each AI crawler with what it is for and what robots.txt says to it, folded under its row */
function AiCrawlers({ crawlers }: { crawlers: AiCrawlerVerdict[] }) {
    return (
        <details className="group pl-6">
            <summary className="-mx-1 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                <Down size={16} aria-hidden="true" className="-rotate-90 transition-transform duration-150 ease-out group-open:rotate-0 motion-reduce:transition-none" />
                Each AI crawler
            </summary>
            <ul aria-label="AI crawlers" className="m-0 flex list-none flex-col gap-1 p-0 pb-1">
                {crawlers.map(crawler => (
                    <li key={crawler.token} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs" data-uier-crawler={crawler.token}>
                        <span className="font-mono text-foreground">{crawler.token}</span>
                        <span className="min-w-0 flex-1 text-muted-foreground">{crawler.by}, {crawler.use}</span>
                        <span className={crawler.allowed ? 'text-muted-foreground' : 'break-words text-foreground'}>
                            {crawler.allowed ? 'Allowed' : `Blocked by ${crawler.rule ?? 'robots.txt'}`}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

export function CrawlerSection() {
    const section = useSection(crawlerSection);
    const { report, status } = section;
    // Checking for the first time, failed, or nothing to show: the usual card (or none)
    if (!report) return <ReportSection id={crawlerSection.id} title="Crawlers" section={section} />;
    const ai = report.details?.ai;
    return (
        <CheckSection title="Crawlers" note={report.note} data-uier-section={crawlerSection.id} data-uier-section-status={status}>
            {report.checks.map(check => (
                <CheckItem key={check.id} check={check}>
                    {check.id === 'crawl-robots-ai' && ai && <AiCrawlers crawlers={ai} />}
                </CheckItem>
            ))}
        </CheckSection>
    );
}
