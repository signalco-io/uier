'use client';

import { Mark } from '@uier/brand/Mark';
import { Avatar, AvatarFallback, AvatarImage } from '@/src/components/ui/avatar';
import { workspaceLogoSizes } from '@/src/lib/app/workspaceLogoSizes';

/** The workspace's image, with the uier app icon until it loads or when there is no image. */
export function WorkspaceMark({ logoUrl }: { logoUrl?: string }) {
    const [oneX, twoX] = workspaceLogoSizes;
    return (
        <Avatar key={logoUrl} aria-hidden="true" className="overflow-hidden rounded-lg after:hidden">
            {logoUrl && (
                <AvatarImage keepMounted alt="" src={`${logoUrl}?size=${oneX}`}
                    srcSet={`${logoUrl}?size=${oneX} 1x, ${logoUrl}?size=${twoX} 2x`}
                    className="absolute inset-0 rounded-none object-contain aria-hidden:invisible" />
            )}
            <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Mark size={15} />
            </AvatarFallback>
        </Avatar>
    );
}
