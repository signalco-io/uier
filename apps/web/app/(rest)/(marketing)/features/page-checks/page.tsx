import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { PageChecksTableSpecimen, SeoSceneSpecimen } from '../../../../../src/components/marketing/ChecksSpecimens';
import { ChecksCover } from '../../../../../src/components/marketing/covers/ChecksCover';
import { KnownPages } from '../../../../../src/knownPages';

// The toolbar's Accessibility and SEO panels and the app's Page checks view, as they ship:
// packages/toolbar/docs/page-checks.md and the page-checks-*.md notes beside it (background checks
// and their bounds, quick actions, To review, Not an issue, Comment on all, the re-check in a
// thread, the panels' sections), components/checks for the labels, apps/web/docs/page-checks.md for
// the view and what is stored, and the privacy policy's "Page suggestions". Change this page with
// them. The checks never change a thread's status, and automated checks find only some issues.

const title = 'Accessibility, SEO and security checks';
const description = 'Review accessibility, SEO, security and consent evidence in your browser. Post a finding as a comment in one click.';

export const metadata = publicPageMetadata(KnownPages.PageChecks, { title, description });

const steps = [
    {
        title: 'Open a page with the toolbar',
        text: 'Both checks start in the background once the page has loaded and the browser is idle. When they find something to act on, the Page checks button in the toolbar gets an amber dot.'
    },
    {
        title: 'Open a panel',
        text: 'Page checks, next to the inbox, opens Accessibility, SEO or Security and compliance. On a phone they are in Options. Security and consent checks run only when you open their panel or start a check. Each panel starts with a summary, then what each section found.'
    },
    {
        title: 'Comment in one click',
        text: 'Highlight shows the element on the page. Comment posts the finding there, with what was found and where, a screenshot and the browser details.'
    },
    {
        title: 'Check the fix',
        text: 'Accessibility and SEO findings can run their check again in the thread. Security and consent findings need another check from their panel. A person still decides whether the fix is done.'
    }
];

const accessibility = [
    {
        title: 'Issues by impact',
        text: 'axe-core audits the page for WCAG A and AA and best practices, and WCAG 2.2 target size. Issues are critical, serious, moderate or minor, each with its own shape and colour, the standard it tests and a link on how to fix it.'
    },
    {
        title: 'To review',
        text: 'What axe-core could not decide, such as contrast over an image or a gradient, is listed for a person to check. It is not counted as an issue.'
    },
    {
        title: 'Keyboard',
        text: 'The tab order, positive tabindex and tab stops that cannot be seen. Show tab order draws the order over the page, and Check focus indicators moves the focus through it.'
    },
    {
        title: 'Screen reader',
        text: 'The landmarks, headings and controls a screen reader moves by, with their names and states, and links or buttons that share one name.'
    },
    {
        title: 'Alt text',
        text: 'Each image with the text a screen reader reads for it, and alt text that looks like a file name or a placeholder, starts with “image of” or is over 150 characters.'
    },
    {
        title: 'Zoom, text spacing and motion',
        text: 'Whether the page scrolls sideways at its width, what Apply text spacing does to its text, animations that run for more than five seconds, and video or audio that plays on its own without controls.'
    }
];

const seo = [
    'Page: indexing, a title of 10 to 60 characters, one meta description of 50 to 160, the canonical link, the viewport, the language and language versions.',
    'Sharing and structured data: the Open Graph and X tags a shared link shows, the shared image’s size, and JSON-LD with the properties Google documents for common types.',
    'Headings: one h1, no skipped levels, no empty headings, and the outline.',
    'Links: links without text, addresses that look broken and generic link text. Check links asks the site for up to 100 of its own links when you press it.',
    'Images: missing alt text and dimensions, files over twice the size they are shown at or over 500 KB, and lazy loading where visitors look first.',
    'Core Web Vitals: LCP, CLS and INP, measured in your browser against 2.5 s, 0.1 and 200 ms.',
    'Crawlers: what a request without cookies gets, the HTML the server sends against the rendered page, robots.txt for search and AI crawlers, the sitemap and llms.txt.',
    'AI search: the main content as Markdown, the facts an answer could cite, and AI suggestions for a title, a meta description and the questions the page answers.'
];

