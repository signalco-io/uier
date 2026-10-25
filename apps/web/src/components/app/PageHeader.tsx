import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { cn } from '@/src/lib/utils';

/** Destructive text (errors): `--destructive`, mixed with white on dark so it keeps 4.5:1 there too */
export const destructiveTextClassName = 'text-[hsl(var(--destructive))] dark:text-[color-mix(in_srgb,hsl(var(--destructive))_55%,white)]';

/** Page title (BRAND.md "h2": 28/34, 600, -2 %) with an optional description and actions */
export function PageHeader({ title, description, actions, children, className }: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex flex-col gap-4 pb-6', className)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                    <h1 className="m-0 text-[28px] leading-[34px] font-semibold tracking-[-0.02em] break-words">{title}</h1>
                    {description && <div className="text-sm text-muted-foreground">{description}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

/**
 * A titled card of a page (settings, account): a region named by its heading (BRAND.md "h3" at
 * 16 px for cards). `footer` sits under a divider, for a form's message and its button.
 */
export function Section({ title, description, children, actions, footer, id, className }: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    id?: string;
    className?: string;
}) {
    const headingId = id ? `${id}-title` : undefined;
    return (
        <Card id={id} role="region" aria-labelledby={headingId} className={cn('scroll-mt-6', className)}>
            <CardHeader>
                <CardTitle>
                    <h2 id={headingId} className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">{title}</h2>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
                {actions && <CardAction>{actions}</CardAction>}
            </CardHeader>
            {children && <CardContent>{children}</CardContent>}
            {footer && <CardFooter className="justify-end gap-3 border-t">{footer}</CardFooter>}
        </Card>
    );
}
