'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Pause, Play } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';
import { cx } from '@signalco/ui-primitives/cx';

// The animated cover under a feature page's header: one loop that plays the feature on the example
// site (the landing's imaginary restaurant), with a caption under it and Pause. It follows the rules
// of the integrations cover (app/(rest)/(marketing)/integrations/IntegrationsCover.tsx, docs/integration-pages.md)
// and of BRAND.md ("Shape, space and motion", "Marketing and metadata"):
//
// - A picture: hidden from assistive technologies and inert, so the axe scan skips its text, which a
//   frame can catch mid-fade. The caption says in words what is happening; it is hidden too, since the
//   page's own text says the same.
// - Things come and go with a 150 ms ease-out fade plus 8 px slide (`fade`), an item that changes place
//   moves for 200 ms with ease-out, the pointer with ease-out and no overshoot. Nothing moves on page load.
// - It plays only while in view, Pause stops it (WCAG 2.2.2), and with reduced motion (read live, so
//   turning it on mid-loop stops the scene) it shows one still frame and a caption for it.
// - The canvas has a fixed height per breakpoint and the captions share one grid cell, so nothing
//   below it moves between phases. The canvas is `data-uier-decorative` with a `min-height`: the
//   toolbar's screenshots keep its box but not its content.
//
// Each cover is its own client component that passes its phases, captions and scene here.

export type CoverPhase<P extends string> = { name: P; ms: number };
export type CoverCaption<P extends string> = { text: string; phases: P[] };

/** Come and go: 150 ms ease-out, fade plus 8 px slide */
export function fade(visible: boolean) {
    return cx('transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none', visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0');
}

/** Show or hide in place, without the slide: for marks that sit on something (a pin's outline, a dot) */
export function appear(visible: boolean) {
    return cx('transition-opacity duration-150 ease-out motion-reduce:transition-none', visible ? 'opacity-100' : 'opacity-0');
}

/** A faint dot grid behind the scene, fading out towards the edges (the integrations cover's) */
const grid: CSSProperties = {
    backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.3) 1px, transparent 1.5px)',
    backgroundSize: '20px 20px',
    backgroundPosition: 'center',
    maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)'
};

export function FeatureCover<P extends string>({ name, phases, captions, stillPhase, stillCaption, className, children }: {
    /** `data-feature-cover`'s value, for tests */
    name: string;
    phases: readonly CoverPhase<P>[];
    captions: CoverCaption<P>[];
    /** The frame shown with reduced motion, and its caption */
    stillPhase: P;
    stillCaption: string;
    /** The canvas's height at each breakpoint, with the same `min-h-*` */
    className: string;
    /** The scene for a phase; `still` is true with reduced motion (no transitions) */
    children: (phase: P, still: boolean) => ReactNode;
}) {
    const root = useRef<HTMLDivElement>(null);
    const still = phases.findIndex(phase => phase.name === stillPhase);
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(true);
    const [inView, setInView] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    // The caption fades in only once the scene has moved: nothing moves on page load
    const [started, setStarted] = useState(false);

    // Reduced motion shows the still frame, also when it is turned on while the loop plays; turned
    // off, the loop goes on from that frame (unless paused)
    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const apply = () => {
            setReducedMotion(query.matches);
            if (query.matches)
                setIndex(still);
        };
        apply();
        query.addEventListener('change', apply);
        return () => query.removeEventListener('change', apply);
    }, [still]);

    useEffect(() => {
        const element = root.current;
        if (!element)
            return;
        const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0.4 });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const running = playing && inView && !reducedMotion;
    const phase = phases[index]?.name ?? phases[0]!.name;

    useEffect(() => {
        if (!running)
            return;
        const timer = window.setTimeout(() => {
            setStarted(true);
            setIndex(current => (current + 1) % phases.length);
        }, phases[index]?.ms);
        return () => window.clearTimeout(timer);
    }, [index, running, phases]);

    const caption = reducedMotion ? stillCaption : captions.find(item => item.phases.includes(phase))?.text;
    // Every caption, stacked in one cell so the row keeps the height of the longest at any width
    const allCaptions = [...captions.map(item => item.text), stillCaption];

    return (
        <div ref={root} className="flex min-w-0 flex-col gap-3 pt-12 md:pt-16">
            {/* inert: a picture, out of the tab order and the accessibility tree; the axe scan skips its text */}
            <div
                inert
                aria-hidden="true"
                data-feature-cover={name}
                data-uier-decorative=""
                className={cx('relative overflow-hidden rounded-3xl border bg-card', className)}>
                <div className="absolute inset-0" style={grid} />
                {children(phase, reducedMotion)}
            </div>
            <div className="flex items-start gap-3 px-1">
                {/* All captions share one grid cell, the others invisible, so the row never changes height */}
                <div inert aria-hidden="true" data-feature-cover-caption="" className="grid min-w-0 flex-1 py-1 text-sm text-muted-foreground">
                    {allCaptions.map(text => (
                        <p key={text} className={cx('col-start-1 row-start-1', text === caption ? started && 'animate-in fade-in duration-150 ease-out motion-reduce:animate-none' : 'invisible')}>
                            {text}
                        </p>
                    ))}
                </div>
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

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };

/** The box of `element` inside `ancestor` (offsets ignore transforms, so a sliding element measures where it lands) */
export function boxIn(element: HTMLElement | null, ancestor: HTMLElement | null): Box {
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

export const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The boxes of a scene's named parts inside its canvas, measured again when the canvas changes size.
 * Null until measured, so pointers and moving parts wait for their places.
 */
export function useBoxes<K extends string>(canvas: RefObject<HTMLElement | null>, parts: RefObject<Partial<Record<K, HTMLElement | null>>>) {
    const [boxes, setBoxes] = useState<Record<K, Box> | null>(null);
    useLayoutEffect(() => {
        const element = canvas.current;
        if (!element)
            return;
        const measure = () => {
            const next = {} as Record<K, Box>;
            for (const [key, part] of Object.entries(parts.current) as [K, HTMLElement | null][])
                next[key] = boxIn(part, element);
            setBoxes(next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [canvas, parts]);
    return boxes;
}

/** The mouse pointer, moving with ease-out and no overshoot; hidden while `visible` is false */
export function Pointer({ at, visible, still }: { at: Point; visible: boolean; still: boolean }) {
    return (
        <svg
            viewBox="0 0 16 20"
            width="16"
            height="20"
            style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
            className={cx(
                'pointer-events-none absolute left-0 top-0 z-30',
                !still && 'transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none',
                visible ? 'opacity-100' : 'opacity-0'
            )}>
            <path d="M1 1v15.5l4.2-4 2.9 6.5 2.6-1.2-2.9-6.4H14z" fill="hsl(var(--foreground))" stroke="hsl(var(--background))" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
    );
}
