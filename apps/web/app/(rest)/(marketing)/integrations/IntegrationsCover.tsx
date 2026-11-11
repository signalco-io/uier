'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { IntegrationLogo } from '../../../../src/components/app/integrations/IntegrationLogo';
import { floating, Message, StatusDot, ThreadHeader, type Stage } from '../../../../src/components/marketing/LandingSpecimens';
import type { IntegrationProviderId } from '../../../../src/lib/integrations/model';

// The cover of /integrations: one shared thread on the left and the five services on the right,
// joined by hairlines. On a loop the thread is copied to each service (a page, an issue, a work item,
// a message), a reply comes back from Linear with its source in the name ("Ana via Linear", as
// importReplies.ts names imported replies), and marking it done updates each copy. Only what the
// catalog says the services do (src/lib/integrations/catalog.ts); recheck with it. The thread copies
// the landing's pieces (ThreadHeader, Message), so it looks like the toolbar's.
//
// A picture: hidden from assistive technologies and inert (the axe scan skips its text, which can be
// caught mid-fade), the caption under it says what is happening. Motion follows BRAND.md: things come
// and go with a 150 ms ease-out fade plus 8 px slide, a sync draws its line with ease-out, nothing
// moves on page load. It plays only while in view, Pause stops it (WCAG 2.2.2), and with reduced
// motion it shows one still frame. The canvas has a fixed height per breakpoint, so nothing shifts.

