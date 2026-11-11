import type { PropsWithChildren, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeftIcon, ArrowRightIcon, FileCodeIcon } from 'lucide-react';
import { cx } from '@signalco/ui-primitives/cx';
import { KnownPages } from '../../../knownPages';
import { Chip } from '../ContentPage';

// Building blocks of the guides (/guides and the guides under it, docs/guides.md): a header with the
// guide's outline beside the title, then numbered steps on a rail, each with a picture of what it
// describes (GuideSpecimens). Reference sections after the steps use ContentPage's PageSection.
// Type scale and spacing follow ContentPage and BRAND.md ("Typography", "Space").

/** A section of a guide, for its outline. Steps have a `number`; reference sections do not */
export type GuideOutlineItem = { id: string; title: string; number?: number };

/** The number of a step, on the rail and in the outline */
export function StepNumber({ number, small }: { number: number; small?: boolean }) {
    return (
        <span aria-hidden="true" className={cx('flex shrink-0 items-center justify-center rounded-full border bg-background font-medium tabular-nums', small ? 'size-6 text-xs' : 'size-8 text-sm')}>
            {number}
        </span>
    );
}

/**
 * The title, lead and actions of a guide, with a link back to all guides, and beside them on wide
 * screens the outline: every step and section, linked to its heading.
 */
