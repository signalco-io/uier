'use client';

import { useRef } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { Pin } from '@uier/brand/Pin';
import { ToolbarIllustration } from '../../brand/ToolbarIllustration';
import { AccessibilityPanelSpecimen } from '../ChecksSpecimens';
import { appear, centerOf, fade, FeatureCover, Pointer, useBoxes, type CoverCaption, type Point } from './FeatureCover';

// /features/page-checks: the example site's menu with the toolbar. The background check finds
// something (the Page checks button's amber dot), the Accessibility panel opens docked beside the page,
// Highlight outlines the price that fails the contrast check (ElementHighlight: the dashed accent outline
// with the selection tint), and Comment posts it as a comment whose pin lands on the price. The panel
// is the one the landing's tile and this page's pictures share (AccessibilityPanelSpecimen); recheck
// with packages/toolbar/docs/page-checks.md.

const phases = [
    { name: 'idle', ms: 1300 },
    { name: 'open', ms: 1500 },
    { name: 'highlight', ms: 1700 },
    { name: 'comment', ms: 900 },
    { name: 'posted', ms: 1900 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'Each page is checked in the background while you review it.', phases: ['idle', 'open'] },
    { text: 'Highlight shows on the page what a check found.', phases: ['highlight'] },
    { text: 'Comment posts it as a comment, pinned to the element.', phases: ['comment', 'posted', 'leave', 'reset'] }
];

type Part = 'highlight' | 'comment';

export function ChecksCover() {
    return (
        <FeatureCover
            name="page-checks"
            phases={phases}
            captions={captions}
            stillPhase="posted"
            stillCaption="The Accessibility panel beside the page, and a contrast issue it found posted as a comment on the price."
            className="h-[600px] min-h-[600px] md:h-[480px] md:min-h-[480px]">
            {(phase, still) => <Scene phase={phase} still={still} />}
        </FeatureCover>
    );
}

function Scene({ phase, still }: { phase: Phase; still: boolean }) {
    const canvas = useRef<HTMLDivElement>(null);
    const parts = useRef<Partial<Record<Part, HTMLElement | null>>>({});
    const boxes = useBoxes(canvas, parts);
    const is = (...names: Phase[]) => names.includes(phase);
    const panel = is('open', 'highlight', 'comment', 'posted');
    const highlighted = is('highlight', 'comment');
    const posted = is('posted', 'leave');
    const dishes = [['Tagliatelle al ragù', '€14'], ['Cacio e pepe', '€12'], ['Tiramisù', '€7']];

    const pointerAt = (): Point => {
        if (!boxes)
            return { x: 0, y: 0 };
        if (!is('highlight', 'comment'))
            return { x: boxes.highlight.x + 40, y: boxes.highlight.y + 72 };
        const center = centerOf(is('highlight') ? boxes.highlight : boxes.comment);
        return { x: center.x - 2, y: center.y - 2 };
    };

    return (
        <div ref={canvas} className="relative mx-auto flex h-full max-w-[820px] flex-col items-center gap-6 px-4 pt-6 md:flex-row md:items-start md:justify-between md:gap-10 md:px-10 md:pt-10">
            {/* The example page */}
            <div className="flex w-full max-w-[300px] flex-col md:pt-4">
                <span className="hidden text-sm font-semibold md:block">Trattoria</span>
                <span className="text-[22px] font-semibold tracking-[-0.02em] md:mt-8 md:text-[26px]">Menu</span>
                <div className="mt-3 flex flex-col text-sm">
                    {dishes.map(([dish, price], index) => (
                        <span key={dish} className="flex justify-between gap-3 border-b py-1.5">
                            <span>{dish}</span>
                            {index === 0
                                ? (
                                    <span className="relative tabular-nums text-muted-foreground">
                                        {/* Highlight: the outline and tint of the element a check found */}
                                        <span className={cx('absolute -inset-0.5 rounded-[3px] bg-[hsl(var(--brand-selection))] outline-2 outline-offset-2 outline-dashed outline-[hsl(var(--brand-accent))]', appear(highlighted))} />
                                        <span className="relative">{price}</span>
                                        <Pin number={24} size={22} className={cx('absolute left-[60%] top-[60%]', appear(posted))} />
                                    </span>
                                )
                                : <span className="tabular-nums text-muted-foreground">{price}</span>}
                        </span>
                    ))}
                </div>
                <span className="mt-3 hidden text-xs text-muted-foreground md:block">Ask us about allergens.</span>
            </div>

            {/* The Accessibility panel, docked beside the page */}
            <div
                ref={element => {
                    // The row's buttons; the Comment button leaves once the comment is posted, so keep the first found
                    const highlight = element?.querySelector<HTMLElement>('[data-issue-highlight]');
                    const comment = element?.querySelector<HTMLElement>('[data-issue-comment]');
                    if (highlight)
                        parts.current.highlight = highlight;
                    if (comment)
                        parts.current.comment = comment;
                }}
                className={cx('w-full max-w-[340px] shrink-0', fade(panel))}>
                <AccessibilityPanelSpecimen highlighted={highlighted} posted={posted ? 24 : undefined} />
            </div>

            {/* The toolbar: Page checks has the amber dot while a check found something to act on */}
            <div className="absolute inset-x-0 bottom-5 hidden justify-center md:flex">
                <ToolbarIllustration size="sm" unread={0} initials="LE" attention />
            </div>
            <Pointer at={pointerAt()} visible={!still && is('highlight', 'comment')} still={still} />
        </div>
    );
}