const phases = [
    { name: 'idle', ms: 1200 },
    { name: 'send', ms: 2600 },
    { name: 'sent', ms: 900 },
    { name: 'reply', ms: 800 },
    { name: 'replied', ms: 2000 },
    { name: 'done', ms: 2600 },
    { name: 'synced', ms: 1400 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: { text: string; phases: Phase[] }[] = [
    { text: 'Shared feedback becomes a page, an issue, a work item or a message.', phases: ['idle', 'send', 'sent'] },
    { text: 'With reply sync, replies come back to the thread.', phases: ['reply', 'replied'] },
    { text: 'Mark it done, and each copy is updated.', phases: ['done', 'synced', 'leave', 'reset'] }
];

/** The frame shown with reduced motion: every copy made, the reply back in the thread */
const stillPhase = phases.findIndex(phase => phase.name === 'replied');
const stillCaption = 'Shared feedback becomes a page, an issue, a work item or a message, and replies can come back.';

/** What each service makes of the thread, and the word for its done state */
const services: { provider: IntegrationProviderId; name: string; item: string; done: string }[] = [
    { provider: 'notion', name: 'Notion', item: 'Page', done: 'Done' },
    { provider: 'github', name: 'GitHub', item: 'Issue', done: 'Closed' },
    { provider: 'linear', name: 'Linear', item: 'Issue', done: 'Done' },
    { provider: 'azure-devops', name: 'Azure DevOps', item: 'Work item', done: 'Done' },
    { provider: 'slack', name: 'Slack', item: 'Message', done: 'Done' }
];

/** The service whose comment comes back to the thread */
const replyFrom = services.findIndex(service => service.provider === 'linear');

/** Time between two services' syncs */
const stagger = 160;

/** Come and go: 150 ms ease-out, fade plus 8 px slide */
function fade(visible: boolean) {
    return cx('transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none', visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0');
}

type Point = { x: number; y: number };
type Layout = { source: Point; targets: Point[] };

/** Centre of `element` inside `ancestor` (offsets ignore transforms, so a sliding element measures where it lands) */
function centerIn(element: HTMLElement | null, ancestor: HTMLElement | null): Point {
    let x = (element?.offsetWidth ?? 0) / 2;
    let y = (element?.offsetHeight ?? 0) / 2;
    while (element && element !== ancestor) {
        x += element.offsetLeft;
        y += element.offsetTop;
        element = element.offsetParent as HTMLElement | null;
    }
    return { x, y };
}

/**
 * The line from the thread to a service, and the same line drawn the other way. Side by side it is a
 * curve; stacked (narrow screens) it runs down the left edge and turns into the row.
 */
function connector(source: Point, target: Point): { out: string; back: string } {
    if (target.x - source.x > 48) {
        const middle = (source.x + target.x) / 2;
        return {
            out: `M${source.x} ${source.y}C${middle} ${source.y} ${middle} ${target.y} ${target.x} ${target.y}`,
            back: `M${target.x} ${target.y}C${middle} ${target.y} ${middle} ${source.y} ${source.x} ${source.y}`
        };
    }
    const radius = Math.min(10, Math.abs(target.x - source.x), Math.abs(target.y - source.y));
    return {
        out: `M${source.x} ${source.y}V${target.y - radius}Q${source.x} ${target.y} ${source.x + radius} ${target.y}H${target.x}`,
        back: `M${target.x} ${target.y}H${source.x + radius}Q${source.x} ${target.y} ${source.x} ${target.y - radius}V${source.y}`
    };
}

export function IntegrationsCover() {
    const root = useRef<HTMLDivElement>(null);
    const [phase, setPhase] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [inView, setInView] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    // The caption fades in only once the scene has moved: nothing moves on page load
    const [started, setStarted] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setReducedMotion(true);
            setPhase(stillPhase);
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

    const caption = reducedMotion ? stillCaption : captions.find(item => item.phases.includes(name))?.text;

    return (
        <div ref={root} className="flex min-w-0 flex-col gap-3 pt-12 md:pt-16">
            <Scene phase={name} />
            <div className="flex items-start gap-3 px-1">
                <p inert aria-hidden="true" key={caption} className={cx('min-w-0 flex-1 py-1 text-sm text-muted-foreground', started && 'animate-in fade-in duration-150 ease-out motion-reduce:animate-none')}>
                    {caption}
                </p>
                {!reducedMotion && (
                    <Button
                        variant="plain"
                        size="sm"
                        onClick={() => setPlaying(!playing)}
                        startDecorator={playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
                        className="shrink-0 text-muted-foreground">
                        {playing ? 'Pause' : 'Play'}<span className="sr-only"> the animation</span>
                    </Button>
                )}
            </div>
        </div>
    );
}

/** A faint dot grid behind the scene, fading out towards the edges */
const grid: CSSProperties = {
    backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.3) 1px, transparent 1.5px)',
    backgroundSize: '20px 20px',
    backgroundPosition: 'center',
    maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)'
};

function Scene({ phase }: { phase: Phase }) {
    const canvas = useRef<HTMLDivElement>(null);
    const thread = useRef<HTMLDivElement>(null);
    const source = useRef<HTMLSpanElement>(null);
    const targets = useRef<(HTMLSpanElement | null)[]>([]);
    const [layout, setLayout] = useState<Layout | null>(null);

    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element)
            return;
        const measure = () => setLayout({
            source: centerIn(source.current, element),
            targets: services.map((_, index) => centerIn(targets.current[index] ?? null, element))
        });
        measure();
        // The thread too: stacked, the lines leave from its bottom, which moves as the reply comes and goes
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        if (thread.current)
            observer.observe(thread.current);
        return () => observer.disconnect();
    }, []);

    const is = (...names: Phase[]) => names.includes(phase);
    // Each service holds its copy from the send until the scene leaves
    const copied = is('send', 'sent', 'reply', 'replied', 'done', 'synced');
    // The reply shows once its line reaches the thread
    const replied = is('replied', 'done', 'synced');
    // Done stays while the copies fade out, so they leave as they are
    const done = is('done', 'synced', 'leave');
    const stage: Stage = done ? 'done' : 'open';

    return (
        // inert: a picture, out of the tab order and the accessibility tree; the axe scan skips its text
        // data-uier-decorative: the toolbar's screenshots keep this box but not its content; the
        // min-height keeps its size there, as screenshots do not copy heights
        <div
            ref={canvas}
            inert
            aria-hidden="true"
            data-integrations-cover=""
            data-uier-decorative=""
            className="relative h-[516px] min-h-[516px] overflow-hidden rounded-3xl border bg-card md:h-[380px] md:min-h-[380px]">
            <div className="absolute inset-0" style={grid} />

            {layout && (
                <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" fill="none">
                    {services.map((service, index) => {
                        const target = layout.targets[index];
                        if (!target)
                            return null;
                        const path = connector(layout.source, target);
                        const delay = index * stagger;
                        return (
                            <g key={service.provider}>
                                <path d={path.out} className="stroke-border" strokeWidth={1} />
                                {/* The sync out: drawn from the thread when the copy is made, again when it is done */}
                                <Trace d={path.out} drawn={is('send')} delay={delay} />
                                <Trace d={path.out} drawn={is('done')} delay={300 + delay} />
                                {/* The reply back, drawn from the service to the thread */}
                                {index === replyFrom && <Trace d={path.back} drawn={is('reply')} delay={0} />}
                            </g>
                        );
                    })}
                </svg>
            )}

            <div className="relative flex h-full flex-col gap-7 px-5 py-6 md:mx-auto md:max-w-[980px] md:flex-row md:items-center md:justify-between md:gap-16 md:px-10">
                {/* The shared thread: its pin, then the thread as the toolbar shows it. The box keeps room for
                    the reply, so the services never move; the thread grows into it when the reply comes. */}
                <div className="relative h-[196px] w-full shrink-0 pl-3 pt-3 md:w-[min(46%,340px)]">
                    <Pin number={24} messages={replied ? 2 : 1} size={26} className="absolute left-0 top-0 z-10" />
                    <div ref={thread} className={cx('relative flex flex-col gap-2.5 rounded-xl border bg-popover pb-3.5 text-popover-foreground', floating)}>
                        <ThreadHeader stage={stage} number={24} />
                        <div className="flex flex-col px-3.5">
                            <Message initials="3F" name="Guest 3F2A" time="2 min">The booking button hides behind the menu on small phones.</Message>
                            <div className={cx('grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none', replied ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                                <div className="min-h-0 overflow-hidden">
                                    <div className={cx('pt-3', fade(replied))}>
                                        <Message initials="AN" name="Ana via Linear" time="just now">Fixed on staging.</Message>
                                    </div>
                                </div>
                            </div>
                        </div>
                        {/* Where the lines leave the thread: beside the first message side by side, the bottom left corner stacked */}
                        <span ref={source} className="absolute -bottom-[3.5px] left-[18px] size-[7px] rounded-full border border-foreground bg-card md:-right-[3.5px] md:bottom-auto md:left-auto md:top-[72px]" />
                    </div>
                </div>

                {/* The services, in one panel divided by hairlines */}
                <ul className="relative ml-[46px] flex flex-col rounded-2xl border bg-card md:ml-0 md:w-[min(42%,320px)] md:shrink-0">
                    {services.map((service, index) => (
                        <li key={service.provider} className="relative flex h-12 items-center gap-3 border-b px-3 last:border-b-0 md:h-[54px]">
                            <span ref={element => { targets.current[index] = element; }} className="absolute -left-[3.5px] top-1/2 -mt-[3.5px] size-[7px] rounded-full border border-foreground bg-card" />
                            <IntegrationLogo provider={service.provider} className="size-8 rounded-md p-1.5" />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{service.name}</span>
                            {/* Each copy shows, then turns done, when its line reaches it */}
                            <Copy item={service.item} doneLabel={service.done} visible={copied} done={done}
                                delay={is('send') ? 450 + index * stagger : 0}
                                doneDelay={is('done') ? 300 + index * stagger + 450 : 0} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

/**
 * One sync along a connector: the line draws from its start with ease-out (`pathLength` 1, so the
 * dash offset goes from 1 to 0 whatever its length), then fades back into the hairline.
 */
function Trace({ d, drawn, delay }: { d: string; drawn: boolean; delay: number }) {
    return (
        <path
            d={d}
            pathLength={1}
            strokeDasharray="1"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="stroke-foreground"
            style={{
                strokeDashoffset: drawn ? 0 : 1,
                opacity: drawn ? 1 : 0,
                // Drawn: the line grows; after it, it fades and only then goes back to the start, unseen
                transition: drawn
                    ? `stroke-dashoffset 600ms ease-out ${delay}ms, opacity 0ms linear ${delay}ms`
                    : 'opacity 150ms ease-out, stroke-dashoffset 0ms linear 150ms'
            }} />
    );
}

/** The copy in a service: what it is and its state, beside each other like a status badge */
function Copy({ item, doneLabel, visible, done, delay, doneDelay }: { item: string; doneLabel: string; visible: boolean; done: boolean; delay: number; doneDelay: number }) {
    // The open and done states sit on top of each other and cross-fade, so the badge keeps its width
    const state = (shown: boolean) => cx('col-start-1 row-start-1 flex items-center gap-1.5 transition-opacity duration-[120ms] ease-out motion-reduce:transition-none', shown ? 'opacity-100' : 'opacity-0');
    return (
        <span style={{ transitionDelay: `${delay}ms` }} className={cx('flex shrink-0 items-center gap-2 text-xs', fade(visible))}>
            {/* Where the row is narrow (phones, and beside the thread on tablets) the badge is enough */}
            <span className="hidden text-muted-foreground sm:inline md:hidden lg:inline">{item}</span>
            <span className="inline-grid h-6 min-w-[4.5rem] items-center rounded-full border bg-card px-2 font-medium">
                <span style={{ transitionDelay: `${doneDelay}ms` }} className={state(!done)}><StatusDot stage="open" />Open</span>
                <span style={{ transitionDelay: `${doneDelay}ms` }} className={state(done)}><StatusDot stage="done" />{doneLabel}</span>
            </span>
        </span>
    );
}
