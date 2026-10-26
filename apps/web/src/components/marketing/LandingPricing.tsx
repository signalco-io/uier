import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';
import { CheckList, InlineLink, Panel } from './ContentPage';

// The approved pricing decision (brand.pricing, word for word). There is one offering and it is
// free: no tiers, prices, trials or limits are shown, because none exist. So this is a statement
// with what it covers, not a plan card.

const included = [
    'Projects for your sites, with review links',
    'Your team and reviewers, invited by email',
    'Comments on elements and selected text',
    'Screenshots and browser details with new comments',
    'Replies, mentions and assignment',
    'Email notifications for the threads you follow',
    'An inbox for every page of the site',
    'Issue export and the MCP connector'
];

/** The pricing section's content: its `h2` has the id `pricing` the section is labelled by */
export function LandingPricing() {
    return (
        <Panel className="lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex flex-col items-start gap-5 p-8 md:p-10">
                <h2 id="pricing" className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">Free, and it stays free</h2>
                <p className="text-base leading-relaxed text-muted-foreground">{brand.pricing}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-3">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <span className="text-sm text-muted-foreground">The code is <InlineLink href={KnownPages.OpenSource}>open source</InlineLink>.</span>
                </div>
            </div>
            <div className="flex flex-col gap-5 bg-muted/50 p-8 md:p-10">
                <h3 className="text-base font-semibold">Included today</h3>
                <CheckList items={included} columns={2} />
            </div>
        </Panel>
    );
}
