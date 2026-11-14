'use client';

import { useRef, type ReactNode } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { FlagIcon, GitPullRequestIcon } from 'lucide-react';
import { AssigneeAvatar, Avatar, floating, StatusDot, stageLabels, type Stage } from '../LandingSpecimens';
import { centerOf, fade, FeatureCover, Pointer, useBoxes, type CoverCaption, type Point } from './FeatureCover';

// /features/board: the app's board (CommentBoard, CommentRow's card layout) with one thread going from
// Open to Done. It is dragged to In progress, then to Ready to verify, where the board asks for the
// request first (the request form's words are the verification controls': Fix summary, Fix link
// (optional), Reviewer, Request verification), and when the reviewer confirms the fix it travels to
// Done on its own, as a card moves for everyone when its status changes. While a card is dragged the
// columns it can go to are dashed and the one under it is highlighted. Recheck with
// apps/web/docs/comments-inbox.md and docs/review-workflow.md ("In progress", "Fix verification").

const phases = [
    { name: 'idle', ms: 1000 },
    { name: 'grab', ms: 800 },
    { name: 'drag', ms: 1000 },
    { name: 'dropped', ms: 1100 },
    { name: 'grab2', ms: 800 },
    { name: 'drag2', ms: 1000 },
    { name: 'request', ms: 2000 },
    { name: 'requested', ms: 1200 },
    { name: 'confirm', ms: 1900 },
    { name: 'leave', ms: 600 },
    { name: 'reset', ms: 300 }
] as const;

type Phase = (typeof phases)[number]['name'];

const captions: CoverCaption<Phase>[] = [
    { text: 'Drag a thread to In progress when someone starts on it.', phases: ['idle', 'grab', 'drag', 'dropped'] },
    { text: 'Ready to verify asks a reviewer to check the fix.', phases: ['grab2', 'drag2', 'request', 'requested'] },
    { text: 'When the reviewer confirms the fix, the thread is done.', phases: ['confirm', 'leave', 'reset'] }
];

const columns: Stage[] = ['open', 'in-progress', 'ready', 'done'];

type BoardCard = { number: number; title: string; path: string; author: string; assignee?: string; agent?: boolean; priority?: 'high' | 'urgent'; pullRequest?: boolean };

/** The cards that stay in their column, and how many more each column holds below them */
const resting: Record<Stage, { count: number; cards: BoardCard[] }> = {
    open: { count: 4, cards: [{ number: 17, title: 'Add the vegan dishes to the menu.', path: '/menu', author: 'NO' }] },
    'in-progress': { count: 2, cards: [{ number: 14, title: 'The prices here are from last year.', path: '/menu', author: 'MI', assignee: 'LE', agent: true, priority: 'high', pullRequest: true }] },
    ready: { count: 1, cards: [{ number: 12, title: 'The booking button hides behind the menu.', path: '/book', author: 'NO', assignee: 'LE', pullRequest: true }] },
    done: { count: 9, cards: [{ number: 7, title: 'Sunday says closed.', path: '/contact', author: 'MI', assignee: 'NO' }] }
};

const moving: BoardCard = { number: 18, title: 'The map does not open in the maps app.', path: '/contact', author: 'MI', assignee: 'LE', priority: 'urgent' };

/** The column the moving card is in at each phase */
function columnAt(phase: Phase): Stage {
    if (phase === 'drag' || phase === 'dropped' || phase === 'grab2')
        return 'in-progress';
    if (phase === 'drag2' || phase === 'request' || phase === 'requested')
        return 'ready';
    if (phase === 'confirm' || phase === 'leave')
        return 'done';
    return 'open';
}

export function BoardCover() {
    return (
        <FeatureCover
            name="board"
            phases={phases}
            captions={captions}
            stillPhase="requested"
            stillCaption="The board’s four columns, from Open to Done, with a thread waiting for its reviewer in Ready to verify."
            className="h-[480px] min-h-[480px] md:h-[380px] md:min-h-[380px]">
            {(phase, still) => <Scene phase={phase} still={still} />}
        </FeatureCover>
    );
}

