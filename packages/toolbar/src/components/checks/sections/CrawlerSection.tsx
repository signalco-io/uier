import { Down } from '@signalco/ui-icons';
import type { AiCrawlerVerdict } from '../../../checks/lazy/crawler';
import { CheckItem, CheckSection } from '../ChecksParts';
import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';
import { useMessages } from '../../../i18n';

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
    const t = useMessages().sections.crawler;
    return (
        <details className="group @container pl-6">
            <summary className="-mx-1 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-sm text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                <Down size={16} aria-hidden="true" className="-rotate-90 transition-transform duration-150 ease-out group-open:rotate-0 motion-reduce:transition-none" />
                {t.each}
            </summary>
            {/* Aligned columns shared by every row through subgrid: name, what it is for and the verdict side by
                side, or on a narrow panel the name and verdict with what it is for below */}
            <ul aria-label={t.list} className="m-0 grid list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 p-0 pb-1 @min-[18rem]:grid-cols-[max-content_minmax(0,1fr)_auto]">
                {crawlers.map(crawler => (
                    <li key={crawler.token} className="col-span-full grid grid-cols-subgrid items-baseline text-xs" data-uier-crawler={crawler.token}>
                        <span className="col-start-1 row-start-1 break-all font-mono text-foreground @min-[18rem]:break-normal">{crawler.token}</span>
                        <span className="col-span-2 col-start-1 row-start-2 min-w-0 text-muted-foreground @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">{crawler.by}, {t.uses[crawler.use as keyof typeof t.uses] ?? crawler.use}</span>
                        <span className={`col-start-2 row-start-1 max-w-32 text-right @min-[18rem]:col-start-3 ${crawler.allowed ? 'text-muted-foreground' : 'break-words text-foreground'}`}>
                            {crawler.allowed ? t.allowed : t.blockedBy(crawler.rule ?? 'robots.txt')}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

export function CrawlerSection() {
    const section = useSection(crawlerSection);
    const t = useMessages().sections.crawler;
    const { report, status } = section;
    // Checking for the first time, failed, or nothing to show: the usual card (or none)
    if (!report) return <ReportSection id={crawlerSection.id} title={t.title} section={section} />;
    const ai = report.details?.ai;
    return (
        <CheckSection title={t.title} note={report.note} data-uier-section={crawlerSection.id} data-uier-section-status={status}>
            {report.checks.map(check => (
                <CheckItem key={check.id} check={check}>
                    {check.id === 'crawl-robots-ai' && ai && <AiCrawlers crawlers={ai} />}
                </CheckItem>
            ))}
        </CheckSection>
    );
}
