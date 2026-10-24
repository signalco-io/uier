import type { PropsWithChildren, ReactNode } from 'react';

// Building blocks of the public content pages (security, open source, status): the same type
// scale and section rhythm as the brand page, from BRAND.md ("Typography", "Space").

export function PageHeader({ title, lead, children }: PropsWithChildren<{ title: string; lead: ReactNode; }>) {
    return (
        <header className="flex max-w-[720px] flex-col gap-5 py-10">
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">{title}</h1>
            <p className="text-lg leading-relaxed text-muted-foreground">{lead}</p>
            {children}
        </header>
    );
}

export function PageSection({ id, title, lead, children }: PropsWithChildren<{ id: string; title: string; lead?: ReactNode; }>) {
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-6 border-t py-12">
            <div className="flex max-w-[720px] flex-col gap-2">
                <h2 id={`${id}-title`} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
                {lead && <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>}
            </div>
            {children}
        </section>
    );
}

export function Tile({ title, children }: PropsWithChildren<{ title: string; }>) {
    return (
        <div className="flex flex-col gap-2 rounded-2xl border p-5">
            <h3 className="text-base font-semibold">{title}</h3>
            <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
    );
}

export function InlineLink({ href, children }: PropsWithChildren<{ href: string; }>) {
    return <a href={href} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">{children}</a>;
}
