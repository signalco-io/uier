'use client';

import { useRef } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { ToolbarIllustration } from '../../brand/ToolbarIllustration';
import { appear, centerOf, FeatureCover, Pointer, useBoxes, type CoverCaption, type Point } from './FeatureCover';

// /features/pinned-comments: a comment pinned to an element, one to a dragged area and one to selected
// words on the example site, then the page scrolls and the pins go with their spots. The outlines are
// the toolbar's (packages/toolbar CommentPointOverlay: the element's dashed accent outline; an area's
// selection tint inside it while it is drawn, CommentAreaHighlight), the words keep the selection tint
// (CommentSelectionHighlight) and the pins are `<Pin />`. Recheck with packages/toolbar/docs/point-mode.md.

const phases = [
    { name: 'idle', ms: 900 },
    { name: 'point', ms: 1100 },
    { name: 'element', ms: 1200 },
    { name: 'reach', ms: 800 },
    { name: 'drag', ms: 1000 },
    { name: 'area', ms: 1200 },
    { name: 'select', ms: 800 },
    { name: 'selecting', ms: 800 },
    { name: 'words', ms: 1300 },
    { name: 'scroll', ms: 1800 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'Click anything on the page to pin a comment to it.', phases: ['idle', 'point', 'element'] },
    { text: 'Drag over an area to comment on all of it.', phases: ['reach', 'drag', 'area'] },
    { text: 'Select a few words to comment on the text.', phases: ['select', 'selecting', 'words'] },
    { text: 'Each pin stays on its spot when the page scrolls.', phases: ['scroll', 'leave', 'reset'] }
];

/**
 * A mark that grows as it is drawn (the selection, an area): it grows with ease-out, then fades out
 * and only after that goes back to its start, unseen
 */
function grow(shown: boolean, still: boolean, ms: number) {
    if (still)
        return { transition: 'none' };
    return { transition: shown ? `scale ${ms}ms ease-out, opacity 0ms linear, background-color 150ms ease-out` : 'opacity 150ms ease-out, scale 0ms linear 150ms, background-color 150ms ease-out' };
}

type Part = 'button' | 'areaStart' | 'areaEnd' | 'wordsStart' | 'wordsEnd';

export function PinnedCover() {
    return (
        <FeatureCover
            name="pinned-comments"
            phases={phases}
            captions={captions}
            stillPhase="words"
            stillCaption="Comments pinned to a button, an area of the map and a few words."
            className="h-[460px] min-h-[460px] md:h-[400px] md:min-h-[400px]">
            {(phase, still) => <Scene phase={phase} still={still} />}
        </FeatureCover>
    );
}

