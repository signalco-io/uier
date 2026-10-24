import { Typography } from '@signalco/ui-primitives/Typography';
import { Stack } from '@signalco/ui-primitives/Stack';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { Pin } from '@uier/brand/Pin';
import { Mark } from '@uier/brand/Mark';
import { Footer1 } from '../../../src/components/marketing/Footer1';
import { ReviewThreadDemo } from '../../../src/components/marketing/ReviewThreadDemo';
import { KnownPages } from '../../../src/knownPages';
import { ToolbarScript } from '../../../src/components/toolbar/ToolbarScript';

// Copy and layout follow packages/brand/BRAND.md ("Marketing and metadata"): the tagline is the
// headline, the review layer is shown on the page itself instead of a screenshot.

const steps = [
    {
        title: 'Add one script tag',
        text: 'Drop the uier script into your site. It does nothing until a page is opened with ?review=true, so visitors never see it.'
    },
    {
        title: 'Share a review link',
        text: 'Reviewers open the link in their own browser. The black toolbar appears at the bottom of the page, nothing to install.',
        pin: 1
    },
    {
        title: 'Click, or select, and write',
        text: 'Pin a comment to an element or to the exact words. It lands in the site’s inbox with the browser and viewport it came from.'
    }
];

const features = [
    {
        title: 'Pinned to the element',
        text: 'The comment follows the element it is about, not a screenshot of it. Resize, scroll, reload: it is still there.',
        icon: <Mark size={22} />
    },
    {
        title: 'Context comes along',
        text: 'Browser, system and viewport are saved with every comment, so “looks broken on my laptop” is never a guess.',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
        )
    },
    {
        title: 'One inbox per domain',
        text: 'Comments are stored per domain, so every page of a site shares one list and one resolved state.',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
        )
    }
];

export default function LandingPage() {
    return (
        <main>
            <section className="flex flex-wrap items-start gap-12 py-12 md:py-20">
                <div className="flex min-w-0 flex-[1_1_560px] flex-col items-start gap-5">
                    <div className="relative inline-block pr-12">
                        <h1 className="max-w-[700px] text-5xl font-semibold leading-none tracking-[-0.04em] md:text-[64px]">
                            Say it <span className="-mx-1 rounded-md bg-[hsl(var(--brand-selection))] px-1">on the page.</span>
                        </h1>
                        <Pin count={2} className="absolute -top-1 right-0" label="Comment on the headline, 2 messages" />
                    </div>
                    <Typography component="p" className="max-w-[540px] text-lg leading-relaxed text-muted-foreground">
                        {brand.description}
                    </Typography>
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                        <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                        <Button variant="outlined" size="lg" href="#how-it-works">How it works</Button>
                    </div>
                </div>
                <div className="min-w-[280px] flex-[0_1_320px]">
                    <ReviewThreadDemo />
                </div>
            </section>

            <section id="how-it-works" className="grid grid-cols-1 gap-8 rounded-2xl border p-8 md:grid-cols-3">
                {steps.map((step, index) => (
                    <div key={step.title} className="relative flex flex-col gap-2.5">
                        <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                        <Typography level="h3" component="h2" className="text-lg tracking-[-0.015em]">{step.title}</Typography>
                        <Typography level="body2" className="text-muted-foreground">{step.text}</Typography>
                        {step.pin && <Pin count={step.pin} className="absolute -right-2 -top-4" label="Comment on this step, 1 message" />}
                    </div>
                ))}
            </section>

            <section className="grid grid-cols-1 gap-8 py-16 md:grid-cols-3 md:py-20">
                {features.map(feature => (
                    <Stack key={feature.title} spacing={1.5}>
                        <span className="text-foreground">{feature.icon}</span>
                        <Typography level="h4" component="h2" className="text-base">{feature.title}</Typography>
                        <Typography level="body2" className="text-muted-foreground">{feature.text}</Typography>
                    </Stack>
                ))}
            </section>

            <Footer1
                features={[
                    {
                        header: 'Product',
                        ctas: [
                            { label: 'uier', href: KnownPages.App },
                            { label: 'Brand', href: KnownPages.Brand },
                            { label: 'GitHub', href: brand.repository }
                        ]
                    },
                    {
                        header: 'Legal',
                        ctas: [
                            { label: 'Privacy Policy', href: KnownPages.LegalPrivacyPolicy },
                            { label: 'Terms of Service', href: KnownPages.LegalTermsOfService },
                            { label: 'Cookie Policy', href: KnownPages.LegalCookiePolicy },
                            { label: 'Acceptable Use Policy', href: KnownPages.LegalAcceptableUsePolicy },
                            { label: 'SLA', href: KnownPages.LegalSla }
                        ]
                    }
                ]} />
            {/* Showcase: the real uier toolbar runs on the landing page and anyone can leave public feedback */}
            <ToolbarScript mode="showcase" />
        </main>
    );
}
