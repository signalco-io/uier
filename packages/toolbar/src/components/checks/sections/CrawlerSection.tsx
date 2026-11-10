import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's Crawlers section: the page's response, the HTML the server sends, robots.txt for search and AI crawlers, the sitemap and llms.txt (src/checks/lazy/crawler.ts).
// Not built yet: its check reports nothing, so the panel shows no section.

export const crawlerSection = defineSection({ id: 'crawler', panel: 'seo', when: 'panel', run: () => undefined });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const crawlerSections: readonly SectionDefinition[] = [crawlerSection];

export function CrawlerSection() {
    return <ReportSection id={crawlerSection.id} title="Crawlers" section={useSection(crawlerSection)} />;
}
