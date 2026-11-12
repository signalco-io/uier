import type { CSSProperties } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { avatarText } from './CommentThreadItem';
import type { CommentItem } from './@types/Comments';

export type ThreadParticipant = { key: string; name: string; isMe: boolean };

/** At most this many avatars beside a pin; past it, the first ones less one and "+N" */
const shownMax = 3;
/** An avatar's size and how much of it the next one covers, in px */
const avatarSize = 20;
const avatarOverlap = 9;
/**
 * How far the stack tucks under the pin's edge, and how far a hovered or focused pin slides it
 * out: the first avatar this much, each next one `spreadStep` more, so they part a little (uier #317)
 */
export const participantsTuck = 8;
const slideOut = 6;
const spreadStep = 3;

/**
 * Who takes part in a thread, in the order they first wrote: its author, then the people who
 * replied. A message an AI agent wrote for someone ("Ana via Claude") counts as theirs. Deleted
 * messages and those still being sent are left out.
 */
export function threadParticipants(comment: CommentItem, guest: string): ThreadParticipant[] {
    const people = new Map<string, ThreadParticipant>();
    for (const item of comment.thread.items) {
        if (item.deleted || item.pending) continue;
        const name = item.author?.name || guest;
        const via = item.agent ? ` via ${item.agent.label}` : '';
        const person = via && name.endsWith(via) ? name.slice(0, -via.length) : name;
        const isMe = Boolean(item.author?.isMe);
        const key = isMe ? 'me' : `name:${person}`;
        if (!people.has(key)) people.set(key, { key, name: person, isMe });
    }
    return [...people.values()];
}

/** The avatars shown and the "+N" after them */
function shownParticipants(people: ThreadParticipant[]) {
    if (people.length <= shownMax) return { shown: people, more: 0 };
    return { shown: people.slice(0, shownMax - 1), more: people.length - (shownMax - 1) };
}

/** How wide the stack is once slid out, to choose its side of the pin */
export function participantsWidth(people: ThreadParticipant[]) {
    const { shown, more } = shownParticipants(people);
    const count = shown.length + (more ? 1 : 0);
    return count ? avatarSize + (count - 1) * (avatarSize - avatarOverlap) + slideOut + (count - 1) * spreadStep : 0;
}

/** An avatar's place in the stack: the author in front, each next one further back, sliding out further */
function stackStyle(index: number, count: number, side: 'left' | 'right') {
    const shift = slideOut + index * spreadStep;
    return {
        zIndex: count - index,
        '--uier-slide': `${side === 'right' ? shift : -shift}px`
    } as CSSProperties;
}

/**
 * The avatars of the people in a pin's thread, a small overlapping stack beside the pin (uier
 * #307), so it shows whose thread it is. Tucked partly under the pin, the author in front; a
 * hovered or focused pin slides it out a little (uier #317), reduced motion jumps to it. Part of the pin's button (hovering or pressing them is
 * the pin's), decorative: the pin's description names the people. The letters are generated
 * content, so the pin's text stays its number and message count. Ink like the pin (the dark
 * tokens), whatever the system theme.
 */
export function PinParticipants({ people, side }: { people: ThreadParticipant[]; side: 'left' | 'right' }) {
    const { shown, more } = shownParticipants(people);
    if (!shown.length) return null;
    const count = shown.length + (more ? 1 : 0);
    const avatarClassName = cx(
        'relative flex h-5 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-semibold leading-none text-foreground ring-[1.5px] ring-foreground',
        'transition-transform duration-150 ease-out motion-reduce:transition-none group-hover:translate-x-(--uier-slide) group-focus-visible:translate-x-(--uier-slide)',
        side === 'right' ? '-ml-[9px] first:ml-0' : '-mr-[9px] first:mr-0'
    );
    return (
        <span
            aria-hidden="true"
            data-uier-participants={side}
            className={cx(
                // Behind the pin (and its message count badge), partly under its edge
                'dark absolute top-1/2 -z-10 flex -translate-y-1/2 items-center',
                // From the pin itself, not its touch padding
                side === 'right'
                    ? 'left-[calc(100%-8px)] flex-row pointer-coarse:left-[calc(100%-14px)]'
                    : 'right-[calc(100%-8px)] flex-row-reverse pointer-coarse:right-[calc(100%-14px)]'
            )}>
            {shown.map((person, index) => (
                <span
                    key={person.key}
                    data-uier-participant={avatarText(person.name)}
                    style={stackStyle(index, count, side)}
                    className={cx(avatarClassName, 'w-5 after:content-[attr(data-uier-participant)]')} />
            ))}
            {more > 0 && (
                <span
                    data-uier-participants-more={`+${more}`}
                    style={stackStyle(shown.length, count, side)}
                    className={cx(avatarClassName, 'min-w-5 px-1 tabular-nums after:content-[attr(data-uier-participants-more)]')} />
            )}
        </span>
    );
}