const actions = [
    { label: 'Highlight', text: 'Scrolls the element into view and outlines it on the page.' },
    { label: 'Comment', text: 'Posts the finding as a comment pinned to its element, with a screenshot and the browser details. A finding about the whole page becomes page feedback.' },
    { label: 'Comment on all', text: 'Posts one comment for every element of a list that is not reported yet, pinned to the first.' },
    { label: 'Reported as #12', text: 'A finding that already has an open thread says so, for every reviewer and after a reload, so it is not reported twice.' },
    { label: 'Not an issue', text: 'Hides a finding in this browser only. It moves to a folded Dismissed list with Restore and leaves every count.' }
];

const appView = [
    {
        title: 'Every page in one table',
        text: 'Accessibility issues by impact, SEO checks to look at and passed, Core Web Vitals against their targets, when each page was checked and what changed since. Pages that need attention come first.'
    },
    {
        title: 'What only shows across pages',
        text: 'Pages that share a title or a meta description, pages without a description, and pages that ask not to be indexed.'
    },
    {
        title: 'From members’ reviews',
        text: 'Each page a signed-in project member reviews sends a small summary. Guests and public viewers send none, and reviews in the browser extension are not included yet.'
    },
    {
        title: 'Counts, not content',
        text: 'A summary keeps the page’s address, title and description, and each check’s result. It names no element, other page text or reviewer. A project keeps up to 200 pages, each for 90 days after its last check.'
    }
];

const limits = [
    'Automated checks find only some accessibility issues. Also try the page with a keyboard and a screen reader.',
    'Core Web Vitals are measured in your browser, on your device and connection, while you use the page. They are not your visitors’ data.',
    'The background accessibility audit skips pages with more than 1,500 elements and browsers that ask to save data. Opening the panel checks the page then.',
    'Content in frames is not audited. Generic link text and alt text wording are checked in English only.',
    'Security and consent checks need review in their panel and do not certify security or legal compliance.',
    'A check never changes a thread’s status. Confirming a fix is up to a person.'
];

const tryIt = [
    'Open Accessibility, SEO or Security and compliance in the toolbar at the bottom of this window. On a phone, they are in Options.',
    'Highlight a finding to see where it is. Comment posts it on this page, where comments are public.',
    'For your own site, create a project and review it with the toolbar.'
];