export function GuideHeader({ title, lead, outline, children }: PropsWithChildren<{ title: string; lead: ReactNode; outline: GuideOutlineItem[] }>) {
    return (
        <header className="grid grid-cols-1 items-start gap-10 pt-12 md:pt-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
            <div className="flex min-w-0 flex-col gap-5">
                <a href={KnownPages.Guides} className="-mx-1 inline-flex items-center gap-1.5 self-start rounded-md px-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                    <ArrowLeftIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                    Guides
                </a>
                <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">{title}</h1>
                <p className="max-w-[640px] text-lg leading-relaxed text-muted-foreground">{lead}</p>
                {children}
            </div>
            <nav aria-labelledby="guide-outline" className="flex flex-col gap-3 rounded-2xl border p-4 md:p-5">
                <h2 id="guide-outline" className="px-2 text-sm font-semibold">In this guide</h2>
                <ol className="flex flex-col">
                    {outline.map(item => (
                        <li key={item.id}>
                            <a href={`#${item.id}`} className="flex min-h-10 items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                                {item.number
                                    ? <StepNumber number={item.number} small />
                                    : <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center"><span className="size-1 rounded-full bg-muted-foreground" /></span>}
                                {item.title}
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>
        </header>
    );
}

/** The numbered steps of a guide, joined by a rail */
export function GuideSteps({ children }: PropsWithChildren) {
    return <ol className="flex flex-col pt-16 md:pt-24">{children}</ol>;
}

/**
 * One step: its number on the rail (above the heading on small screens), an h2 with an optional
 * lead, then what to do and a picture of it. A small picture goes in `aside`, beside the step on
 * wide screens; a wide one goes in `children`, under the text. `id` goes on the section (for links and the outline) and `${id}-title` on the
 * heading, like PageSection.
 */
export function GuideStep({ id, number, title, lead, aside, children }: PropsWithChildren<{ id: string; number: number; title: string; lead?: ReactNode; aside?: ReactNode }>) {
    const text = (
        <div className="flex min-w-0 flex-col gap-6">
            <div className="flex max-w-[720px] flex-col gap-2">
                <h2 id={`${id}-title`} className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
                {lead && <p className="text-base leading-relaxed text-muted-foreground">{lead}</p>}
            </div>
            {aside ? children : null}
        </div>
    );
    return (
        // On small screens the number sits above the heading and the content takes the full width
        <li className="group/step relative grid grid-cols-1 gap-y-4 pb-16 last:pb-0 md:grid-cols-[2rem_minmax(0,1fr)] md:gap-x-8 md:pb-24">
            {/* The rail, from this step's number down to the next one */}
            <span aria-hidden="true" className="absolute bottom-2 left-[15.5px] top-12 hidden w-px bg-border md:block md:group-last/step:hidden" />
            <span className="pt-0.5"><StepNumber number={number} /></span>
            {aside ? (
                <section id={id} aria-labelledby={`${id}-title`} className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-12">
                    {text}
                    {aside}
                </section>
            ) : (
                <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-6">
                    {text}
                    {children}
                </section>
            )}
        </li>
    );
}

/** Running text of a step, at reading width */
export function StepText({ children, muted }: PropsWithChildren<{ muted?: boolean }>) {
    return <p className={cx('max-w-[720px] leading-relaxed', muted ? 'text-sm text-muted-foreground' : 'text-base')}>{children}</p>;
}

/**
 * A bordered panel that holds a picture (a specimen, hidden from assistive technologies) and, under
 * it, what the picture shows: tips or a caption.
 */
export function GuideCard({ children, className }: PropsWithChildren<{ className?: string }>) {
    return <div className={cx('flex min-w-0 flex-col overflow-hidden rounded-2xl border', className)}>{children}</div>;
}

/** The picture area of a GuideCard, or a picture on its own when it is not in one */
export function GuidePicture({ children, className }: PropsWithChildren<{ className?: string }>) {
    return (
        <div aria-hidden="true" className={cx('relative flex min-w-0 justify-center overflow-hidden bg-muted/50 px-4 py-8 sm:px-8', className)}>
            {children}
        </div>
    );
}

/** An outlined icon on a bordered tile, beside or above a tip's title */
export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
    return (
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background text-foreground">
            <Icon size={18} strokeWidth={1.75} />
        </span>
    );
}

export type Tip = { title: string; icon: LucideIcon; text: ReactNode };

/**
 * Tips in cells divided by hairlines: in a GuideCard under its picture (`bare`), or in their own panel.
 * `columns` sets the columns on wide screens; the cells draw their right and bottom rules and the
 * panel clips the outer ones, like ContentPage's Panel.
 */
export function Tips({ tips, columns = 2, bare }: { tips: Tip[]; columns?: 2 | 3 | 4; bare?: boolean }) {
    const grid = cx('-mb-px -mr-px grid grid-cols-1 [&>*]:border-b [&>*]:border-r',
        columns === 2 && 'md:grid-cols-2',
        columns === 3 && 'md:grid-cols-3',
        columns === 4 && 'md:grid-cols-2 xl:grid-cols-4');
    const cells = (
        <div className={grid}>
            {tips.map(tip => (
                <div key={tip.title} className="flex flex-col gap-3 p-6">
                    <IconTile icon={tip.icon} />
                    <h3 className="text-base font-semibold">{tip.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{tip.text}</p>
                </div>
            ))}
        </div>
    );
    return bare ? <div className="overflow-hidden">{cells}</div> : <div className="overflow-hidden rounded-2xl border">{cells}</div>;
}

/** Bold, for the names of buttons and labels the reader looks for on screen */
export function UiLabel({ children }: { children: ReactNode }) {
    return <strong className="font-semibold">{children}</strong>;
}

/**
 * A code example with its file name above it. The lines `highlight` picks are marked (the ones to
 * add); the text stays the snippet exactly, one line per row, so copying it copies the snippet.
 */
export function CodeWindow({ file, label, code, highlight }: { file: string; label: string; code: string; highlight?: (line: string) => boolean }) {
    const lines = code.split('\n');
    return (
        <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border">
            <span className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-xs text-muted-foreground">
                <FileCodeIcon size={14} strokeWidth={1.75} aria-hidden="true" />
                {file}
            </span>
            <pre tabIndex={0} aria-label={label} className="max-w-full overflow-x-auto bg-muted/50 py-4 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                <code className="block w-max min-w-full">
                    {lines.map((line, index) => (
                        <span key={index} className={cx('block border-l-2 px-4', highlight?.(line) ? 'border-foreground bg-muted' : 'border-transparent')}>
                            {line}{index < lines.length - 1 ? '\n' : null}
                        </span>
                    ))}
                </code>
            </pre>
        </div>
    );
}

/**
 * A guide on the guides index: its picture, a label, the title (the card's one link, stretched over
 * the card) and its description. `wide` spans two columns with the picture beside the text.
 */
export function GuideTeaser({ href, title, description, label, picture, wide }: { href: string; title: string; description: string; label: string; picture: ReactNode; wide?: boolean }) {
    return (
        <article className={cx(
            'relative flex min-w-0 flex-col overflow-hidden rounded-2xl border transition-colors duration-[120ms] ease-out hover:border-muted-foreground has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background',
            wide && 'md:col-span-2 md:flex-row-reverse')}>
            <GuidePicture className={cx('h-56 items-center border-b', wide && 'md:h-auto md:min-h-64 md:w-1/2 md:border-b-0 md:border-l')}>{picture}</GuidePicture>
            <div className={cx('flex flex-1 flex-col items-start gap-3 p-6', wide && 'md:justify-center md:p-10')}>
                <Chip>{label}</Chip>
                <h3 className="text-xl font-semibold tracking-[-0.015em]">
                    <a href={href} className="outline-none after:absolute after:inset-0">{title}</a>
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                <span aria-hidden="true" className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium">
                    Read the guide
                    <ArrowRightIcon size={16} strokeWidth={1.75} />
                </span>
            </div>
        </article>
    );
}
