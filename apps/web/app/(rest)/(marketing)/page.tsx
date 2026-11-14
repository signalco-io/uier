import { publicPageMetadata } from '@/src/lib/metadata';
import { SiteStructuredData } from '@/src/components/marketing/SiteStructuredData';
import type { ReactNode } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { ArrowRight, Bug, Filter, Layers, Lock, MyLocation, UI } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { InlineLink, Panel, SectionHeading } from '../../../src/components/marketing/ContentPage';
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
    ...publicPageMetadata('/', {
        description: 'Website feedback on the page: collect client comments, report bugs and hand the context to your team or coding agent.'
    }),
    title: { absolute: `Website feedback for client reviews and bug reports · ${brand.name}` },
    verification: { other: { 'msvalidate.01': '16CF0F06FF0F10896508557122F1DA5C' } }
};

// Copy and layout follow packages/brand/BRAND.md ("Marketing and metadata"): the tagline is the
// headline, the review layer is shown on the page itself instead of a screenshot. Every claim
// describes what the toolbar and the app do today; check packages/toolbar and src/lib before adding one.

// Each tile opens its feature's page: the "More on" line is the link, stretched over the whole tile,
// and the tile rises to the floating level while hovered (BRAND.md, "Borders and elevation")
const features: { title: string; text: ReactNode; visual: ReactNode; href: string; more: string; wide?: boolean }[] = [
    {
        title: 'Pinned to the element, an area or the words',
        text: 'Click anything, drag over an area or select a sentence, and pin a comment there. Pins follow the element when the page scrolls, resizes or reloads.',
        visual: <PinnedSpecimen />,
        href: KnownPages.PinnedComments,
        more: 'More on pinned comments',
        wide: true
    },
    {
        title: 'The context comes with it',
        text: 'A new comment attempts a screenshot of the spot. Check it for private details before posting. Members see available browser and device context; capture and browser details can be unavailable.',
        visual: <ContextSpecimen />,
        href: KnownPages.Screenshots,
        more: 'More on screenshots and context'
    },
    {
        title: 'Talk it through in the thread',
        text: 'Reply with Markdown and images, mention a teammate and assign the people who fix it. People who follow a thread get the replies by email.',
        visual: <ThreadSpecimen />,
        href: KnownPages.Threads,
        more: 'More on threads'
    },
    {
        title: 'One inbox for the whole site',
        text: 'Every thread on this page and on the rest of the site. Search, pick a page or an environment such as staging, and see what is unread or assigned to you.',
        visual: <InboxSpecimen />,
        href: KnownPages.Inbox,
        more: 'More on the inbox',
        wide: true
    },
    {
        title: 'From open to done',
        text: <>Follow each thread from Open through In progress to Done, in a list or on a board. <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> asks the reviewer to confirm a fix first.</>,
        visual: <BoardSpecimen />,
        href: KnownPages.Board,
        more: 'More on statuses and the board',
        wide: true
    },
    {
        title: 'Accessibility and SEO checks',
        text: 'Each page you review is checked for accessibility and SEO issues. Highlight what was found, then post it as a comment in one click.',
        visual: <ChecksSpecimen />,
        href: KnownPages.PageChecks,
        more: 'More on page checks'
    },
    {
        title: 'Send it where your team works',
        text: 'Copy a thread as a Markdown issue or connect a service for shared feedback. Each integration’s guide records its availability and verified scope; hosted checks for Azure DevOps delivery and optional reply import are still pending.',
        visual: <IntegrationsSpecimen />,
        href: KnownPages.Integrations,
        more: 'More on integrations'
    },
    {
        title: 'Let your coding agent fix it',
        text: 'Connect Claude Code, Codex or Cursor through the MCP connector. Your agent reads each thread with its page, anchor and screenshot, links its pull request and reports back when you approve.',
        visual: <AgentSpecimen />,
        href: KnownPages.Ai,
        more: `More on AI in ${brand.name}`,
        wide: true
    }
];

// Six details the feature tiles above do not show, each with an outlined icon from @signalco/ui-icons.
// Keep it to six: two rows of three at lg, three of two at md.
const details: { title: string; text: ReactNode; icon: ReactNode }[] = [
    {
        title: 'Bulk triage',
        text: <>Search, set a priority and update many threads at once. More on <InlineLink href={KnownPages.FeedbackTriage}>triage</InlineLink>.</>,
        icon: <Filter size={20} strokeWidth={1.75} />
    },
    {
        title: 'Feedback without a pin',
        text: 'Send feedback, bug reports and types of your own about the whole page.',
        icon: <Bug size={20} strokeWidth={1.75} />
    },
    {
        title: 'Staging and production apart',
        text: 'Each comment knows its environment, so you can filter by one.',
        icon: <Layers size={20} strokeWidth={1.75} />
    },
    {
        title: 'Reattach a comment',
        text: 'When its element is gone after a redesign, pin the comment to the new one.',
        icon: <MyLocation size={20} strokeWidth={1.75} />
    },
    {
        title: 'Private details covered',
        text: 'Replace a screenshot, or cover what should not be in it.',
        icon: <Lock size={20} strokeWidth={1.75} />
    },
    {
        title: 'Keyboard and screen readers',
        text: 'Shortcuts in the app and the toolbar, and both work with screen readers.',
        icon: <UI size={20} strokeWidth={1.75} />
    }
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

/** A feature tile's link: its area covers the tile, and its focus ring the tile's edge (like /integrations' tiles) */
const tileLink = 'mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring';

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
                        <Button variant="outlined" size="lg" href={KnownPages.Features}>See features</Button>
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
                        <div key={feature.title} className={cx(
                            'group relative flex flex-col overflow-hidden rounded-2xl border transition-[border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
                            // Floating, from BRAND.md: the border plus its shadow on light, the border alone lifts it on dark
                            'hover:border-foreground/20 hover:shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:hover:shadow-none',
                            feature.wide && 'md:col-span-2'
                        )}>
                            {feature.visual}
                            <div className="flex flex-1 flex-col gap-2 p-6">
                                <h3 className="text-base font-semibold">{feature.title}</h3>
                                {/* A link in the text stays clickable above the tile's link */}
                                <Typography level="body2" className="text-muted-foreground [&_a]:relative [&_a]:z-[1]">{feature.text}</Typography>
                                <a href={feature.href} className={tileLink}>
                                    {feature.more}
                                    <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" className="text-muted-foreground transition-colors duration-[120ms] ease-out group-hover:text-foreground" />
                                </a>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-5">
                    <h3 className="text-xl font-semibold tracking-[-0.015em]">And the details</h3>
                    <Panel as="ul" className="md:grid-cols-2 lg:grid-cols-3">
                        {details.map(detail => (
                            <li key={detail.title} className="flex flex-col gap-2 p-6">
                                <span aria-hidden="true" className="mb-2 flex size-9 items-center justify-center rounded-lg border text-muted-foreground">{detail.icon}</span>
                                <h4 className="text-base font-semibold">{detail.title}</h4>
                                <p className="text-sm leading-relaxed text-muted-foreground">{detail.text}</p>
                            </li>
                        ))}
                    </Panel>
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
