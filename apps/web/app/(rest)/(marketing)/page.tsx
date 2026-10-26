import type { ReactNode } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, SectionHeading } from '../../../src/components/marketing/ContentPage';
import { HowItWorks } from '../../../src/components/marketing/HowItWorks';
import { LandingPricing } from '../../../src/components/marketing/LandingPricing';
import { LandingFaq } from '../../../src/components/marketing/LandingFaq';
import {
    ContextSpecimen,
    EnvironmentsSpecimen,
    HandoffSpecimen,
    InboxSpecimen,
    PinnedSpecimen,
    ThreadSpecimen
} from '../../../src/components/marketing/LandingSpecimens';
import { KnownPages } from '../../../src/knownPages';
import { HEADLINE_COMMENT_ID } from '../../../src/lib/comments/publicProject';

// Copy and layout follow packages/brand/BRAND.md ("Marketing and metadata"): the tagline is the
// headline, the review layer is shown on the page itself instead of a screenshot. Every claim
// describes what the toolbar and the app do today; check packages/toolbar and src/lib before adding one.

const features: { title: string; text: string; visual: ReactNode; wide?: boolean }[] = [
    {
        title: 'Pinned to the element, or to the words',
        text: 'Click anything to pin a comment to it, or select a sentence and comment on just that. Pins follow the element when the page scrolls, resizes or reloads.',
        visual: <PinnedSpecimen />,
        wide: true
    },
    {
        title: 'The context comes with it',
        text: 'A new comment captures a screenshot of the spot, with the page, the browser, the operating system and the window size it was left from.',
        visual: <ContextSpecimen />
    },
    {
        title: 'Talk it through in the thread',
        text: 'Reply, mention a teammate and assign the thread to whoever fixes it. People who follow a thread get the replies by email.',
        visual: <ThreadSpecimen />
    },
    {
        title: 'One inbox for the whole site',
        text: 'Every thread on this page and on the rest of the site, open or done. Filter, search and see what is new since you last looked.',
        visual: <InboxSpecimen />,
        wide: true
    },
    {
        title: 'Hand it to a developer, or an agent',
        text: 'Copy a thread as a Markdown issue with the page, the anchor and the browser details. AI agents read feedback through the MCP connector, with the access you give them.',
        visual: <HandoffSpecimen />
    },
    {
        title: 'Staging and production apart',
        text: 'Label each address of a project and filter feedback by environment, so notes on staging stay out of production.',
        visual: <EnvironmentsSpecimen />
    }
];

const details = [
    'Rewrite suggestions for selected text',
    'Feedback and bug reports without a pin',
    'Replace a screenshot or cover private details',
    'Drafts kept in your browser for seven days',
    'Reattach a comment when its element is gone',
    'Works with a keyboard and screen readers'
];

// The install guide's tabs (src/components/app/projects/InstallGuide.tsx)
const platforms = ['HTML', 'Next.js', 'React', 'WordPress', 'Webflow', 'Shopify'];

const tryIt = [
    'Press + in the toolbar at the bottom of the window, then click or tap anything on this page.',
    'Or select a few words and choose Comment.',
    'Write, then press Enter. Your comment is pinned where you left it.'
];

export default function LandingPage() {
    return (
        // The footer comes from the marketing layout, which also keeps the end of the page clear of the toolbar
        <main>
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
                    lead="Pins, threads, screenshots and the inbox are in the toolbar at the bottom of this window, so you can try them right here." />
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
                    <div className="flex flex-col gap-5 rounded-2xl border p-6 md:col-span-2 lg:col-span-1">
                        <h3 className="text-base font-semibold">And the details</h3>
                        <CheckList items={details} />
                    </div>
                </div>
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
                        {/* The headline's thread, open and live: reply right here (the toolbar renders it) */}
                        <div data-uier-thread={HEADLINE_COMMENT_ID} />
                        <p className="mt-auto text-sm text-muted-foreground">
                            Comments on this site are public and anonymous. Visitor threads are deleted after 90 days.
                            The starter threads and their replies stay.
                        </p>
                    </div>
                    <div className="flex flex-col gap-6 rounded-2xl border p-8">
                        <div className="flex flex-col gap-2">
                            <h3 className="text-xl font-semibold tracking-[-0.015em]">Review your own site</h3>
                            <p className="text-base leading-relaxed text-muted-foreground">
                                Sign in with your email, create a project and invite your team. The install guide in the
                                app has the steps for your site:
                            </p>
                        </div>
                        <ul aria-label="Install guides" className="flex flex-wrap gap-2">
                            {platforms.map(platform => (
                                <li key={platform} className="inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium">{platform}</li>
                            ))}
                        </ul>
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
