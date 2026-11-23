'use client';

import { useContext, useState } from 'react';
import { measureIconTile, type IconTile } from '@/src/lib/app/iconTile';
import { cachedImageTile, rememberImage, screenDensity, useCachedImage } from '@/src/lib/app/imageCache';
import { projectIconSizes, type ProjectIconSize } from '@/src/lib/app/projectIconSizes';
import { cn } from '@/src/lib/utils';
import { CachedShellContext } from '../shell/cachedShellContext';

/** The icon of one of a project's addresses, served by uier (`/api/projects/<id>/icon`, `getSiteIcon`) */
export function projectIconUrl(projectId: string, siteUrl: string, size?: number) {
    const source = `/api/projects/${encodeURIComponent(projectId)}/icon?site=${encodeURIComponent(siteUrl)}`;
    return size === undefined ? source : `${source}&size=${size}`;
}

/** Icon address → its tile, measured once per document however many marks draw it */
const measuredTiles = new Map<string, IconTile>();

/** The icon's box inside the tile, for the image and its copy alike; larger tiles set their own padding (`[&>[data-mark-icon]]:p-1.5`) */
const iconClassName = 'absolute inset-0 size-full p-0.5';

/**
 * A project's tile: its site's favicon, which uier's server finds (the page's `<link rel="icon">`, then
 * the usual paths) and serves, so the browser never contacts the site; the first letter of the
 * project's name until it loads or when the site has none. The favicon draws on a light tile in both
 * themes, or on a dark one when it is light ink on transparency (`iconTile`, uier #496), decided when it
 * loads. This browser keeps a copy of each favicon, with its tile (`imageCache`): until the image loads,
 * the copy draws in the letter's place, so a later load or an account or workspace switch (whose new
 * cookie misses the HTTP cache) shows the favicon at once.
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
    const [settled, setSettled] = useState<{ src: string; loaded: boolean; tile?: IconTile }>();
    const current = src && settled?.src === src ? settled : undefined;
    const loaded = current?.loaded === true;
    const failed = current?.loaded === false;
    // Offline, the copy stays in the failed image's place too
    const showCopy = copy !== undefined && !loaded;
    // The loaded image's tile, or the copy's, saved with it from the same image; the letter keeps the plain tile
    const tile = loaded ? current?.tile : showCopy ? cachedImageTile(copy) : undefined;
    const settle = (image: HTMLImageElement, value: boolean) => {
        if (!src)
            return;
        let measured: IconTile | undefined;
        if (value) {
            measured = measuredTiles.get(src) ?? measureIconTile(image);
            measuredTiles.set(src, measured);
        }
        if (settled?.src !== src || settled.loaded !== value || settled.tile !== measured)
            setSettled({ src, loaded: value, tile: measured });
        if (measured && projectId && url)
            void rememberImage(src, screenDensity() > 1 ? projectIconUrl(projectId, url, iconSize * 2) : src, { tile: measured });
    };

    return (
        <span
            aria-hidden="true"
            data-tile={tile}
            className={cn('relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-background text-[10px] leading-none font-semibold text-foreground uppercase',
                // Favicons are mostly drawn for light browser tabs: a light tile in the dark theme too
                tile === 'light' && 'dark:bg-foreground',
                // Light ink on transparency: a dark tile in both themes, its border the tile's own colour on paper
                tile === 'dark' && 'border-foreground bg-foreground dark:border-border dark:bg-background', className)}>
            {!loaded && !showCopy && (name.trim()[0] ?? '?')}
            {showCopy && (
                // A background, not an image: the tile keeps one image, the network's, whose address never changes
                <span data-mark-icon="" style={{ backgroundImage: `url("${copy}")` }}
                    className={cn(iconClassName, 'bg-contain bg-center bg-no-repeat [background-origin:content-box]',
                        tile === 'dark' ? '[color-scheme:dark]' : '[color-scheme:light]')} />
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
                            settle(image, Boolean(image.naturalWidth));
                    }}
                    onLoad={event => settle(event.currentTarget, true)}
                    onError={event => settle(event.currentTarget, false)}
                    // An SVG favicon that follows the colour scheme draws its light-tab version on the light tile
                    // and its dark-tab version on the dark one.
                    // Padding keeps edge-to-edge icons off the border and out of the rounded corners, so
                    // they read as an icon on the tile.
                    className={cn(iconClassName, 'object-contain', tile === 'dark' ? '[color-scheme:dark]' : '[color-scheme:light]',
                        !loaded && 'invisible')} />
            )}
        </span>
    );
}
