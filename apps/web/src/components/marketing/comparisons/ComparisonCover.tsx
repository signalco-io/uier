import type { CSSProperties } from 'react';
import { Mark, brand } from '@uier/brand';
import { competitors, type CompetitorSlug } from './content';

/**
 * Each alternative's official mark (`public/compare`), unchanged copies of the files the vendor
 * publishes: Marker.io's colour symbol from marker.io/brand, and the square site icons that
 * bugherd.com, usersnap.com and usepastel.com serve. Third-party marks in their own colours: never
 * recoloured, redrawn or used as uier's. `size` evens out their padding (Marker.io's symbol sits
 * in a padded square) without changing the files.
 */
const logos: Record<CompetitorSlug, { src: string; size: string }> = {
    bugherd: { src: '/compare/bugherd.png', size: 'size-11 sm:size-16' },
    'marker-io': { src: '/compare/marker-io.svg', size: 'size-14 sm:size-20' },
    usersnap: { src: '/compare/usersnap.png', size: 'size-11 sm:size-16' },
    pastel: { src: '/compare/pastel.png', size: 'size-11 sm:size-16' }
};

/** A dot grid that fades out towards the edges, as on the browser extension page's cover */
const pattern: CSSProperties = {
    backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.35) 1px, transparent 1.5px)',
    backgroundSize: '20px 20px',
    backgroundPosition: 'center',
    maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)'
};

const tile = 'flex size-20 items-center justify-center rounded-2xl border bg-background sm:size-28';
const caption = 'text-xs font-medium leading-snug sm:text-sm';

/**
 * A pairwise comparison page's cover: uier's mark and the alternative's official logo side by side,
 * each on a bordered tile with its name written under it, over a dot grid. The logos are decorative
 * (the names say which tool); the frame follows the theme. Its height is fixed per breakpoint, so it
 * never shifts the page.
 */
export function ComparisonCover({ slug }: { slug: CompetitorSlug }) {
    const competitor = competitors[slug];
    const logo = logos[slug];
    return (
        <div className="relative flex h-56 w-full items-center justify-center overflow-hidden rounded-3xl border bg-card sm:h-64 lg:mt-12 lg:h-72">
            <div aria-hidden className="absolute inset-0" style={pattern} />
            <ul aria-label="Compared tools" className="relative flex items-start justify-center gap-6 px-4 sm:gap-10">
                <li data-tool="uier" className="flex flex-col items-center gap-3 text-center">
                    <span className={tile}><Mark size={36} className="text-foreground sm:size-12" /></span>
                    <span className={caption}>{brand.name}</span>
                </li>
                <li data-tool={slug} className="flex flex-col items-center gap-3 text-center">
                    <span className={tile}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={logo.src} width={80} height={80} alt="" aria-hidden="true" decoding="async" className={logo.size} />
                    </span>
                    <span className={caption}>{competitor.name}</span>
                </li>
            </ul>
        </div>
    );
}
