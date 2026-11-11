import { publicPageMetadata } from '@/src/lib/metadata';
import { SiteStructuredData } from '@/src/components/marketing/SiteStructuredData';
import type { ReactNode } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, SectionHeading } from '../../../src/components/marketing/ContentPage';
import { HowItWorks } from '../../../src/components/marketing/HowItWorks';
import { LandingPricing } from '../../../src/components/marketing/LandingPricing';
import { LandingFaq } from '../../../src/components/marketing/LandingFaq';
import { AgentSpecimen } from '../../../src/components/marketing/AiSpecimens';
import {
    BoardSpecimen,
    ContextSpecimen,
    InboxSpecimen,
    IntegrationsSpecimen,
    PinnedSpecimen,
    ThreadSpecimen
} from '../../../src/components/marketing/LandingSpecimens';
import { ChecksSpecimen } from '../../../src/components/marketing/ChecksSpecimens';
import { KnownPages } from '../../../src/knownPages';
import { extensionStoreUrl } from '../../../src/lib/extension/release';

export const metadata = {
    ...publicPageMetadata('/'),
    verification: { other: { 'msvalidate.01': '16CF0F06FF0F10896508557122F1DA5C' } }
};

// Copy and layout follow packages/brand/BRAND.md ("Marketing and metadata"): the tagline is the
// headline, the review layer is shown on the page itself instead of a screenshot. Every claim
// describes what the toolbar and the app do today; check packages/toolbar and src/lib before adding one.

const features: { title: string; text: ReactNode; visual: ReactNode; wide?: boolean }[] = [
    {
        title: 'Pinned to the element, an area or the words',
        text: 'Click anything, drag over an area or select a sentence, and pin a comment there. Pins follow the element when the page scrolls, resizes or reloads.',
        visual: <PinnedSpecimen />,
        wide: true
    },
    {
        title: 'The context comes with it',
        text: 'A new comment captures a screenshot of the spot, with the page, the window size, the browser and the operating system. Or attach your own image.',
        visual: <ContextSpecimen />
    },
    {
        title: 'Talk it through in the thread',
        text: 'Reply with Markdown and images, mention a teammate and assign the people who fix it. People who follow a thread get the replies by email.',
        visual: <ThreadSpecimen />
    },
    {
        title: 'One inbox for the whole site',
        text: 'Every thread on this page and on the rest of the site. Search, pick a page or an environment such as staging, and see what is unread or assigned to you.',
        visual: <InboxSpecimen />,
        wide: true
    },
    {
        title: 'From open to done',
        text: <>Follow each thread from Open through In progress to Done, in a list or on a board. <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> asks the reviewer to confirm a fix first.</>,
        visual: <BoardSpecimen />,
        wide: true
    },
    {
        title: 'Accessibility and SEO checks',
        text: <>Each page you review is checked for accessibility and SEO issues. Highlight what was found, then post it as a comment in one click. More on <InlineLink href={KnownPages.PageChecks}>page checks</InlineLink>.</>,
        visual: <ChecksSpecimen />
    },
    {
        title: 'Send it where your team works',
        text: <>Send shared threads to GitHub, Linear, Notion, Azure DevOps or Slack with their page context, or copy one as a Markdown issue. More on <InlineLink href={KnownPages.Integrations}>integrations</InlineLink>.</>,
        visual: <IntegrationsSpecimen />
    },
    {
        title: 'Let your coding agent fix it',
        text: <>Connect Claude Code, Codex or Cursor through the MCP connector. Your agent reads each thread with its page, anchor and screenshot, links its pull request and reports back when you approve. More on <InlineLink href={KnownPages.Ai}>AI in {brand.name}</InlineLink>.</>,
        visual: <AgentSpecimen />,
        wide: true
    }
];

const details: ReactNode[] = [
    <>Search, priority and <InlineLink href={KnownPages.FeedbackTriage}>bulk triage</InlineLink> in the app</>,
    <><InlineLink href={`${KnownPages.Ai}#rewrite-suggestions`}>AI rewrite suggestions</InlineLink> for selected text</>,
    'Short AI titles for threads in lists',
    'Feedback, bug reports and types of your own, without a pin',
    'Staging and production apart, by environment',
    'Pull requests linked to their threads',
    'Replace a screenshot or cover private details',
    'Drafts kept in your browser for seven days',
    'Reattach a comment when its element is gone',
    'A history of each thread’s changes',
    'Clients and teams to organize projects and access',
    'Join a workspace through your email domain',
    'Sign in with an email code, Google, Microsoft or a passkey',
    'Keyboard shortcuts in the app and the toolbar',
    'Works with screen readers'
];

// The install guide's tabs (src/components/app/projects/InstallGuide.tsx)
const platforms = ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'];

// The desktop browser extension's browsers (docs/browser-extension.md): Chrome and Edge install from
// the Chrome Web Store; Firefox gets a link only once Mozilla approves the add-on.
const extensionBrowsers: { name: string; href?: string; note?: string }[] = [
    { name: 'Chrome', href: extensionStoreUrl },
    { name: 'Edge', href: extensionStoreUrl },
    { name: 'Firefox', note: 'in review' }
];

const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium';

const tryIt = [
    'Press + in the toolbar at the bottom of the window, then click or tap anything on this page.',
    'Or select a few words and choose Comment.',
    'Write, then press Enter. Your comment is pinned where you left it.'
];

