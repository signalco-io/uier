'use client';

import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Check, Copy, ExpandDown, MoreHorizontal, Pause, Play } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { brand } from '@uier/brand';
import { Pin } from '@uier/brand/Pin';
import { AddCommentIcon, ToolbarIllustration } from '../brand/ToolbarIllustration';

// The landing page's cover, "How it works": one scene that plays the whole flow on an example site (an
// imaginary restaurant, like the feature tiles' pictures): the script tag goes in, the review link
// brings up the toolbar, a pointer selects words and comments, someone replies and the thread's
// status menu sets it to Done. The scene is a picture, hidden from assistive technologies; the text
// beside it says the same in words. The toolbar, the selection toolbar, the new comment form and the
// thread follow packages/toolbar (CommentToolbar, CommentSelectionPopover, CommentBubble,
// CommentThreadHeader); recheck them together.
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
    { name: 'status', ms: 900 },
    { name: 'choose', ms: 1000 },
    { name: 'done', ms: 1200 },
    { name: 'leave', ms: 900 },
    { name: 'reset', ms: 800 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: { text: string; phases: Phase[] }[] = [
    { text: 'Put one script tag on your site.', phases: ['idle', 'code'] },
    { text: 'Open the site with a review link.', phases: ['link'] },
    { text: 'Select the words, or click anything, and write.', phases: ['point', 'select', 'menu', 'press', 'type', 'posted'] },
    { text: 'Reply, then mark it as done.', phases: ['reply', 'status', 'choose', 'done', 'leave', 'reset'] }
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
type Layout = { width: number; start: Point; end: Point; lineHeight: number; comment: Point; status: Point; done: Point };

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
    const statusButton = useRef<HTMLSpanElement>(null);
    const doneItem = useRef<HTMLSpanElement>(null);
    const [layout, setLayout] = useState<Layout | null>(null);

    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element)
            return;
        const measure = () => {
            const startBox = offsetIn(start.current, element);
            const endBox = offsetIn(end.current, element);
            setLayout({
                width: element.clientWidth,
                start: startBox,
                end: endBox,
                lineHeight: endBox.height,
                comment: center(offsetIn(commentButton.current, element)),
                // In the thread card: its status menu, and Done in the menu
                status: center(offsetIn(statusButton.current, card.current)),
                done: center(offsetIn(doneItem.current, card.current))
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
        if (is('posted', 'reply', 'status'))
            return { x: cardPosition.left + layout.status.x, y: cardPosition.top + layout.status.y };
        if (is('choose', 'done', 'leave'))
            return { x: cardPosition.left + layout.done.x, y: cardPosition.top + layout.done.y };
        return { x: layout.width * 0.62, y: 300 };
    };
    const cursor = cursorAt();

    const reviewing = !is('idle', 'code', 'reset');
    const selected = is('select', 'menu', 'press', 'type', 'posted', 'reply', 'status', 'choose', 'done');
    const threadOpen = is('posted', 'reply', 'status', 'choose', 'done');
    const replied = is('reply', 'status', 'choose', 'done', 'leave');
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
                    <ToolbarIllustration size="sm" unread={0} initials={null} />
                </div>

                {layout && cardPosition && (
                    <>
                        <Pin
                            number={15}
                            messages={replied ? 2 : 1}
                            size={26}
                            style={{ position: 'absolute', left: layout.end.x - 4, top: layout.end.y + layout.lineHeight - 8 }}
                            className={fade(threadOpen)} />
                        <Composer visible={is('type')} typed={typed} style={cardPosition} />
                        <Thread cardRef={card} statusRef={statusButton} doneRef={doneItem} visible={threadOpen} replied={replied}
                            pressed={is('status')} choosing={is('choose')} done={done} style={cardPosition} />
                    </>
                )}

                <svg
                    viewBox="0 0 16 20"
                    width="16"
                    height="20"
                    style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
                    className={cx(
                        'pointer-events-none absolute left-0 top-0 transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none',
                        is('point', 'select', 'menu', 'press', 'status', 'choose', 'done') ? 'opacity-100' : 'opacity-0'
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

/** "Rewrite": lines of text with a pencil (packages/toolbar RewriteIcon) */
function RewriteIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16M4 10h9M4 19h5" /><path d="M17.6 10.9a1.9 1.9 0 0 1 2.7 2.7l-5.9 5.9-3.4.9.9-3.4z" /><path d="m16.5 12 2.7 2.7" />
        </svg>
    );
}

/** The toolbar for selected text, ink like the rest of the review layer: Add comment and Rewrite */
function SelectionToolbar({ buttonRef, visible, pressed }: { buttonRef: Ref<HTMLSpanElement>; visible: boolean; pressed: boolean }) {
    return (
        <span className={cx('dark absolute bottom-full left-0 mb-2 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full border bg-background p-1 text-xs font-medium tracking-normal text-foreground', fade(visible))}>
            <span ref={buttonRef} className={cx('inline-flex h-7 items-center gap-1.5 rounded-full pl-2 pr-3 transition-colors duration-[120ms] ease-out', pressed ? 'bg-tertiary-foreground/40' : 'bg-accent')}>
                <AddCommentIcon size={14} />
                Add comment
            </span>
            <span className="inline-flex h-7 items-center gap-1.5 pl-2 pr-3 text-muted-foreground"><RewriteIcon />Rewrite</span>
        </span>
    );
}

const popover = 'absolute flex flex-col rounded-xl border bg-popover text-left text-popover-foreground shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_24px_rgba(0,0,0,.08)] dark:shadow-none';

function Avatar({ initials }: { initials: string }) {
    return <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials}</span>;
}

/** A message with the avatar column, as threads show them (no dividers) */
function Message({ initials, name, time, children }: { initials: string; name: string; time: string; children: string }) {
    return (
        <div className="flex gap-2">
            <Avatar initials={initials} />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-baseline gap-2"><span className="text-[13px] font-medium">{name}</span><span className="text-[11px] text-muted-foreground">{time}</span></span>
                <span className="text-[13px] leading-5">{children}</span>
            </div>
        </div>
    );
}

/** The new comment being written: its title, the quoted words, then the text box with the send button */
function Composer({ visible, typed, style }: { visible: boolean; typed: number; style: { left: number; top: number } }) {
    return (
        <div style={{ ...style, width: cardWidth }} className={cx(popover, 'gap-2 p-2.5', fade(visible))}>
            <span className="text-[13px] font-semibold">New comment</span>
            <span className="rounded-r-md border-l-2 border-tertiary bg-muted px-2.5 py-0.5 text-[13px] text-muted-foreground">every day.</span>
            <div className="flex items-end gap-2 rounded-md border py-1.5 pl-2.5 pr-1.5">
                <span className="min-h-5 flex-1 text-[13px] leading-5">
                    {typed > 0 ? comment.slice(0, typed) : <span className="text-muted-foreground">Leave feedback...</span>}
                    <span className="ml-px inline-block h-4 w-px translate-y-[3px] bg-foreground" />
                </span>
                <span className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </span>
            </div>
        </div>
    );
}

const statuses = [
    { label: 'Open', dot: 'border border-foreground' },
    { label: 'In progress', dot: 'bg-[hsl(var(--brand-in-progress))]' },
    { label: 'Ready to verify', dot: 'bg-[hsl(var(--brand-ready))]' },
    { label: 'Done', dot: 'bg-[hsl(var(--brand-success))]' }
];

/** The posted thread: the status menu, the number, Copy and Thread options, the comment and a reply; the status menu sets Done */
function Thread({ cardRef, statusRef, doneRef, visible, replied, pressed, choosing, done, style }: {
    cardRef: Ref<HTMLDivElement>;
    statusRef: Ref<HTMLSpanElement>;
    doneRef: Ref<HTMLSpanElement>;
    visible: boolean;
    replied: boolean;
    /** The pointer presses the status menu */
    pressed: boolean;
    /** The menu is open, the pointer on Done */
    choosing: boolean;
    done: boolean;
    style: { left: number; top: number };
}) {
    return (
        <div ref={cardRef} style={{ ...style, width: cardWidth }} className={cx(popover, fade(visible))}>
            <div className="flex items-center gap-2 px-3 pt-2.5">
                <span ref={statusRef} className={cx('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors duration-[120ms] ease-out', (pressed || choosing) && 'bg-muted')}>
                    <span className={cx('size-1.5 rounded-full transition-colors duration-[120ms] ease-out', done ? 'bg-[hsl(var(--brand-success))]' : 'border border-foreground')} />
                    {done ? 'Done' : 'Open'}
                    <ExpandDown size={12} className="text-muted-foreground" />
                </span>
                <span className="font-mono text-xs text-muted-foreground">#15</span>
                <span className="ml-auto flex items-center text-muted-foreground">
                    <span className="inline-flex size-6 items-center justify-center"><Copy size={14} /></span>
                    <span className="inline-flex size-6 items-center justify-center"><MoreHorizontal size={14} /></span>
                </span>
            </div>
            <div className="flex flex-col gap-2.5 px-3 py-2.5">
                <Message initials="7B" name="Guest 7B1C" time="just now">{comment}</Message>
                <div className={fade(replied)}>
                    <Message initials="LE" name="Leo" time="just now">Every day. Sunday is fixed too.</Message>
                </div>
            </div>
            {/* The status menu, under its button: every status with its dot, the current one checked */}
            <div className={cx(popover, 'left-2 top-10 w-44 p-1', fade(choosing))}>
                {statuses.map(status => (
                    <span key={status.label} ref={status.label === 'Done' ? doneRef : undefined}
                        className={cx('flex h-8 items-center gap-2 rounded-lg px-2 text-[13px]', status.label === 'Done' && 'bg-accent')}>
                        <span className={cx('size-1.5 shrink-0 rounded-full', status.dot)} />
                        <span className="flex-1">{status.label}</span>
                        {status.label === 'Open' && <Check size={14} />}
                    </span>
                ))}
            </div>
        </div>
    );
}
