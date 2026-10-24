import type { ReactNode } from 'react';

/** Destructive text (errors): `--destructive`, mixed with white on dark so it keeps 4.5:1 there too */
export const destructiveTextClassName = 'text-[hsl(var(--destructive))] dark:text-[color-mix(in_srgb,hsl(var(--destructive))_55%,white)]';

/** Page title (BRAND.md "h2": 28/34, 600, -2 %) with an optional description and actions */
export function PageHeader({ title, description, actions, children }: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 pb-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <h1 className="m-0 break-words text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">{title}</h1>
                    {description && <div className="text-sm text-muted-foreground">{description}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

/** A bordered section of a page (resting surface, radius 16) with a title (BRAND.md "h3") */
export function Section({ title, description, children, actions, id }: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
    id?: string;
}) {
    const headingId = id ? `${id}-title` : undefined;
    return (
        <section id={id} aria-labelledby={headingId} className="flex flex-col gap-4 rounded-2xl border p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                    <h2 id={headingId} className="m-0 text-xl font-semibold leading-[26px] tracking-[-0.015em]">{title}</h2>
                    {description && <div className="text-sm text-muted-foreground">{description}</div>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    );
}