export default function LandingPage() {
    return (
        // The footer comes from the marketing layout, which also keeps the end of the page clear of the toolbar
        <main>
            <SiteStructuredData />
            {/* The cover: the headline beside the how-it-works scene. The description stays a direct
                child of the first column (e2e tests select it as main>section>div>p) */}
            <section className="grid grid-cols-1 items-center gap-12 py-12 md:py-20 lg:grid-cols-2 lg:gap-16 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="flex min-w-0 flex-col items-start gap-5">
                    <div className="relative inline-block pb-4 pr-12">
                        <h1 className="max-w-[700px] text-5xl font-semibold leading-none tracking-[-0.04em] md:text-[64px]">
                            {/* Two lines beside the cover; a forced break would overflow narrow phones */}
                            <span className="lg:block">Say it</span>{' '}<span id="hero-comment-anchor">on the page.</span>
                        </h1>
                    </div>
                    <Typography component="p" className="max-w-[440px] text-lg leading-relaxed text-muted-foreground">
                        {brand.shortDescription}
                    </Typography>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                        {/* Like the navigation's Sign in: sign in, or straight into the app when signed in */}
                        <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                        <Button variant="outlined" size="lg" href={KnownPages.HowItWorks}>How it works</Button>
                    </div>
                </div>
                <HowItWorks />
            </section>

            <section aria-labelledby="features" className="flex flex-col gap-10 pt-16 md:pt-24">
                <SectionHeading
                    id="features"
                    title="What it does"
                    lead="Pins, threads, screenshots, the inbox and the page checks are in the toolbar at the bottom of this window, so you can try them right here. The board, assignments and integrations are in your projects." />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {features.map(feature => (
                        <div key={feature.title} className={cx('flex flex-col overflow-hidden rounded-2xl border', feature.wide && 'md:col-span-2')}>
                            {feature.visual}
                            <div className="flex flex-col gap-2 p-6">
                                <h3 className="text-base font-semibold">{feature.title}</h3>
                                <Typography level="body2" className="text-muted-foreground">{feature.text}</Typography>
                            </div>
                        </div>
                    ))}
                    <div className="flex flex-col gap-5 rounded-2xl border p-6 md:col-span-2 lg:col-span-3">
                        <h3 className="text-base font-semibold">And the details</h3>
                        <CheckList items={details} columns={3} />
                    </div>
                </div>
                <p className="max-w-[720px] text-base leading-relaxed text-muted-foreground">
                    Choosing a tool for your team? <InlineLink href={KnownPages.Compare}>Compare website feedback tools</InlineLink> by review workflow, bug reporting and the features each one supports.
                </p>
            </section>

            <section aria-labelledby="get-started" className="flex flex-col gap-10 pt-16 md:pt-24">
                <SectionHeading
                    id="get-started"
                    title="Get started"
                    lead={`Try ${brand.name} on this page first: no account, nothing to install. When you are ready, add it to your own site.`} />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* The starter thread "Try it here" (src/lib/comments/publicProject.ts) is pinned to this box by its id */}
                    <div id="first-step-comment-anchor" className="flex flex-col gap-6 rounded-2xl border p-8">
                        <h3 className="text-xl font-semibold tracking-[-0.015em]">Try it on this page</h3>
                        <ol className="flex flex-col gap-4">
                            {tryIt.map((step, index) => (
                                <li key={step} className="flex items-baseline gap-4">
                                    <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                                    <span className="text-base">{step}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                    <div className="flex flex-col gap-6 rounded-2xl border p-8">
                        <div className="flex flex-col gap-2">
                            <h3 className="text-xl font-semibold tracking-[-0.015em]">Review your own site</h3>
                            <p className="text-base leading-relaxed text-muted-foreground">
                                Sign in with your email, Google, Microsoft or a passkey, create a project and invite your team. The install guide in the
                                app has the steps for your site:
                            </p>
                        </div>
                        <ul aria-label="Install guides" className="flex flex-wrap gap-2">
                            {platforms.map(platform => (
                                <li key={platform} className={chip}>{platform}</li>
                            ))}
                        </ul>
                        <div className="flex flex-col gap-3">
                            <p className="text-base leading-relaxed text-muted-foreground">
                                Cannot change the site? Review it with the <InlineLink href={KnownPages.BrowserExtension}>browser extension</InlineLink>:
                            </p>
                            <ul aria-label="Browser extension" className="flex flex-wrap gap-2">
                                {extensionBrowsers.map(browser => (
                                    <li key={browser.name}>
                                        {browser.href
                                            ? <a href={browser.href} className={cx(chip, 'transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2')}>{browser.name}</a>
                                            : <span className={chip}>{browser.name}<span className="font-normal text-muted-foreground">{browser.note}</span></span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <Button variant="solid" href={KnownPages.App} className="mt-auto self-start">Create a project</Button>
                    </div>
                </div>
            </section>

            <section aria-labelledby="pricing" className="pt-16 md:pt-24">
                <LandingPricing />
            </section>

            <section aria-labelledby="faq" className="grid grid-cols-1 items-start gap-10 pt-16 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
                <div className="lg:sticky lg:top-24">
                    <SectionHeading
                        id="faq"
                        title="Questions"
                        lead={<>Something missing? <InlineLink href={brand.issues}>Open an issue on GitHub</InlineLink> or email <InlineLink href={`mailto:${brand.contact.email}`}>{brand.contact.email}</InlineLink>.</>} />
                </div>
                <LandingFaq />
            </section>
        </main>
    );
}
