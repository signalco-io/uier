import { useSyncExternalStore } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { LoaderSpinner } from '@signalco/ui-icons';
import { auditAvailable } from '../../../checks/axeLoader';
import { largestPaintElement } from '../../../checks/webVitals';
import { CheckItem } from '../ChecksParts';
import { defineSection, useSection, type SectionDefinition, type SectionState } from './sections';

// More of the SEO panel's own Page, Links and Images sections, from the on-demand checks
// (src/checks/lazy/pageExtras.ts, docs/page-checks-seo-page.md): hreflang, image weight and links
// that do not answer. They have no card of their own: `SeoPanel` shows their rows in its sections.

/** Page: the hreflang tags. A read of the head without requests, so with the background checks */
export const hreflangSection = defineSection({
    id: 'seo-hreflang', panel: 'seo', when: 'background',
    run: (checks, context) => checks.pageExtras.checkHreflang(context)
});

/** Images: dimensions, size, loading and weight. It reads every image's box and style, so when the panel opens */
export const imagesSection = defineSection({
    id: 'seo-images', panel: 'seo', when: 'panel',
    // The largest contentful element is known here: the audit asset has its own copy of every module
    run: (checks, context) => checks.pageExtras.checkImages(context, { largestPaint: largestPaintElement() })
});

// Check links' progress and its Stop, beside the sections' store (which knows only "checking")
let progress: { checked: number; total: number } | undefined;
let stopControl: AbortController | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** Links: requests this page's links to its own site, a few at a time, only when Check links is pressed */
export const linkStatusSection = defineSection({
    id: 'seo-link-status', panel: 'seo', when: 'manual',
    run: (checks, context) => {
        const stop = stopControl = new AbortController();
        const report = (value: typeof progress) => {
            if (stopControl !== stop) return;
            progress = value;
            for (const listener of listeners) listener();
        };
        report(undefined);
        return checks.pageExtras.checkLinkStatus(context, { stop: stop.signal, onProgress: (checked, total) => report({ checked, total }) })
            .finally(() => { if (stopControl === stop) stopControl = undefined; });
    }
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const pageExtrasSections: readonly SectionDefinition[] = [hreflangSection, imagesSection, linkStatusSection];

/** A section's rows inside one of the panel's own sections: its checks, or a line while its first check runs or after it failed */
function SectionRows({ section, checking }: { section: SectionState; checking?: string }) {
    if (section.report) return <>{section.report.checks.map(check => <CheckItem key={check.id} check={check} />)}</>;
    if (section.status === 'failed' || (checking && section.status === 'checking')) {
        return (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                {section.status === 'checking' && <LoaderSpinner size={14} aria-hidden="true" className="motion-safe:animate-spin" />}
                {section.status === 'checking' ? checking : 'This could not be checked. Check again to retry.'}
            </li>
        );
    }
    return null;
}

/** The Page section's hreflang row, on a page with hreflang tags */
export function HreflangRows() {
    return <SectionRows section={useSection(hreflangSection)} />;
}

/** The Images section's rows on dimensions, size, loading and weight */
export function ImageRows() {
    return <SectionRows section={useSection(imagesSection)} checking="Checking the images..." />;
}

/**
 * The Links section's Check links: its results, then the control (Stop while it runs) with its
 * progress in a status ("Checked 37 of 100"). One button changes its name, so the focus stays on it.
 */
export function LinkStatusRows() {
    const section = useSection(linkStatusSection);
    const current = useSyncExternalStore(subscribe, () => progress);
    if (!auditAvailable()) return null;
    const checking = section.status === 'checking';
    const done = section.report?.details;
    const status = checking ? current ? `Checked ${current.checked} of ${current.total}` : 'Checking the links...'
        : section.status === 'failed' ? 'The links could not be checked.'
            : done ? done.blocked ? 'Not checked.' : !done.total ? 'No links to check on this site.'
                : `${done.stopped ? 'Stopped after' : 'Checked'} ${done.checked} of ${done.total}.`
                : 'Requests the links to this site\'s pages to find the ones that answer with an error.';
    return <>
        {!checking && <SectionRows section={section} />}
        <li className="flex min-w-0 items-center gap-2 px-3 py-2" data-uier-link-check="">
            {checking && <LoaderSpinner size={14} aria-hidden="true" className="shrink-0 text-muted-foreground motion-safe:animate-spin" />}
            <p role="status" className="m-0 min-w-0 flex-1 text-xs tabular-nums text-muted-foreground">{status}</p>
            <Button size="xs" variant="outlined" className="shrink-0 pointer-coarse:min-h-11"
                onClick={checking ? () => stopControl?.abort() : section.run}>
                {checking ? 'Stop' : done ? 'Check links again' : 'Check links'}
            </Button>
        </li>
    </>;
}
