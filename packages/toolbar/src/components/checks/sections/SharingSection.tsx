import { useState } from 'react';
import type { SharingPreview } from '../../../checks/lazy/sharing';
import type { PageCheck } from '../../../checks/types';
import { defineSection, ReportSection, useSection, type SectionDefinition, type SectionState } from './sections';

// The SEO panel's Sharing section: Open Graph and X card tags, the search result snippet and the shared
// image (src/checks/lazy/sharing.ts, packages/toolbar/docs/page-checks-seo-head.md). Reading the tags is
// a few milliseconds without a request, so it runs in the background; loading the image is a request,
// so it runs when the panel opens.

export const sharingSection = defineSection({
    id: 'sharing', panel: 'seo', when: 'background',
    run: (checks, context) => checks.sharing.checkSharing(context)
});

export const sharingImageSection = defineSection({
    id: 'sharing-image', panel: 'seo', when: 'panel',
    run: (checks, context) => checks.sharing.checkSharingImage(context)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const sharingSections: readonly SectionDefinition[] = [sharingSection, sharingImageSection];

/** The image's row while it loads or when it could not be checked; its report's once it has one */
function imageRows(image: SectionState): PageCheck[] {
    if (image.report) return image.report.checks;
    if (image.status !== 'checking' && image.status !== 'failed') return [];
    return [{
        id: 'share-image-size', label: 'Image size', state: 'none', issues: [],
        reason: image.status === 'checking' ? 'Loading the image...' : 'This could not be checked. Check again to retry.'
    }];
}

/** The shared image in the card, or a plain box when the site's CSP or the network keeps it from loading here */
function PreviewImage({ src }: { src: string }) {
    const [failed, setFailed] = useState(false);
    return (
        <div className="flex aspect-[1.91/1] items-center justify-center bg-muted">
            {failed ? <span className="text-xs text-muted-foreground">Image not shown here</span> : (
                // The card's text says what it is about
                <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" onError={() => setFailed(true)} />
            )}
        </div>
    );
}

/** Neutral cards in the toolbar's own tokens: they illustrate, they do not imitate any platform */
function Previews({ preview: { search, card } }: { preview: SharingPreview }) {
    const caption = 'm-0 text-xs text-muted-foreground';
    const empty = <span className="italic text-muted-foreground">No description</span>;
    return (
        <li className="flex flex-col gap-3 px-3 py-2.5">
            <figure className="m-0 flex flex-col gap-1.5" data-uier-preview="search">
                <figcaption className={caption}>About how a search result looks</figcaption>
                <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5">
                    <p className="m-0 truncate text-xs text-foreground">{search.site}</p>
                    <p className="m-0 truncate text-xs text-muted-foreground">{search.address}</p>
                    <p className="m-0 break-words text-sm font-medium text-foreground">{search.title || 'No title'}</p>
                    <p className="m-0 line-clamp-2 break-words text-xs text-secondary-foreground">{search.description || empty}</p>
                </div>
            </figure>
            <figure className="m-0 flex flex-col gap-1.5" data-uier-preview="card">
                <figcaption className={caption}>About how a shared link looks</figcaption>
                <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
                    {card.image && <PreviewImage key={card.image} src={card.image} />}
                    <div className="flex min-w-0 flex-col gap-0.5 p-2.5">
                        <p className="m-0 truncate text-xs text-muted-foreground">{card.site}</p>
                        <p className="m-0 line-clamp-2 break-words text-sm font-medium text-foreground">{card.title || 'No title'}</p>
                        <p className="m-0 line-clamp-2 break-words text-xs text-secondary-foreground">{card.description || empty}</p>
                    </div>
                </div>
            </figure>
        </li>
    );
}

export function SharingSection() {
    const tags = useSection(sharingSection);
    const image = useSection(sharingImageSection);
    const { report } = tags;
    // The image's row goes right after the image's tag
    const at = report ? report.checks.findIndex(check => check.id === 'share-image') + 1 || report.checks.length : 0;
    const section = report ? { ...tags, report: { ...report, checks: [...report.checks.slice(0, at), ...imageRows(image), ...report.checks.slice(at)] } } : tags;
    return (
        <ReportSection id={sharingSection.id} title="Sharing" section={section}>
            {report?.details && <Previews preview={report.details} />}
        </ReportSection>
    );
}
