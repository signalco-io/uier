import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { cn } from '@/src/lib/utils';

/** Destructive text (errors): `--destructive`, mixed with white on dark so it keeps 4.5:1 there too */
export const destructiveTextClassName = 'text-[hsl(var(--destructive))] dark:text-[color-mix(in_srgb,hsl(var(--destructive))_55%,white)]';

/**
 * Page title (BRAND.md "h2": 28/34, 600, -2 %) with an optional description and actions. `media` (a
 * project's favicon, a person's avatar) sits left of the title and description together, so size it to
 * span both rows (`size-14` for a one-line description).
 */
export function PageHeader({ title, description, media, actions, children, className }: {
    title: ReactNode;
    description?: ReactNode;
    media?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    const heading = (
        <div className="flex min-w-0 flex-col gap-1">
            <h1 className="m-0 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] break-words">{title}</h1>
            {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
    );

    return (
        <div className={cn('flex flex-col gap-4 pb-6', className)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
                {media ? (
                    <div className="flex min-w-0 items-center gap-4">
                        {media}
                        {heading}
                    </div>
                ) : heading}
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

/**
 * A titled card of a page (settings, account): a region named by its heading (BRAND.md "h3" at
 * 16 px for cards). `footer` sits under a divider, for a form's message and its button; with
 * `stickyFooter` it stays at the bottom of the window while the card is longer than the window, so a
 * long form's Save is always in reach.
 */
export function Section({ title, description, children, actions, footer, stickyFooter = false, id, className }: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    stickyFooter?: boolean;
    id?: string;
    className?: string;
}) {
    const headingId = id ? `${id}-title` : undefined;
    return (
        // A sticky footer needs a card that does not clip (a clipping card would be its scroll container)
        <Card id={id} role="region" aria-labelledby={headingId} className={cn('scroll-mt-6', stickyFooter && 'overflow-visible', className)}>
            <CardHeader>
                <CardTitle>
                    <h2 id={headingId} className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
                {actions && <CardAction>{actions}</CardAction>}
            </CardHeader>
            {children && <CardContent>{children}</CardContent>}
            {footer && (
                <CardFooter className={cn('justify-end gap-3 border-t',
                    // The footer's band made opaque, so the form does not show through it while it sticks
                    stickyFooter && 'sticky bottom-0 z-10 [.border-t]:bg-[color-mix(in_srgb,hsl(var(--muted))_60%,hsl(var(--card)))] dark:[.border-t]:bg-background')}>
                    {footer}
                </CardFooter>
            )}
        </Card>
    );
}
