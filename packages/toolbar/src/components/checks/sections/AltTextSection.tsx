import { useContext, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { MyLocation, Warning } from '@signalco/ui-icons';
import type { AltTextDetails, AltTextImage } from '../../../checks/lazy/altText';
import type { SectionReport } from '../../../checks/lazy/api';
import type { PageIssue } from '../../../checks/types';
import { IconTooltip } from '../../IconTooltip';
import { ChecksContext } from '../ChecksParts';
import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The Accessibility panel's Alt text section: every image beside its alt text, and the alt texts that
// say nothing (src/checks/lazy/altText.ts, packages/toolbar/docs/page-checks-content.md). The flags are
// string work, so they run in the background and count on the button; thumbnails render only here.

export const altTextSection = defineSection<SectionReport<AltTextDetails>>({
    id: 'altText', panel: 'accessibility', when: 'background',
    run: (checks, context) => checks.altText.checkAltText(context)
});

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const altTextSections: readonly SectionDefinition[] = [altTextSection];

/** Images listed before "Show all" */
const firstImages = 8;

/** A drawn image, like Lucide's (the kit has none): the placeholder of an image without an address to show */
function ImageIcon() {
    return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
        </svg>
    );
}

/**
 * A small copy of the image from the address the page itself loaded, without a referrer; a neutral
 * placeholder for an inline svg, an element without an address, or an address that does not load
 */
function Thumbnail({ src }: { src?: string }) {
    const [failed, setFailed] = useState<string>();
    return (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-card text-muted-foreground">
            {src && failed !== src
                ? <img src={src} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain" onError={() => setFailed(src)} />
                : <ImageIcon />}
        </span>
    );
}

/** One image: its thumbnail, what a screen reader reads for it, its short name and Highlight */
function ImageItem({ image }: { image: AltTextImage }) {
    const { highlighted, highlight } = useContext(ChecksContext);
    const key = image.key;
    return (
        <li className="flex min-w-0 items-center gap-2 rounded-lg bg-muted py-1 pl-1 pr-1" data-uier-image={image.state}>
            <Thumbnail src={image.src} />
            <div className="min-w-0 flex-1">
                <p className={cx('m-0 line-clamp-2 break-words text-xs', image.state === 'text' ? 'text-foreground' : 'text-muted-foreground')} title={image.alt}>
                    {image.flags.length > 0 && <><Warning size={12} aria-hidden="true" className="mr-1 inline align-[-1px] text-[hsl(var(--brand-warning))]" /><span className="sr-only">Flagged above: </span></>}
                    {image.state === 'text' ? `"${image.alt}"` : image.state === 'decorative' ? 'Decorative' : 'No alt text (in the audit above)'}
                </p>
                <p className="m-0 truncate font-mono text-xs text-muted-foreground" title={image.label}>{image.label}</p>
            </div>
            <IconTooltip label="Highlight">
                <IconButton size="xs" variant="plain" aria-label="Highlight" aria-pressed={highlighted === key}
                    className={cx('shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:size-11', highlighted === key && 'bg-accent text-foreground')}
                    onClick={() => highlight({ key, element: image.target } as PageIssue)}>
                    <MyLocation size={14} aria-hidden="true" />
                </IconButton>
            </IconTooltip>
        </li>
    );
}

/** The page's images, the first few and then all of them */
function ImageList({ images }: { images: AltTextImage[] }) {
    const [all, setAll] = useState(false);
    if (!images.length) return null;
    return (
        <li className="flex min-w-0 flex-col gap-1 px-3 py-2">
            <p className="m-0 text-xs text-muted-foreground">Only a person can tell whether alt text says what its image shows. Decorative images should say nothing.</p>
            <ul aria-label="Images and their alt text" className="m-0 flex list-none flex-col gap-1 p-0">
                {(all ? images : images.slice(0, firstImages)).map(image => <ImageItem key={image.key} image={image} />)}
            </ul>
            {!all && images.length > firstImages && (
                <Button size="xs" variant="plain" className="self-start text-muted-foreground hover:text-foreground pointer-coarse:min-h-11" onClick={() => setAll(true)}>
                    Show all {images.length}
                </Button>
            )}
        </li>
    );
}

export function AltTextSection() {
    const section = useSection(altTextSection);
    return (
        <ReportSection id={altTextSection.id} title="Alt text" section={section}>
            {section.report?.details && <ImageList images={section.report.details.images} />}
        </ReportSection>
    );
}
