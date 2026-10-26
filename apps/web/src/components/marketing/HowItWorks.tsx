'use client';

import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Pause, Play } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { brand, PIN_PATH, PIN_VIEWBOX } from '@uier/brand';
import { Pin } from '@uier/brand/Pin';
import { ToolbarIllustration } from '../brand/ToolbarIllustration';

// The landing page's cover, "How it works": one scene that plays the whole flow on an example site (an
// imaginary restaurant, like the feature tiles' pictures): the script tag goes in, the review link
// brings up the toolbar, a pointer selects words and comments, someone replies and the thread is
// marked as done. The scene is a picture, hidden from assistive technologies; the text beside it
// says the same in words.
//
// Motion (BRAND.md): things come and go with a 150 ms ease-out fade plus 8 px slide, the pointer
// and the selection move with ease-out and no overshoot, nothing moves on page load. It plays only
// while in view; Pause stops it (WCAG 2.2.2), and with reduced motion it shows one still frame.

const phases = [
    { name: 'idle', ms: 700 },
    { name: 'code', ms: 2600 },
    { name: 'link', ms: 1500 },
    { name: 'point', ms: 900 },
    { name: 'select', ms: 800 },
    { name: 'menu', ms: 900 },
    { name: 'press', ms: 300 },
    { name: 'type', ms: 1800 },
    { name: 'posted', ms: 1300 },
    { name: 'reply', ms: 1600 },
    { name: 'resolve', ms: 900 },
    { name: 'done', ms: 1200 },
    { name: 'leave', ms: 900 },
    { name: 'reset', ms: 800 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: { text: string; phases: Phase[] }[] = [
    { text: 'Put one script tag on your site.', phases: ['idle', 'code'] },
    { text: 'Open the site with a review link.', phases: ['link'] },
    { text: 'Select the words, or click anything, and write.', phases: ['point', 'select', 'menu', 'press', 'type', 'posted'] },
    { text: 'Reply, then mark it as done.', phases: ['reply', 'resolve', 'done', 'leave', 'reset'] }
];

/** The frame shown with reduced motion: the comment posted, with a reply */
const stillPhase = phases.findIndex(phase => phase.name === 'reply');

const comment = 'Every day, or only on weekdays?';
const scriptLines = ['  <script defer', `    src="${brand.url}/toolbar.js"`, '    data-uier-project="k3m9x2p7q4ab">', '  </script>'];
const cardWidth = 232;

/** Come and go: 150 ms ease-out, fade plus 8 px slide */
function fade(visible: boolean) {
    return cx('transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none', visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0');
}

type Point = { x: number; y: number };
type Layout = { width: number; start: Point; end: Point; lineHeight: number; comment: Point; resolve: Point };

/** Position of `element` inside `ancestor` (offsets ignore transforms, so a sliding element measures where it lands) */
function offsetIn(element: HTMLElement | null, ancestor: HTMLElement | null): Point & { width: number; height: number } {
    let x = 0;
    let y = 0;
    const width = element?.offsetWidth ?? 0;
    const height = element?.offsetHeight ?? 0;
    while (element && element !== ancestor) {
        x += element.offsetLeft;
        y += element.offsetTop;
        element = element.offsetParent as HTMLElement | null;
    }
    return { x, y, width, height };
}

const center = (box: Point & { width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

export function HowItWorks() {
    const root = useRef<HTMLElement>(null);
    const [phase, setPhase] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [inView, setInView] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [typed, setTyped] = useState(0);
    // The caption fades in only once the scene has moved: nothing moves on page load
    const [started, setStarted] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setReducedMotion(true);
            setPhase(stillPhase);
            setTyped(comment.length);
        }
        const element = root.current;
        if (!element)
            return;
        const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0.4 });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const running = playing && inView && !reducedMotion;
    const name = phases[phase]?.name ?? 'idle';

    useEffect(() => {
        if (!running)
            return;
        const timer = window.setTimeout(() => {
            setStarted(true);
            setPhase(current => (current + 1) % phases.length);
        }, phases[phase]?.ms);
        return () => window.clearTimeout(timer);
    }, [phase, running]);

    useEffect(() => {
        if (name !== 'type')
            return;
        setTyped(0);
        const timer = window.setInterval(() => setTyped(count => Math.min(count + 1, comment.length)), 40);
        return () => window.clearInterval(timer);
    }, [name]);

    const caption = reducedMotion
        ? 'Select the words, or click anything, and write. The comment stays there.'
        : captions.find(item => item.phases.includes(name))?.text;

    return (
        // The landing page's cover: beside the headline, with its own heading so the navigation's
        // "How it works" lands here
        <section ref={root} aria-labelledby="how-it-works" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                <h2 id="how-it-works" className="text-sm font-medium">How it works</h2>
                <span aria-hidden="true" className="hidden h-3.5 w-px bg-border sm:block" />
                <p aria-hidden="true" key={caption} className={cx('order-last w-full text-sm text-muted-foreground sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate', started && 'animate-in fade-in duration-150 ease-out motion-reduce:animate-none')}>
                    {caption}
                </p>
                {!reducedMotion && (
                    <Button
                        variant="plain"
                        size="sm"
                        onClick={() => setPlaying(!playing)}
                        startDecorator={playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
                        className="ml-auto text-muted-foreground">
                        {playing ? 'Pause' : 'Play'}
                    </Button>
                )}
            </div>
            <p className="sr-only">
                {`An example: the script tag goes into the site, and opening it with a review link brings up the toolbar. Select words or click anything and write: the comment is pinned there. Someone replies, and the thread is marked as done.`}
            </p>
            <Scene phase={name} typed={typed} />
        </section>
    );
}

/** The example site in a browser frame, with the review layer playing on it */
function Scene({ phase, typed }: { phase: Phase; typed: number }) {
    const canvas = useRef<HTMLDivElement>(null);
    const start = useRef<HTMLSpanElement>(null);
    const end = useRef<HTMLSpanElement>(null);
    const commentButton = useRef<HTMLSpanElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const resolveButton = useRef<HTMLSpanElement>(null);
    const [layout, setLayout] = useState<Layout | null>(null);

    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element)
            return;
        const measure = () => {
            const startBox = offsetIn(start.current, element);
            const endBox = offsetIn(end.current, element);
            const inCard = offsetIn(resolveButton.current, card.current);
            setLayout({
                width: element.clientWidth,
                start: startBox,
                end: endBox,
                lineHeight: endBox.height,
                comment: center(offsetIn(commentButton.current, element)),
                resolve: { x: inCard.x + inCard.width / 2, y: inCard.y + inCard.height / 2 }
            });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const is = (...names: Phase[]) => names.includes(phase);

    // The thread opens beside the pin, or under the line when there is no room beside it
    const cardPosition = layout && (layout.end.x + 40 + cardWidth <= layout.width - 16
        ? { left: layout.end.x + 40, top: layout.end.y - 8 }
        : { left: Math.max(16, layout.width - cardWidth - 16), top: layout.end.y + layout.lineHeight + 16 });
    const cursorAt = (): Point => {
        if (!layout || !cardPosition)
            return { x: 0, y: 0 };
        if (is('point'))
            return { x: layout.start.x - 2, y: layout.start.y + layout.lineHeight / 2 };
        if (is('select'))
            return { x: layout.end.x, y: layout.end.y + layout.lineHeight / 2 };
        if (is('menu', 'press', 'type'))
            return layout.comment;
        if (is('posted', 'reply', 'resolve', 'done', 'leave'))
            return { x: cardPosition.left + layout.resolve.x, y: cardPosition.top + layout.resolve.y };
        return { x: layout.width * 0.62, y: 300 };
    };
    const cursor = cursorAt();

    const reviewing = !is('idle', 'code', 'reset');
    const selected = is('select', 'menu', 'press', 'type', 'posted', 'reply', 'resolve', 'done');
    const threadOpen = is('posted', 'reply', 'resolve', 'done');
    const replied = is('reply', 'resolve', 'done', 'leave');
    const done = is('done', 'leave');

    return (
        // data-landing-scene: the e2e axe scan skips this picture (e2e/accessibility.ts)
        <div data-landing-scene="" aria-hidden="true" className="rounded-3xl border bg-card p-2 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:shadow-none">
            <div className="flex items-center gap-1.5 px-2 pb-2.5 pt-1">
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="size-2.5 rounded-full bg-muted" />
                <span className="ml-2 flex-1 truncate rounded-md bg-muted px-3 py-1 font-mono text-[13px] text-muted-foreground">
                    example.com/menu
                    <span className={cx('font-medium text-foreground transition-opacity duration-150 ease-out', reviewing ? 'opacity-100' : 'opacity-0')}>?review=true</span>
                </span>
            </div>
            {/* Decorative: the toolbar's screenshots leave its content out (copying it made every capture
                on this page much slower); the min-height keeps its box, as screenshots do not copy heights */}
            <div ref={canvas} data-uier-decorative="" className="relative h-[400px] min-h-[400px] overflow-hidden rounded-2xl border bg-background p-6 sm:h-[380px] sm:min-h-[380px] sm:p-8">
                <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">Trattoria</span>
                    <span className="flex gap-4 text-xs text-muted-foreground"><span>Menu</span><span>Visit</span><span>Book</span></span>
                </div>
                <div className="mt-12 text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[32px]">
                    Fresh pasta,{' '}
                    <span className="relative">
                        {/* The selection grows from the first letter to the last, as a drag would */}
                        <span className={cx('absolute inset-0 origin-left rounded-[3px] bg-[hsl(var(--brand-selection))] transition-[scale,opacity] duration-500 ease-out motion-reduce:transition-none', selected ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0')} />
                        <span ref={start} />
                        <span className="relative">every day.</span>
                        <span ref={end} />
                        <SelectionToolbar buttonRef={commentButton} visible={is('menu', 'press')} pressed={is('press')} />
                    </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground sm:text-base">Lunch from noon, dinner until late.</p>
                <span className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Book a table</span>

                <ScriptCard visible={is('code')} />
                <div className={cx('absolute inset-x-0 bottom-5 flex justify-center', fade(reviewing))}>
                    <ToolbarIllustration />
                </div>

                {layout && cardPosition && (
                    <>
                        <Pin
                            count={replied ? 2 : 1}
                            size={26}
                            style={{ position: 'absolute', left: layout.end.x - 4, top: layout.end.y + layout.lineHeight - 8 }}
                            className={fade(threadOpen)} />
                        <Composer visible={is('type')} typed={typed} style={cardPosition} />
                        <Thread cardRef={card} resolveRef={resolveButton} visible={threadOpen} replied={replied} done={done} style={cardPosition} />
                    </>
                )}

                <svg
                    viewBox="0 0 16 20"
                    width="16"
                    height="20"
                    style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
                    className={cx(
                        'pointer-events-none absolute left-0 top-0 transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none',
                        is('point', 'select', 'menu', 'press', 'resolve', 'done') ? 'opacity-100' : 'opacity-0'
                    )}>
                    <path d="M1 1v15.5l4.2-4 2.9 6.5 2.6-1.2-2.9-6.4H14z" fill="hsl(var(--foreground))" stroke="hsl(var(--background))" strokeWidth="1.25" strokeLinejoin="round" />
                </svg>
            </div>
        </div>
    );
}

/** The script tag going into the site's HTML, a line at a time */
function ScriptCard({ visible }: { visible: boolean }) {
    return (
        <div className={cx('absolute inset-x-4 bottom-4 overflow-hidden rounded-xl border bg-card sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[320px]', fade(visible))}>
            <div className="border-b px-3.5 py-2 font-mono text-[11px] text-muted-foreground">index.html</div>
            <div className="flex flex-col py-2 font-mono text-[11px] leading-[18px]">
                <span className="whitespace-pre px-3.5 text-muted-foreground">{'<head>'}</span>
                {scriptLines.map((line, index) => (
                    <span
                        key={line}
                        style={{ transitionDelay: visible ? `${400 + index * 300}ms` : '0ms' }}
                        className={cx('flex whitespace-pre bg-muted px-3.5 transition-opacity duration-150 ease-out motion-reduce:transition-none', visible ? 'opacity-100' : 'opacity-0')}>
                        <span className="w-4 shrink-0 text-muted-foreground">+</span>
                        {line}
                    </span>
                ))}
                <span className="whitespace-pre px-3.5 text-muted-foreground">{'</head>'}</span>
            </div>
        </div>
    );
}

/** The toolbar for selected text, ink like the rest of the review layer */
function SelectionToolbar({ buttonRef, visible, pressed }: { buttonRef: Ref<HTMLSpanElement>; visible: boolean; pressed: boolean }) {
    return (
        <span className={cx('dark absolute bottom-full left-0 mb-2 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border bg-background p-1 text-xs font-medium tracking-normal text-foreground', fade(visible))}>
            <span ref={buttonRef} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full px-3 transition-colors duration-[120ms] ease-out', pressed ? 'bg-tertiary-foreground/40' : 'bg-accent')}>
                <svg viewBox={PIN_VIEWBOX} width="14" height="14" fill="none"><path d={PIN_PATH} stroke="currentColor" strokeWidth="2.5" /></svg>
                Comment
            </span>
            <span className="inline-flex h-7 items-center px-3 text-muted-foreground">Rewrite</span>
        </span>
    );
}

const popover = 'absolute flex flex-col rounded-xl border bg-popover text-left text-popover-foreground shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:shadow-none';

function Avatar({ initials }: { initials: string }) {
    return <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials}</span>;
}

/** The comment being written */
function Composer({ visible, typed, style }: { visible: boolean; typed: number; style: { left: number; top: number } }) {
    return (
        <div style={{ ...style, width: cardWidth }} className={cx(popover, 'gap-2 p-2.5', fade(visible))}>
            <span className="rounded-r-md border-l-2 border-tertiary bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">every day.</span>
            <div className="flex items-end gap-2">
                <span className="min-h-10 flex-1 rounded-md border px-2.5 py-2 text-[13px] leading-5">
                    {typed > 0 ? comment.slice(0, typed) : <span className="text-muted-foreground">Leave a comment…</span>}
                    <span className="ml-px inline-block h-4 w-px translate-y-[3px] bg-foreground" />
                </span>
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </span>
            </div>
        </div>
    );
}

/** The posted thread: status, the comment, a reply and "Mark as done" */
function Thread({ cardRef, resolveRef, visible, replied, done, style }: {
    cardRef: Ref<HTMLDivElement>;
    resolveRef: Ref<HTMLSpanElement>;
    visible: boolean;
    replied: boolean;
    done: boolean;
    style: { left: number; top: number };
}) {
    return (
        <div ref={cardRef} style={{ ...style, width: cardWidth }} className={cx(popover, fade(visible))}>
            <div className="flex items-center gap-2 px-3 pt-2.5">
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                    <span className={cx('size-1.5 rounded-full transition-colors duration-[120ms] ease-out', done ? 'bg-[hsl(var(--brand-success))]' : 'bg-foreground')} />
                    {done ? 'Done' : 'Open'}
                </span>
                <span className="font-mono text-xs text-muted-foreground">#15</span>
                <span ref={resolveRef} className="ml-auto inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium">{done ? 'Reopen' : 'Mark as done'}</span>
            </div>
            <div className="flex flex-col gap-1.5 px-3 py-2.5">
                <span className="flex items-center gap-2 text-[13px] font-medium"><Avatar initials="7B" />Guest 7B1C</span>
                <span className="text-[13px] leading-5">{comment}</span>
            </div>
            <div className={cx('flex flex-col gap-1.5 border-t px-3 py-2.5', fade(replied))}>
                <span className="flex items-center gap-2 text-[13px] font-medium"><Avatar initials="LE" />Leo</span>
                <span className="text-[13px] leading-5">Every day. Sunday is fixed too.</span>
            </div>
        </div>
    );
}
