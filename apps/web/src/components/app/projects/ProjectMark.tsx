'use client';

import { useState } from 'react';
import { cn } from '@/src/lib/utils';

/** The icon of one of a project's addresses, served by uier (`/api/projects/<id>/icon`, `getSiteIcon`) */
export function projectIconUrl(projectId: string, siteUrl: string) {
    return `/api/projects/${encodeURIComponent(projectId)}/icon?site=${encodeURIComponent(siteUrl)}`;
}

/**
 * A project's tile: its site's favicon, which uier's server finds (the page's `<link rel="icon">`, then
 * the usual paths) and serves, so the browser never contacts the site; the first letter of the
 * project's name until it loads or when the site has none
 */
export function ProjectMark({ name, projectId, url, className }: { name: string; projectId?: string; url?: string; className?: string }) {
    const src = projectId && url ? projectIconUrl(projectId, url) : undefined;
    // Which icon settled and how: a changed address starts again without an effect
    const [settled, setSettled] = useState<{ src: string; loaded: boolean }>();
    const current = src && settled?.src === src ? settled : undefined;
    const loaded = current?.loaded === true;
    const failed = current?.loaded === false;
    const settle = (value: boolean) => {
        if (src && (settled?.src !== src || settled.loaded !== value)) setSettled({ src, loaded: value });
    };

    return (
        <span
            aria-hidden="true"
            className={cn('relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase',
                // Favicons are mostly drawn for light browser tabs: a light tile in the dark theme too
                loaded && 'dark:bg-foreground', className)}>
            {!loaded && (name.trim()[0] ?? '?')}
            {src && !failed && (
                // eslint-disable-next-line @next/next/no-img-element -- a site's own icon in any format (ICO, SVG), not an optimizable asset
                <img
                    key={src}
                    src={src}
                    alt=""
                    // An image that settled before hydration fires no events
                    ref={image => {
                        if (image?.complete)
                            settle(Boolean(image.naturalWidth));
                    }}
                    onLoad={() => settle(true)}
                    onError={() => settle(false)}
                    // An SVG favicon that follows the colour scheme draws its light-tab version on the light tile.
                    // Padding keeps edge-to-edge icons off the border and out of the rounded corners, so
                    // they read as an icon on the tile; larger tiles set their own (`[&>img]:p-1.5`).
                    className={cn('absolute inset-0 size-full object-contain p-0.5 [color-scheme:light]', !loaded && 'invisible')} />
            )}
        </span>
    );
}
