'use client';

import { useContext } from 'react';
import { Mark } from '@uier/brand/Mark';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { rememberImage, screenDensity, useCachedImage } from '@/src/lib/app/imageCache';
import { workspaceLogoSizes } from '@/src/lib/app/workspaceLogoSizes';
import { CachedShellContext } from '../shell/cachedShellContext';

/**
 * The workspace's image, with the uier app icon until it loads or when there is no image. This browser keeps a copy
 * of each logo version (`imageCache`), drawn in the icon's place until the image loads, so a later load or a switch
 * shows the logo at once.
 */
export function WorkspaceMark({ logoUrl }: { logoUrl?: string }) {
    const [oneX, twoX] = workspaceLogoSizes;
    const src = logoUrl ? `${logoUrl}?size=${oneX}` : undefined;
    const copy = useCachedImage(src);
    // The shell's copy (`CachedShell`) draws what this browser kept and asks the server for nothing it has
    const fromCopyOnly = useContext(CachedShellContext) && copy !== undefined;
    return (
        <Avatar key={logoUrl} aria-hidden="true" className="overflow-hidden rounded-lg after:hidden">
            {logoUrl && src && !fromCopyOnly && (
                <AvatarImage keepMounted alt="" src={src}
                    srcSet={`${src} 1x, ${logoUrl}?size=${twoX} 2x`}
                    onLoadingStatusChange={status => {
                        if (status === 'loaded')
                            void rememberImage(src, screenDensity() > 1 ? `${logoUrl}?size=${twoX}` : src);
                    }}
                    className="absolute inset-0 rounded-none object-contain aria-hidden:invisible" />
            )}
            {copy ? (
                <AvatarFallback className="rounded-none bg-transparent">
                    <span className="size-full bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${copy}")` }} />
                </AvatarFallback>
            ) : (
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Mark size={15} />
                </AvatarFallback>
            )}
        </Avatar>
    );
}
