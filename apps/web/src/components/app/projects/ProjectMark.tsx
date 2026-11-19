'use client';

import { useContext, useState } from 'react';
import { rememberImage, screenDensity, useCachedImage } from '@/src/lib/app/imageCache';
import { projectIconSizes, type ProjectIconSize } from '@/src/lib/app/projectIconSizes';
import { cn } from '@/src/lib/utils';
import { CachedShellContext } from '../shell/cachedShellContext';

/** The icon of one of a project's addresses, served by uier (`/api/projects/<id>/icon`, `getSiteIcon`) */
export function projectIconUrl(projectId: string, siteUrl: string, size?: number) {
    const source = `/api/projects/${encodeURIComponent(projectId)}/icon?site=${encodeURIComponent(siteUrl)}`;
    return size === undefined ? source : `${source}&size=${size}`;
}

/** The icon's box inside the tile, for the image and its copy alike; larger tiles set their own padding (`[&>[data-mark-icon]]:p-1.5`) */
const iconClassName = 'absolute inset-0 size-full p-0.5';

/**
 * A project's tile: its site's favicon, which uier's server finds (the page's `<link rel="icon">`, then
 * the usual paths) and serves, so the browser never contacts the site; the first letter of the
 * project's name until it loads or when the site has none. This browser keeps a copy of each favicon
 * (`imageCache`): until the image loads, the copy draws in the letter's place, so a later load or an
 * account or workspace switch (whose new cookie misses the HTTP cache) shows the favicon at once.
 */
export function ProjectMark({ name, projectId, url, iconSize = projectIconSizes.inline, className }: {
    name: string; projectId?: string; url?: string; iconSize?: ProjectIconSize; className?: string;
}) {
    const src = projectId && url ? projectIconUrl(projectId, url, iconSize) : undefined;
    const srcSet = projectId && url ? `${src} 1x, ${projectIconUrl(projectId, url, iconSize * 2)} 2x` : undefined;
    const copy = useCachedImage(src);
    // The shell's copy (`CachedShell`) draws what this browser kept and asks the server for nothing it has
    const fromCopyOnly = useContext(CachedShellContext) && copy !== undefined;
    // Which icon settled and how: a changed address starts again without an effect
    const [settled, setSettled] = useState<{ src: string; loaded: boolean }>();
    const current = src && settled?.src === src ? settled : undefined;
    const loaded = current?.loaded === true;
    const failed = current?.loaded === false;
    // Offline, the copy stays in the failed image's place too
    const showCopy = copy !== undefined && !loaded;
    const settle = (value: boolean) => {
        if (src && (settled?.src !== src || settled.loaded !== value)) setSettled({ src, loaded: value });
        if (value && src && projectId && url)
            void rememberImage(src, screenDensity() > 1 ? projectIconUrl(projectId, url, iconSize * 2) : src);
    };

    return (
        <span
            aria-hidden="true"
            className={cn('relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase',
                // Favicons are mostly drawn for light browser tabs: a light tile in the dark theme too
                (loaded || showCopy) && 'dark:bg-foreground', className)}>
            {!loaded && !showCopy && (name.trim()[0] ?? '?')}
            {showCopy && (
                // A background, not an image: the tile keeps one image, the network's, whose address never changes
                <span data-mark-icon="" style={{ backgroundImage: `url("${copy}")` }}
                    className={cn(iconClassName, 'bg-contain bg-center bg-no-repeat [background-origin:content-box] [color-scheme:light]')} />
            )}
            {src && !failed && !fromCopyOnly && (
                // eslint-disable-next-line @next/next/no-img-element -- the member-only route serves both image densities
                <img
                    key={src}
                    data-mark-icon=""
                    srcSet={srcSet}
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
                    // they read as an icon on the tile.
                    className={cn(iconClassName, 'object-contain [color-scheme:light]', !loaded && 'invisible')} />
            )}
        </span>
    );
}
