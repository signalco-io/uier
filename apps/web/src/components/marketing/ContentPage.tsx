import type { PropsWithChildren, ReactNode } from 'react';
import { Check } from '@signalco/ui-icons';
import { cx } from '@signalco/ui-primitives/cx';

// Building blocks of the public pages (the landing page, security, open source, status, brand):
// one type scale and section rhythm from BRAND.md ("Typography", "Space"), whitespace between
// sections instead of rules, and one way to group items: a panel of cells divided by hairlines.

export function PageHeader({ title, lead, children }: PropsWithChildren<{ title: string; lead: ReactNode; }>) {
    return (
        <header className="flex max-w-[720px] flex-col gap-5 pt-12 md:pt-20">
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">{title}</h1>
            <p className="text-lg leading-relaxed text-muted-foreground">{lead}</p>
            {children}
        </header>
    );
}

/** An h2 with an optional lead; `id` goes on the heading, for links to it and `aria-labelledby` */
export function SectionHeading({ id, title, lead }: { id: string; title: string; lead?: ReactNode; }) {
    return (
        <div className="flex max-w-[720px] flex-col gap-2">
            <h2 id={id} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
            {lead && <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>}
        </div>
    );
}

/**
 * A titled section. On wide screens the heading stays in view beside the content, like the
 * landing page's questions; `wide` puts the content under the heading instead, for content that
 * needs the full width (the brand page's specimens).
 */
export function PageSection({ id, title, lead, wide, children }: PropsWithChildren<{ id: string; title: string; lead?: ReactNode; wide?: boolean; }>) {
    const heading = <SectionHeading id={`${id}-title`} title={title} lead={lead} />;
    if (wide || !children) {
        return (
            <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-8 pt-16 md:pt-24">
                {heading}
                {children}
            </section>
        );
    }
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-24 grid-cols-1 items-start gap-8 pt-16 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
            <div className="lg:sticky lg:top-24">{heading}</div>
            <div className="flex min-w-0 flex-col gap-6">{children}</div>
        </section>
    );
}

/**
 * Cells in one bordered panel, divided by hairlines. `className` sets the grid columns; the cells
 * draw their right and bottom rules, and the panel clips the outer ones, so a last row that is not
 * full still lines up.
 */
export function Panel({ as: Component = 'div', className, children }: PropsWithChildren<{ as?: 'div' | 'ul' | 'ol'; className?: string; }>) {
    return (
        <div className="overflow-hidden rounded-2xl border">
            <Component className={cx('-mb-px -mr-px grid grid-cols-1 [&>*]:border-b [&>*]:border-r', className)}>
                {children}
            </Component>
        </div>
    );
}

/** A titled cell of a Panel */
export function Tile({ title, children }: PropsWithChildren<{ title: string; }>) {
    return (
        <div className="flex flex-col gap-2 p-6">
            <h3 className="text-base font-semibold">{title}</h3>
            <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
    );
}

export function CheckList({ items, columns = 1 }: { items: ReactNode[]; columns?: 1 | 2; }) {
    return (
        <ul className={cx('text-sm', columns === 2 ? 'grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2' : 'flex flex-col gap-3')}>
            {items.map((item, index) => (
                <li key={index} className="flex items-start gap-2.5">
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    );
}

export function InlineLink({ href, children }: PropsWithChildren<{ href: string; }>) {
    return <a href={href} className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">{children}</a>;
}
