'use client';

import { cx } from '@signalco/ui-primitives/cx';
import { MailIcon } from 'lucide-react';
import { Mark } from '@uier/brand/Mark';
import { AssigneeAvatar, floating, Message, ThreadHeader, type Stage } from '../LandingSpecimens';
import { fade, FeatureCover, type CoverCaption } from './FeatureCover';

// /features/threads: Mia mentions Leo in a thread, Leo gets the email (the digest names who acted,
// what happened and the page, not the comment's text: docs/review-workflow.md, "Review email
// notifications"), Leo is assigned and the thread goes in progress, then his reply comes in with
// Markdown and an image, and Mia reacts to it. The thread copies the toolbar's (ThreadHeader, Message,
// the reactions' pill: packages/toolbar MessageReactions); recheck with them.

const phases = [
    { name: 'idle', ms: 1300 },
    { name: 'email', ms: 2000 },
    { name: 'assign', ms: 1600 },
    { name: 'reply', ms: 1800 },
    { name: 'react', ms: 1600 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'Mention a teammate, and they get an email about it.', phases: ['idle', 'email'] },
    { text: 'Assign the people who fix it.', phases: ['assign'] },
    { text: 'Reply with formatting, images and reactions.', phases: ['reply', 'react', 'leave', 'reset'] }
];

export function ThreadsCover() {
    return (
        <FeatureCover
            name="threads"
            phases={phases}
            captions={captions}
            stillPhase="react"
            stillCaption="A thread with a mention, an assignee, a reply with an image and a reaction, and the email about the mention."
            className="h-[560px] min-h-[560px] md:h-[400px] md:min-h-[400px]">
            {phase => <Scene phase={phase} />}
        </FeatureCover>
    );
}

function Scene({ phase }: { phase: Phase }) {
    const is = (...names: Phase[]) => names.includes(phase);
    const emailed = is('email', 'assign', 'reply', 'react');
    const assigned = is('assign', 'reply', 'react', 'leave');
    const replied = is('reply', 'react', 'leave');
    const reacted = is('react', 'leave');
    const stage: Stage = assigned ? 'in-progress' : 'open';

    return (
        <div className="relative mx-auto flex h-full max-w-[820px] flex-col items-center justify-start gap-4 px-4 pt-6 md:flex-row md:items-center md:justify-between md:gap-10 md:px-10 md:pt-0">
            {/* The thread grows as the reply comes in; its box keeps the room, so nothing else moves */}
            <div className="flex h-[300px] w-full max-w-[340px] shrink-0 items-start md:h-[296px]">
                <div className={cx('flex w-full flex-col rounded-xl border bg-popover text-popover-foreground', floating)}>
                    <ThreadHeader stage={stage} number={14} assignees={<span className={cx('flex transition-opacity duration-150 ease-out motion-reduce:transition-none', assigned ? 'opacity-100' : 'opacity-0')}><AssigneeAvatar initials="LE" /></span>} />
                    <div className="flex flex-col gap-3 px-3.5 py-3">
                        <Message initials="MI" name="Mia" time="2 hr ago"><span className="font-medium">@Leo</span> the prices on the menu are from last year.</Message>
                        <div className={cx('grid transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none', replied ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                            <div className="min-h-0 overflow-hidden">
                                <div className={fade(replied)}>
                                    <Message initials="LE" name="Leo" time="just now">
                                        The new menu goes up on <strong className="font-semibold">Friday</strong>:
                                        <span className="mt-1 flex flex-col">
                                            <span className="ml-4 list-item list-disc">pasta prices</span>
                                            <span className="ml-4 list-item list-disc">the vegan dishes</span>
                                        </span>
                                        {/* An image attached to the reply */}
                                        <span className="mt-2 flex h-12 w-24 flex-col gap-1 rounded-md border bg-muted/50 p-2">
                                            <span className="h-1.5 w-3/4 rounded-full bg-muted-foreground/40" />
                                            <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/25" />
                                            <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/25" />
                                        </span>
                                        {/* A reaction under the message: the emoji and its count */}
                                        <span className={cx('mt-2 inline-flex h-6 w-max items-center gap-1 rounded-full border bg-muted/50 px-2 text-xs', fade(reacted))}>
                                            <span>👍</span><span className="tabular-nums">1</span>
                                        </span>
                                    </Message>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* The email Leo gets: who mentioned him and where, with a link to the thread */}
            <div className={cx('w-full min-w-0 max-w-[300px] rounded-2xl border bg-muted/50 p-3', fade(emailed))}>
                <div className="flex items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
                    <MailIcon size={14} strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">Mia mentioned you in Trattoria</span>
                    <span>2 hr ago</span>
                </div>
                <div className="flex flex-col gap-2.5 rounded-xl border bg-background p-3.5">
                    <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><Mark size={12} /></span>
                    <span className="text-sm font-semibold">Mia mentioned you</span>
                    <span className="text-xs leading-5 text-muted-foreground">On <span className="font-mono">/menu</span>, thread #14.</span>
                    <span className="inline-flex h-7 w-max items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">Open thread</span>
                </div>
            </div>
        </div>
    );
}
