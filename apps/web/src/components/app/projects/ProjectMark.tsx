'use client';

import { useState } from 'react';
import { cn } from '@/src/lib/utils';

/** Where sites usually keep their icon, tried in order (the page's `<link rel="icon">` would need a fetch of the page) */
const faviconPaths = ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'];

function faviconUrls(url?: string) {
    try {
        const { origin, protocol } = new URL(url ?? '');
        // The app's CSP allows images over HTTPS only
        return protocol === 'https:' ? faviconPaths.map(path => `${origin}${path}`) : [];
    } catch {
        return [];
    }
}

/**
 * A project's tile: the site's favicon, loaded by the browser from the project's own site (no favicon
 * service), with the first letter of the project's name until it loads or when the site has none
 */
export function ProjectMark({ name, url, className }: { name: string; url?: string; className?: string }) {
    const candidates = faviconUrls(url);
    const [attempt, setAttempt] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const src = candidates[attempt];
    const next = () => {
        setLoaded(false);
        setAttempt(current => current + 1);
    };

    return (
        <span
            aria-hidden="true"
            className={cn('relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase',
                // Favicons are mostly drawn for light browser tabs: a light tile in the dark theme too
                loaded && 'dark:bg-foreground', className)}>
            {!loaded && (name.trim()[0] ?? '?')}
            {src && (
                // eslint-disable-next-line @next/next/no-img-element -- a cross-origin icon, not an optimizable asset
                <img
                    key={src}
                    src={src}
                    alt=""
                    referrerPolicy="no-referrer"
                    // An image that settled before hydration fires no events
                    ref={image => {
                        if (image?.complete)
                            if (image.naturalWidth) setLoaded(true);
                            else next();
                    }}
                    onLoad={() => setLoaded(true)}
                    onError={next}
                    // An SVG favicon that follows the colour scheme draws its light-tab version on the light tile.
                    // Padding keeps edge-to-edge icons off the border and out of the rounded corners, so
                    // they read as an icon on the tile; larger tiles set their own (`[&>img]:p-1.5`).
                    className={cn('absolute inset-0 size-full object-contain p-0.5 [color-scheme:light]', !loaded && 'invisible')} />
            )}
        </span>
    );
}
