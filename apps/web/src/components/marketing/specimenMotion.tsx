import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@uier/ui-primitives/cx';

// The script of a feature tile's loop on the landing page (apps/web/docs/landing-page.md, "The tiles
// play"). A specimen stays the still picture it is everywhere else; with a loop, its moving parts carry
// their keyframes in `data-motion` and `FeatureExamples` plays them with the Web Animations API, so the
// specimens stay server components and nothing re-renders while they play.
//
// Every loop starts and ends on the still picture: it rests, the parts the story adds leave together,
// come back one step at a time, and the full picture rests again. Times are seconds into the loop.
// The motion is the brand's (ease-out, a fade plus an 8 px slide, no bounces), played slower than the
// product so each step can be followed (BRAND.md, "Motion").

/** The still picture rests this long before anything leaves */
export const rest = 1.4;
/** A part leaves in 400 ms and comes in 500 ms */
const leave = 0.4;
const come = 0.5;

type Frame = { at: number; easing?: string; opacity?: number; translate?: string; scale?: string; rotate?: string; boxShadow?: string };

/** What a moving part spreads on its element; empty without a loop */
type Track = { 'data-motion'?: string; style?: CSSProperties };

export type SpecimenLoop = ReturnType<typeof specimenLoop>;

/** The loop of one specimen, `seconds` long; without `seconds` every track is empty and the picture stays still */
export function specimenLoop(seconds?: number) {
    /** Keyframes at their seconds; the first and the last also hold from the loop's start and to its end */
    const frames = (list: Frame[], hidden?: boolean): Track => {
        if (!seconds)
            return {};
        const first = list[0]!;
        const last = list[list.length - 1]!;
        const all = [
            ...(first.at > 0 ? [{ ...first, at: 0, easing: undefined }] : []),
            ...list,
            ...(last.at < seconds ? [{ ...last, at: seconds, easing: undefined }] : [])
        ];
        all.forEach((frame, index) => {
            const before = all[index - 1];
            if (frame.at > seconds || (before && frame.at < before.at))
                throw new Error(`A specimen's keyframes must be in order within its ${seconds} s loop (${frame.at} s)`);
        });
        return {
            'data-motion': JSON.stringify(all.map(({ at, ...frame }) => ({ offset: Math.round(at / seconds * 10000) / 10000, ...frame }))),
            // Shown only while the loop plays: out of the still picture
            ...(hidden && { style: { opacity: 0 } })
        };
    };
    const slid = (slide: number) => slide ? { translate: `0px ${slide}px` } : {};
    const placed = (slide: number) => slide ? { translate: '0px 0px' } : {};

    return {
        on: !!seconds,
        /** For the specimen's root: the loop's length, and inert like every animated picture (the axe scan skips a frame caught mid-fade) */
        root: seconds ? { 'data-motion-loop': seconds, inert: true } : {},
        frames,
        /** Part of the still picture: leaves at `from`, comes back at `at` with the fade and an 8 px slide (`slide: -8` drops in from above, `0` fades in place) */
        enter(at: number, { from = rest, slide = 8 }: { from?: number; slide?: number } = {}) {
            return frames([
                { at: from, opacity: 1, ...placed(slide), easing: 'ease-out' },
                { at: from + leave, opacity: 0, ...placed(slide) },
                { at, opacity: 0, ...slid(slide), easing: 'ease-out' },
                { at: at + come, opacity: 1, ...placed(slide) }
            ]);
        },
        /** Not in the still picture: shown from `from` until `to` */
        during(from: number, to: number) {
            return frames([
                { at: from, opacity: 0, easing: 'ease-out' },
                { at: from + come, opacity: 1 },
                { at: to, opacity: 1, easing: 'ease-out' },
                { at: to + leave, opacity: 0 }
            ], true);
        },
        /** Part of the still picture: leaves with the rest, then grows from its origin between `from` and `to` (a dragged area, selected words) */
        grow(from: number, to: number, axis: 'x' | 'both' = 'both') {
            const small = axis === 'x' ? '0 1' : '0.05 0.05';
            return frames([
                { at: rest, opacity: 1, scale: '1 1', easing: 'ease-out' },
                { at: rest + leave, opacity: 0, scale: '1 1' },
                { at: from - 0.1, opacity: 0, scale: small },
                { at: from, opacity: 1, scale: small, easing: 'ease-out' },
                { at: to, opacity: 1, scale: '1 1' }
            ]);
        },
        /**
         * A pointer's way: `[seconds, x, y]` stops, each an offset from where the pointer sits. It fades in
         * on the way to the second stop and out on the way to the last; two stops at one place are a rest.
         */
        pointer(stops: [number, string, string][]) {
            return frames(stops.map(([at, x, y], index) => ({
                at,
                opacity: index === 0 || index === stops.length - 1 ? 0 : 1,
                translate: `${x} ${y}`,
                easing: 'ease-out'
            })), true);
        }
    };
}

/** The mouse pointer of a loop (the walkthrough's and the covers' shape); its tip is its top-left corner */
export function LoopPointer({ track, className }: { track: Track; className?: string }) {
    return (
        <svg viewBox="0 0 16 20" width="16" height="20" {...track} className={cx('pointer-events-none absolute z-30', className)}>
            <path d="M1 1v15.5l4.2-4 2.9 6.5 2.6-1.2-2.9-6.4H14z" fill="hsl(var(--foreground))" stroke="hsl(var(--background))" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * A value the loop changes: `was` stands in from `from` until `to`, in the same box, so nothing beside
 * it moves. One leaves before the other comes, so the two never show through each other.
 */
export function Swap({ loop, was, from, to, children }: { loop: SpecimenLoop; was: ReactNode; from: number; to: number; children: ReactNode }) {
    if (!loop.on)
        return children;
    return (
        <span className="relative inline-block">
            <span {...loop.enter(to + leave, { from, slide: 0 })}>{children}</span>
            <span className="absolute inset-0 whitespace-nowrap" {...loop.during(from + leave, to)}>{was}</span>
        </span>
    );
}
