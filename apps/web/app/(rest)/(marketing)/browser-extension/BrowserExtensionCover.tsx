import type { CSSProperties } from 'react';
import { cx } from '@signalco/ui-primitives/cx';

/**
 * The browsers the extension is built for, as their official logos (`public/browsers`, unchanged
 * copies of the `@browser-logos/chrome` 2.0.0, `edge` 2.0.7 and `firefox` 3.0.10 files from
 * github.com/alrra/browser-logos). Third-party marks in their own colours: never recoloured,
 * redrawn or faded. Chrome and Edge install from the Chrome Web Store (`extensionRelease`); Firefox
 * stays "In review" until Mozilla approves the add-on (`firefoxExtensionRelease`). Other Chromium
 * browsers are left out until a release is tested in them.
 */
const browsers: { id: string; name: string; inReview?: boolean }[] = [
    { id: 'chrome', name: 'Chrome' },
    { id: 'edge', name: 'Microsoft Edge' },
    { id: 'firefox', name: 'Firefox', inReview: true }
];

/** A dot grid that fades out towards the edges, as on the security page's cover */
const pattern: CSSProperties = {
    backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.35) 1px, transparent 1.5px)',
    backgroundSize: '20px 20px',
    backgroundPosition: 'center',
    maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 72%)'
};

/**
 * The browser extension page's cover: each browser's logo on a bordered tile with its name written
 * under it, over a dot grid. The logos are decorative (the names say which browser); the frame
 * follows the theme. Its height is fixed per breakpoint, so it never shifts the page.
 */
export function BrowserExtensionCover() {
    return (
        <div className="relative flex h-56 w-full items-center justify-center overflow-hidden rounded-3xl border bg-card sm:h-64 lg:mt-12 lg:h-72">
            <div aria-hidden className="absolute inset-0" style={pattern} />
            <ul aria-label="Browsers" className="relative flex items-start justify-center gap-3 px-4 sm:gap-8">
                {browsers.map(browser => (
                    <li key={browser.id} data-browser={browser.id} className="flex flex-col items-center gap-3 text-center">
                        <span className={cx('flex size-16 items-center justify-center rounded-2xl border bg-background sm:size-24', browser.inReview && 'border-dashed')}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/browsers/${browser.id}.svg`} width={56} height={56} alt="" aria-hidden="true" decoding="async" className="size-10 sm:size-14" />
                        </span>
                        <span className="flex flex-col text-xs font-medium leading-snug sm:text-sm">
                            {browser.name}
                            {browser.inReview && <span className="text-xs font-normal text-muted-foreground">In review</span>}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
