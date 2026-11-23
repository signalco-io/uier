'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from '@uier/ui-icons';
import { Button } from '@uier/ui-primitives/Button';
import { cx } from '@uier/ui-primitives/cx';

// Plays the loops of the landing's feature tiles (apps/web/docs/landing-page.md, "The tiles play").
// Each animated specimen is a `[data-motion-loop]` with its length in seconds, and its moving parts
// carry their keyframes in `data-motion` (specimenMotion.tsx). This only hands them to the browser's
// animation engine: no state per frame, no measuring, and the pictures stay server-rendered.
//
// - A loop plays only while half of its picture is in view, and goes on from where it stopped.
// - One button pauses every tile (WCAG 2.2.2); the tiles are links, so they get no button each.
//   It is 44 px tall on touch screens (BRAND.md, "Space").
// - With reduced motion (read live) there are no animations: the still pictures. A note takes the
//   button's place, in the same box, so nothing moves when the setting changes. Until the script
//   runs CSS shows the right one; after that the state does, so when the setting changes the focus
//   can go from the one that leaves to the one that comes in the same commit, before the browser
//   drops it to the page.
// - Only opacity and transforms move, inside each picture's fixed box: nothing around it shifts.

/** Tiles that come into view together start a little apart, so they do not move in step */
const stagger = 600;

type Loop = { element: HTMLElement; inView: boolean; animations: Animation[] };

/** A loop plays while its picture is in view and the examples are not paused */
function sync(loop: Loop, paused: boolean) {
    for (const animation of loop.animations) {
        if (loop.inView && !paused)
            animation.play();
        else
            animation.pause();
    }
}

export function FeatureExamples({ heading, children }: { heading: ReactNode; children: ReactNode }) {
    const root = useRef<HTMLDivElement>(null);
    const control = useRef<HTMLDivElement>(null);
    const note = useRef<HTMLParagraphElement>(null);
    const loops = useRef<Loop[]>([]);
    const paused = useRef(false);
    const [playing, setPlaying] = useState(true);
    // Null until the script has read the setting: CSS decides which control shows
    const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);
    // The setting changed while the control that leaves had the focus
    const refocus = useRef(false);

    useEffect(() => {
        const element = root.current;
        if (!element)
            return;
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const loop = loops.current.find(item => item.element === entry.target);
                if (!loop)
                    continue;
                loop.inView = entry.isIntersecting;
                sync(loop, paused.current);
            }
        }, { threshold: 0.5 });
        const stop = () => {
            observer.disconnect();
            for (const loop of loops.current)
                loop.animations.forEach(animation => animation.cancel());
            loops.current = [];
        };
        const start = () => {
            stop();
            refocus.current = control.current?.contains(document.activeElement) ?? false;
            setReducedMotion(query.matches);
            if (query.matches)
                return;
            loops.current = [...element.querySelectorAll<HTMLElement>('[data-motion-loop]')].map((loop, index) => {
                const timing = { duration: Number(loop.dataset.motionLoop) * 1000, iterations: Infinity, delay: index % 4 * stagger };
                const animations = [...loop.querySelectorAll<HTMLElement>('[data-motion]')].map(part => {
                    const animation = part.animate(JSON.parse(part.dataset.motion ?? '[]') as Keyframe[], timing);
                    // Still until its picture is in view
                    animation.pause();
                    return animation;
                });
                return { element: loop, inView: false, animations };
            });
            for (const loop of loops.current)
                observer.observe(loop.element);
        };
        start();
        query.addEventListener('change', start);
        return () => {
            query.removeEventListener('change', start);
            stop();
        };
    }, []);

    // The button or the note in its place had the focus: it goes to the one shown now
    useLayoutEffect(() => {
        if (!refocus.current)
            return;
        refocus.current = false;
        (reducedMotion ? note.current : control.current?.querySelector('button'))?.focus({ preventScroll: true });
    }, [reducedMotion]);

    const toggle = () => {
        paused.current = playing;
        setPlaying(!playing);
        for (const loop of loops.current)
            sync(loop, paused.current);
    };

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                {heading}
                {/* The button and the reduced-motion note share one cell of a fixed height: the one not shown is invisible, never removed */}
                <div ref={control} data-feature-examples-control="" className="ml-auto grid h-9 shrink-0 items-center justify-items-end pointer-coarse:h-11">
                    <Button
                        variant="plain"
                        size="sm"
                        onClick={toggle}
                        startDecorator={playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
                        className={cx('col-start-1 row-start-1 -mr-2 text-muted-foreground pointer-coarse:h-11', reducedMotion === null ? 'motion-reduce:invisible' : reducedMotion && 'invisible')}>
                        {playing ? 'Pause examples' : 'Play examples'}
                    </Button>
                    <p ref={note} tabIndex={-1} className={cx('col-start-1 row-start-1 text-right text-sm leading-tight text-muted-foreground', reducedMotion === null ? 'invisible motion-reduce:visible' : !reducedMotion && 'invisible')}>
                        Examples stay still with reduced motion.
                    </p>
                </div>
            </div>
            <div ref={root} data-feature-examples={reducedMotion ? 'still' : playing ? 'playing' : 'paused'}>
                {children}
            </div>
        </>
    );
}
