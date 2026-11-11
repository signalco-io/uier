import { cx } from '@signalco/ui-primitives/cx';
import { avatarText } from './CommentThreadItem';
import type { CommentItem } from './@types/Comments';

export type ThreadParticipant = { key: string; name: string; isMe: boolean };

/** At most this many avatars beside a pin; past it, the first ones less one and "+N" */
const shownMax = 3;
/** An avatar's size and how much of it the next one covers, in px */
const avatarSize = 20;
const avatarOverlap = 6;
/** The stack's distance from the pin, past the message count badge */
export const participantsGap = 6;

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

/** How wide the stack is, to choose its side of the pin */
export function participantsWidth(people: ThreadParticipant[]) {
    const { shown, more } = shownParticipants(people);
    const count = shown.length + (more ? 1 : 0);
    return count ? avatarSize + (count - 1) * (avatarSize - avatarOverlap) : 0;
}

/**
 * The avatars of the people in a pin's thread, a small overlapping stack beside the pin (uier
 * #307), so it shows whose thread it is. Part of the pin's button (hovering or pressing them is
 * the pin's), decorative: the pin's description names the people. The letters are generated
 * content, so the pin's text stays its number and message count. Ink like the pin (the dark
 * tokens), whatever the system theme.
 */
export function PinParticipants({ people, side }: { people: ThreadParticipant[]; side: 'left' | 'right' }) {
    const { shown, more } = shownParticipants(people);
    if (!shown.length) return null;
    return (
        <span
            aria-hidden="true"
            data-uier-participants={side}
            className={cx(
                'dark absolute top-1/2 flex -translate-y-1/2 items-center',
                // From the pin itself, not its touch padding
                side === 'right'
                    ? 'left-[calc(100%+6px)] flex-row pointer-coarse:left-full'
                    : 'right-[calc(100%+6px)] flex-row-reverse pointer-coarse:right-full'
            )}>
            {shown.map(person => (
                <span
                    key={person.key}
                    data-uier-participant={avatarText(person.name)}
                    className={cx(
                        'flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[10px] font-semibold leading-none text-foreground ring-[1.5px] ring-foreground after:content-[attr(data-uier-participant)]',
                        side === 'right' ? '-ml-1.5 first:ml-0' : '-mr-1.5 first:mr-0'
                    )} />
            ))}
            {more > 0 && (
                <span
                    data-uier-participants-more={`+${more}`}
                    className={cx(
                        'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold leading-none text-foreground tabular-nums ring-[1.5px] ring-foreground after:content-[attr(data-uier-participants-more)]',
                        side === 'right' ? '-ml-1.5' : '-mr-1.5'
                    )} />
            )}
        </span>
    );
}
