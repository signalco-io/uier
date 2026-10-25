import type { PropsWithChildren, ReactNode } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { Mark } from '@uier/brand/Mark';
import { LandingPricing } from '../../../src/components/marketing/LandingPricing';
import { LandingFaq } from '../../../src/components/marketing/LandingFaq';
import { KnownPages } from '../../../src/knownPages';
import { HEADLINE_COMMENT_ID } from '../../../src/lib/comments/publicProject';

// Copy and layout follow packages/brand/BRAND.md ("Marketing and metadata"): the tagline is the
// headline, the review layer is shown on the page itself instead of a screenshot. Every claim
// describes what the toolbar does on this page today; check packages/toolbar before adding one.

const steps = [
    {
        title: 'Open the page',
        text: 'The black toolbar sits at the bottom of the page. It runs in the browser: nothing to install, no account.'
    },
    {
        title: 'Click, or select, and write',
        text: 'Press + and click the element you mean, or select the exact words and choose Comment. The comment is pinned right there.'
    },
    {
        title: 'Reply and resolve',
        text: 'Anyone on the page can reply. When it is done, the author resolves the thread and it moves to the inbox.'
    }
];

function Icon({ children }: PropsWithChildren) {
    return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

const features: { title: string; text: string; icon: ReactNode }[] = [
    {
        title: 'Pinned to the element',
        text: 'A comment stays attached to the element it is about, not to a screenshot of it. Scroll, resize, reload: the pin is still there.',
        icon: <Mark size={22} />
    },
    {
        title: 'On the exact words',
        text: 'Select text and comment on just that. The words stay highlighted on the page and are quoted in the thread.',
        icon: <Icon><path d="M17 6H3" /><path d="M21 12H8" /><path d="M21 18H8" /><path d="M3 12v6" /></Icon>
    },
    {
        title: 'One thread per comment',
        text: 'Anyone on the page can reply, so the question and the answer stay in one place, next to what they are about.',
        icon: <Icon><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" /></Icon>
    },
    {
        title: 'Resolve when it is done',
        text: 'The author resolves a thread once it is handled, or reopens it. Resolved threads leave the page.',
        icon: <Icon><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></Icon>
    },
    {
        title: 'An inbox for the page',
        text: 'Every thread on the page in one list, open or resolved. The toolbar shows how many are still open.',
        icon: <Icon><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Icon>
    },
    {
        title: 'Works with a keyboard',
        text: 'Focus an element, press + and write. New comments and replies are announced to screen readers.',
        icon: <Icon><path d="M10 8h.01" /><path d="M12 12h.01" /><path d="M14 8h.01" /><path d="M16 12h.01" /><path d="M18 8h.01" /><path d="M6 8h.01" /><path d="M7 16h10" /><path d="M8 12h.01" /><rect width="20" height="16" x="2" y="4" rx="2" /></Icon>
    }
];

const tryIt = [
    'Press + in the toolbar at the bottom of the window, then click or tap anything on this page.',
    'Or select a few words and choose Comment.',
    'Write, then press Enter. Your comment is pinned where you left it.'
];

function SectionHeading({ id, title, lead }: { id: string; title: string; lead?: ReactNode; }) {
    return (
        <div className="flex max-w-[720px] flex-col gap-2">
            <h2 id={id} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
            {lead && <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>}
        </div>
    );
}

export default function LandingPage() {
    return (
        // The footer comes from the marketing layout, which also keeps the end of the page clear of the toolbar
        <main>
            <section className="flex flex-wrap items-start gap-12 py-12 md:py-20">
                <div className="flex min-w-0 flex-[1_1_560px] flex-col items-start gap-5">
                    <div className="relative inline-block pb-4 pr-12">
                        <h1 className="max-w-[700px] text-5xl font-semibold leading-none tracking-[-0.04em] md:text-[64px]">
                            Say it <span id="hero-comment-anchor">on the page.</span>
                        </h1>
                    </div>
                    <Typography component="p" className="max-w-[540px] text-lg leading-relaxed text-muted-foreground">
                        {brand.description}
                    </Typography>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                        <Button variant="solid" size="lg" href={KnownPages.GetStarted}>Get started</Button>
                        <Button variant="outlined" size="lg" href={KnownPages.HowItWorks}>How it works</Button>
                    </div>
                </div>
                <div className="min-w-[280px] flex-[0_1_320px]">
                    <div data-uier-thread={HEADLINE_COMMENT_ID} />
                </div>
            </section>

            <section aria-labelledby="how-it-works" className="flex flex-col gap-6">
                <SectionHeading id="how-it-works" title="How it works" />
                <ol className="grid grid-cols-1 gap-8 rounded-2xl border p-8 md:grid-cols-3">
                    {steps.map((step, index) => (
                        <li id={index === 0 ? 'first-step-comment-anchor' : undefined} key={step.title} className="relative flex flex-col gap-2.5">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <h3 className="text-lg font-semibold tracking-[-0.015em]">{step.title}</h3>
                            <Typography level="body2" className="text-muted-foreground">{step.text}</Typography>
                        </li>
                    ))}
                </ol>
            </section>

            <section aria-labelledby="features" className="flex flex-col gap-10 pt-16 md:pt-20">
                <SectionHeading
                    id="features"
                    title="What it does"
                    lead="Everything here works on this page right now, in the toolbar at the bottom of the window." />
                <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                    {features.map(feature => (
                        <div key={feature.title} className="flex flex-col gap-3">
                            <span className="text-foreground">{feature.icon}</span>
                            <h3 className="text-base font-semibold">{feature.title}</h3>
                            <Typography level="body2" className="text-muted-foreground">{feature.text}</Typography>
                        </div>
                    ))}
                </div>
            </section>

            <section aria-labelledby="get-started" className="flex flex-col gap-8 pt-16 md:pt-20">
                <SectionHeading
                    id="get-started"
                    title="Get started on this page"
                    lead={`${brand.name} is running here right now. Leave a comment to see how it works: no account, nothing to install.`} />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
                    <div className="flex flex-col gap-6 rounded-2xl border p-8">
                        <ol className="flex flex-col gap-4">
                            {tryIt.map((step, index) => (
                                <li key={step} className="flex items-baseline gap-4">
                                    <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                                    <span className="text-base">{step}</span>
                                </li>
                            ))}
                        </ol>
                        <p className="text-sm text-muted-foreground">
                            Comments on this site are public and anonymous. Visitor threads are deleted after 90 days.
                            The starter threads and their replies stay.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 rounded-2xl border p-8">
                        <h3 className="text-base font-semibold">On your own site</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            Create a project for your site, add one script tag and share a review link. Only the people
                            you invite can comment, or anyone with the link: you choose.
                        </p>
                        <Button variant="outlined" href={KnownPages.App} className="mt-2 self-start">Create a project</Button>
                    </div>
                </div>
            </section>

            <section aria-labelledby="pricing" className="flex flex-wrap items-start gap-x-12 gap-y-8 pt-16 md:pt-20">
                <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
                    <SectionHeading id="pricing" title="Free, and it stays free" lead={brand.pricing} />
                </div>
                <div className="flex-[1_1_320px] md:flex-[0_1_420px]">
                    <LandingPricing />
                </div>
            </section>

            <section aria-labelledby="faq" className="flex flex-col gap-6 pt-16 md:pt-20">
                <SectionHeading id="faq" title="Questions" />
                <LandingFaq />
            </section>
        </main>
    );
}