const questions: Question[] = [
    {
        question: 'Does it send my page anywhere?',
        answer: <>The checks run in your browser. A project member&rsquo;s review saves a summary of each page to the project, with counts and results, not the page&rsquo;s content. AI suggestions in the SEO panel send the start of the page&rsquo;s main text, its title and its meta description to Anthropic, and only when you ask for them. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'Do the visitors of my site run the checks?',
        answer: <>No. The checks come with the review layer, which loads only for reviewers, so nothing runs for the ordinary visitors of a project&rsquo;s site. On {brand.domain}&rsquo;s own pages the toolbar is shown to everyone, so the checks run there for every visitor.</>
    },
    {
        question: 'Can a fixed finding be checked again?',
        answer: <>Accessibility and SEO findings have Check again in their thread, which runs that one check on the page where it was found. While the thread is ready to verify, it runs on its own when the thread opens. The reviewer still decides; <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> explains how.</>
    },
    {
        question: 'Does it work in the browser extension?',
        answer: <>Yes, the panels work in the <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink>. AI suggestions are not in it, and its reviews are not included in the app&rsquo;s Page checks yet.</>
    },
    {
        question: 'Who can see the Page checks in the app?',
        answer: <>Everyone who can see the project in the app, as with its comments. Only signed-in members&rsquo; reviews add pages to it.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

export default function PageChecksPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Check each page as you review it"
                lead="Check accessibility and SEO as you review, then open Security and compliance for page security and consent evidence. Post findings as comments. The app brings accessibility and SEO summaries together.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                </div>
            </PageHeader>
            <ChecksCover />

            <PageSection
                id="how-it-works"
                title="How it works"
                lead="The checks read the page as you see it, in your browser. They come with the toolbar, so there is nothing else to install.">
                <Panel as="ol">
                    {steps.map((step, index) => (
                        <li key={step.title} className="flex items-baseline gap-4 p-6">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="flex flex-col gap-1">
                                <span className="text-base font-semibold">{step.title}</span>
                                <span className="text-sm leading-relaxed text-muted-foreground">{step.text}</span>
                            </span>
                        </li>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="accessibility"
                title="Accessibility"
                lead="An automated audit first, then sections for what an audit cannot judge on its own.">
                <Panel className="md:grid-cols-2">
                    {accessibility.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="seo"
                title="SEO"
                lead="What search engines, link previews and AI search get from the page. Each check passes, is worth a look, or is a note.">
                <SeoSceneSpecimen />
                <CheckList items={seo} />
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Crawlers and Check links request only the site&rsquo;s own addresses: Crawlers without cookies, like a crawler, and Check links only when you press it. AI suggestions are requested only when you press their buttons.
                </p>
            </PageSection>

            <PageSection
                id="security"
                title="Security and compliance"
                lead="Evidence from the page for a person to review. Checks run when you open the panel or start them.">
                <CheckList items={[
                    'Page security: HTTPS, declared HTTP resources and form targets, cross-origin scripts without integrity declarations, optional browser-exposed cookie flags and recorded source-map requests.',
                    'Response headers: explicitly request this page without cookies to inspect CSP, HSTS, X-Content-Type-Options, frame protection and Referrer-Policy. The anonymous response may differ from the page you loaded.',
                    'Consent: cookie and storage names, known consent-platform markers, and a 15-second observation you start before choosing consent. Cookie and storage values are not included in findings.',
                    'Unknowns stay visible. HttpOnly cookies, third-party storage, TLS details and server vulnerabilities are not inspected. Sensitive files are not probed. Findings do not certify security or legal compliance.',
                    'These reports stay in the browser and do not enter the app’s site-wide summary. You can explicitly post a finding as a comment.'
                ]} />
            </PageSection>

            <PageSection
                id="findings"
                title="From finding to comment"
                lead="Every finding has its actions on its row. The comment says what was found and where, so whoever fixes it needs nothing from the panel.">
                <Panel as="ul">
                    {actions.map(action => (
                        <li key={action.label} className="flex flex-col gap-1 p-6 md:flex-row md:items-baseline md:gap-6">
                            <span className="text-sm font-medium md:w-36 md:shrink-0">{action.label}</span>
                            <span className="text-sm leading-relaxed text-muted-foreground md:flex-1">{action.text}</span>
                        </li>
                    ))}
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    The comment keeps the check it came from, so Copy issue and coding agents connected through the <InlineLink href={KnownPages.Ai}>MCP connector</InlineLink> see the check behind it.
                </p>
            </PageSection>

            <PageSection
                id="across-pages"
                title="Across your pages"
                lead="In a project, the Page checks tab in the app shows what the checks found on each page members reviewed."
                wide>
                <PageChecksTableSpecimen />
                <Panel className="md:grid-cols-2">
                    {appView.map(item => (
                        <Tile key={item.title} title={item.title}>
                            <p>{item.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="limits"
                title="What the checks cannot tell you"
                lead="They point at what is worth a look. They do not certify a page.">
                <CheckList items={limits} />
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The toolbar on this page has the three panels. No account needed.">
                <ol className="flex flex-col gap-4">
                    {tryIt.map((step, index) => (
                        <li key={step} className="flex items-baseline gap-4">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="text-base">{step}</span>
                        </li>
                    ))}
                </ol>
                <Button variant="solid" href={KnownPages.App} className="self-start">Create a project</Button>
            </PageSection>

            <PageSection
                id="faq"
                title="Questions"
                lead={<>More about {brand.name} in the <InlineLink href={KnownPages.Faq}>main questions</InlineLink>.</>}>
                <FaqPanel questions={questions} />
            </PageSection>
        </main>
    );
}