function Scene({ phase, still }: { phase: Phase; still: boolean }) {
    const canvas = useRef<HTMLDivElement>(null);
    const parts = useRef<Partial<Record<Stage, HTMLElement | null>>>({});
    const boxes = useBoxes(canvas, parts);
    const is = (...names: Phase[]) => names.includes(phase);
    const column = columnAt(phase);
    const dragging = is('drag', 'drag2');
    const slot = boxes?.[column];
    const pointer: Point = slot ? centerOf(slot) : { x: 0, y: 0 };

    // Dragged, the card follows the pointer; when someone else changes its status, it travels for 200 ms
    // (the inline transition replaces `fade`'s, so it names the fade's properties too)
    const travel = still || is('reset') ? 'none' : `transform ${dragging ? 700 : 200}ms ease-out, opacity 150ms ease-out, translate 150ms ease-out`;
    // The column a dragged card comes from; the others are where it can go
    const source: Stage | null = is('drag') ? 'open' : is('drag2') ? 'in-progress' : null;

    return (
        <div ref={canvas} className="relative mx-auto h-full max-w-[920px] px-4 pt-6 md:px-8 md:pt-10">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {columns.map(stage => {
                    const here = column === stage;
                    // While a card is dragged, the columns it can go to are dashed and the one under it highlighted
                    const target = !!source && stage !== source;
                    return (
                        <div key={stage} className={cx(
                            'flex min-w-0 flex-col gap-2 rounded-2xl border bg-muted/50 p-2 transition-colors duration-150 ease-out',
                            target && 'border-dashed border-foreground/30',
                            target && here && 'bg-muted'
                        )}>
                            <span className="flex items-center gap-2 px-1.5 pt-0.5 text-xs font-medium">
                                <StatusDot stage={stage} />
                                <span className="truncate">{stageLabels[stage]}</span>
                                <span className="font-normal tabular-nums text-muted-foreground">{resting[stage].count + (here ? 1 : 0)}</span>
                            </span>
                            {resting[stage].cards.map(card => <Card key={card.number} card={card} />)}
                            {/* The room the moving card takes in this column */}
                            <div ref={element => { parts.current[stage] = element; }} className="h-[76px] rounded-xl" />
                        </div>
                    );
                })}
            </div>

            {/* The card that moves, over the room of its column */}
            {slot && (
                <div
                    style={{ width: slot.width, transform: `translate(${slot.x}px, ${slot.y}px)`, transition: travel }}
                    className={cx('absolute left-0 top-0 z-10', dragging && 'rounded-xl', fade(!is('leave', 'reset')))}>
                    <Card card={moving} lifted={dragging} />
                </div>
            )}

            {/* Ready to verify asks for the request first */}
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
                <div className={cx('flex w-full max-w-[300px] flex-col gap-2.5 rounded-2xl border bg-popover p-4 text-popover-foreground', floating, fade(is('request')))}>
                    <span className="text-sm font-semibold">Request verification</span>
                    <Field label="Fix summary">The map link opens the maps app now.</Field>
                    <Field label="Fix link (optional)"><span className="font-mono text-muted-foreground">staging.example.com/contact</span></Field>
                    <Field label="Reviewer"><span className="flex items-center gap-2"><Avatar initials="MI" small />Mia</span></Field>
                    <span className="mt-1 flex justify-end gap-1.5 text-xs font-medium">
                        <span className="inline-flex h-7 items-center rounded-md border px-2.5">Cancel</span>
                        <span className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-primary-foreground">Request verification</span>
                    </span>
                </div>
            </div>

            <Pointer at={{ x: pointer.x + 12, y: pointer.y + 4 }} visible={!still && is('grab', 'drag', 'grab2', 'drag2')} still={still} />
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <span className="flex flex-col gap-1">
            <span className="text-xs font-medium">{label}</span>
            <span className="flex h-8 items-center truncate rounded-md border px-2.5 text-xs">{children}</span>
        </span>
    );
}

/** One card of the board: the author, number and title, then the path, marks and the assignee */
function Card({ card, lifted }: { card: BoardCard; lifted?: boolean }) {
    return (
        <div className={cx('flex h-[76px] flex-col gap-1.5 rounded-xl border bg-background p-2.5 transition-shadow duration-150 ease-out', lifted && floating)}>
            <span className="flex items-start gap-1.5">
                <Avatar initials={card.author} small />
                <span className="line-clamp-2 min-w-0 text-xs leading-4"><span className="font-mono text-muted-foreground">#{card.number}</span> {card.title}</span>
            </span>
            <span className="mt-auto flex items-center gap-1.5 pl-[26px] text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono">{card.path}</span>
                {card.pullRequest && <GitPullRequestIcon size={12} strokeWidth={1.75} className="shrink-0" />}
                {card.priority && <FlagIcon size={12} strokeWidth={1.75} className={cx('shrink-0', card.priority === 'urgent' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--brand-warning))]')} />}
                {card.assignee && <AssigneeAvatar initials={card.assignee} agent={card.agent} small />}
            </span>
        </div>
    );
}