function Scene({ phase, still }: { phase: Phase; still: boolean }) {
    const canvas = useRef<HTMLDivElement>(null);
    const parts = useRef<Partial<Record<Part, HTMLElement | null>>>({});
    const boxes = useBoxes(canvas, parts);
    const is = (...names: Phase[]) => names.includes(phase);
    const after = (name: Phase) => phases.findIndex(item => item.name === phase) >= phases.findIndex(item => item.name === name) && !is('leave', 'reset');

    const pointerAt = (): Point => {
        if (!boxes)
            return { x: 0, y: 0 };
        if (is('point'))
            return centerOf(boxes.button);
        if (is('reach'))
            return { x: boxes.areaStart.x, y: boxes.areaStart.y };
        if (is('drag', 'area'))
            return { x: boxes.areaEnd.x, y: boxes.areaEnd.y };
        if (is('select'))
            return { x: boxes.wordsStart.x - 2, y: boxes.wordsStart.y + boxes.wordsStart.height / 2 };
        if (is('selecting', 'words'))
            return { x: boxes.wordsEnd.x, y: boxes.wordsEnd.y + boxes.wordsEnd.height / 2 };
        if (is('element'))
            return { x: boxes.button.x + boxes.button.width + 24, y: boxes.button.y + 8 };
        return { x: boxes.button.x + boxes.button.width + 60, y: boxes.button.y - 40 };
    };

    const elementPinned = after('element');
    const areaDrawn = is('drag', 'area');
    const areaPinned = after('area');
    const selected = after('selecting');
    const wordsPinned = after('words');
    const scrolled = is('scroll', 'leave');

    return (
        <div ref={canvas} className="relative h-full">
            {/* The example page: it scrolls up a little at the end, and the pins go with it */}
            <div className={cx('relative mx-auto flex max-w-[680px] flex-col px-6 pt-7 md:px-10 md:pt-9', !still && 'transition-transform duration-700 ease-out motion-reduce:transition-none', scrolled ? '-translate-y-12' : 'translate-y-0')}>
                <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">Trattoria</span>
                    <span className="flex gap-4 text-xs text-muted-foreground"><span>Menu</span><span>Visit</span><span>Book</span></span>
                </div>
                <div className="mt-8 flex flex-col gap-6 md:mt-12 md:flex-row md:items-start md:justify-between md:gap-10">
                    <div className="flex max-w-[300px] flex-col gap-3">
                        <span className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">Visit us</span>
                        <p className="text-sm leading-6 text-muted-foreground">
                            Open every day from noon. Book online or{' '}
                            <span className="relative whitespace-nowrap">
                                {/* The selection grows from the first letter to the last, as a drag would */}
                                <span style={grow(selected, still, 500)} className={cx('absolute inset-0 origin-left rounded-[3px] bg-[hsl(var(--brand-selection))]', selected ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0')} />
                                <span ref={element => { parts.current.wordsStart = element; }} />
                                <span className="relative text-foreground">call us</span>
                                <span ref={element => { parts.current.wordsEnd = element; }} />
                                <Pin number={6} size={22} className={cx('absolute left-full top-full -ml-1 -mt-1.5', appear(wordsPinned))} />
                            </span>.
                        </p>
                        <span ref={element => { parts.current.button = element; }} className="relative mt-1 inline-flex h-9 w-max items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                            Book a table
                            {/* Point mode's outline around the element under the pointer */}
                            <span className={cx('absolute inset-0 rounded-sm outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]', appear(is('point')))} />
                            <Pin number={4} size={24} className={cx('absolute left-[70%] top-[60%]', appear(elementPinned))} />
                        </span>
                    </div>
                    {/* The map: streets, the restaurant's dot, and the dragged area over part of it */}
                    <div className="relative h-[120px] w-full max-w-[300px] shrink-0 rounded-xl bg-muted md:h-[150px] md:w-[260px]">
                        <span className="absolute inset-x-0 top-[42%] h-2 bg-background" />
                        <span className="absolute inset-y-0 left-[56%] w-2 bg-background" />
                        <span className="absolute inset-y-0 left-[22%] w-1 bg-background" />
                        <span className="absolute left-[34%] top-[24%] size-2.5 rounded-full bg-foreground" />
                        <span className="absolute left-[14%] top-[10%] h-[52%] w-[48%]">
                            <span ref={element => { parts.current.areaStart = element; }} className="absolute left-0 top-0" />
                            <span ref={element => { parts.current.areaEnd = element; }} className="absolute bottom-0 right-0" />
                            {/* While it is drawn, the selection tint inside the outline; drawn, the outline alone until its pin is posted */}
                            <span style={grow(areaDrawn, still, 900)} className={cx(
                                'absolute inset-0 origin-top-left rounded-sm outline-2 outline-dashed outline-[hsl(var(--brand-accent))]',
                                is('drag') && 'bg-[hsl(var(--brand-selection))]',
                                areaDrawn ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
                            )} />
                            {/* The pin of an area sits at its bottom-right corner */}
                            <Pin number={5} size={22} className={cx('absolute left-full top-full -ml-1 -mt-1', appear(areaPinned))} />
                        </span>
                    </div>
                </div>
            </div>

            {/* The toolbar stays at the bottom of the window while the page scrolls under it */}
            <div className="absolute inset-x-0 bottom-5 flex justify-center">
                <ToolbarIllustration size="sm" unread={0} initials={null} />
            </div>
            <Pointer at={pointerAt()} visible={!still && is('point', 'element', 'reach', 'drag', 'area', 'select', 'selecting', 'words')} still={still} />
        </div>
    );
}
