'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from '@signalco/ui-icons';
import { Button } from '@signalco/ui-primitives/Button';

// Plays the loops of the landing's feature tiles (apps/web/docs/landing-page.md, "The tiles play").
// Each animated specimen is a `[data-motion-loop]` with its length in seconds, and its moving parts
// carry their keyframes in `data-motion` (specimenMotion.tsx). This only hands them to the browser's
// animation engine: no state per frame, no measuring, and the pictures stay server-rendered.
//
// - A loop plays only while half of its picture is in view, and goes on from where it stopped.
// - One button pauses every tile (WCAG 2.2.2); the tiles are links, so they get no button each.
// - With reduced motion (read live) there are no animations and no button: the still pictures.
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
    const loops = useRef<Loop[]>([]);
    const paused = useRef(false);
    const [playing, setPlaying] = useState(true);
    const [reducedMotion, setReducedMotion] = useState(false);

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
                {!reducedMotion && (
                    <Button
                        variant="plain"
                        size="sm"
                        onClick={toggle}
                        startDecorator={playing ? <Pause size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
                        className="-mx-2 shrink-0 text-muted-foreground motion-reduce:hidden">
                        {playing ? 'Pause examples' : 'Play examples'}
                    </Button>
                )}
            </div>
            <div ref={root} data-feature-examples={reducedMotion ? 'still' : playing ? 'playing' : 'paused'}>
                {children}
            </div>
        </>
    );
}
