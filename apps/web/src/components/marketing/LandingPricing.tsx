import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { KnownPages } from '../../knownPages';

// The approved pricing decision (brand.pricing, word for word). There is one offering and it is
// free: no tiers, prices, trials or limits are shown, because none exist.

const included = [
    'Comments pinned to elements and to selected text',
    'Replies from anyone on the page',
    'Resolve and reopen threads',
    'An inbox with every thread on the page',
    'No account, nothing to install'
];

export function LandingPricing() {
    return (
        <div className="flex flex-col gap-6 rounded-2xl border p-8 md:max-w-[420px]">
            <div className="flex flex-col gap-1">
                <h3 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Free</h3>
                <p className="text-sm text-muted-foreground">Everything {brand.name} does today.</p>
            </div>
            <ul className="flex flex-col gap-3 text-sm">
                {included.map(item => (
                    <li key={item} className="flex items-start gap-2.5">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0"><path d="M20 6 9 17l-5-5" /></svg>
                        {item}
                    </li>
                ))}
            </ul>
            <Button variant="solid" size="lg" href={KnownPages.GetStarted} className="self-start">Get started</Button>
        </div>
    );
}
