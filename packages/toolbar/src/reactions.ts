/**
 * Shared, browser-safe vocabulary of message reactions (`@uier/toolbar/reactions`): GitHub's quick set, in its
 * order. The ids are stable machine values (stored, sent and never translated); each surface names them in its
 * own language. The API, the app and the toolbar use the same list, limits and optimistic toggle.
 */
export const reactionIds = ['thumbs-up', 'thumbs-down', 'laugh', 'hooray', 'confused', 'heart', 'rocket', 'eyes'] as const;
export type ReactionId = typeof reactionIds[number];

export const reactionEmoji: Record<ReactionId, string> = {
    'thumbs-up': '👍', 'thumbs-down': '👎', laugh: '😄', hooray: '🎉', confused: '😕', heart: '❤️', rocket: '🚀', eyes: '👀'
};

/** English names: the packets and the app's source phrases */
export const reactionNames: Record<ReactionId, string> = {
    'thumbs-up': 'Thumbs up', 'thumbs-down': 'Thumbs down', laugh: 'Laugh', hooray: 'Hooray', confused: 'Confused', heart: 'Heart', rocket: 'Rocket', eyes: 'Eyes'
};

/** People one message can have reactions from, counted once per reaction (keeps a thread's document bounded) */
export const MAX_MESSAGE_REACTIONS = 100;
/** Names a reaction lists besides the viewer's own; the rest are a count ("and 3 others") */
export const MAX_REACTION_NAMES = 10;

export function isReactionId(value: unknown): value is ReactionId {
    return typeof value === 'string' && (reactionIds as readonly string[]).includes(value);
}

/**
 * One reaction of a message as a viewer sees it: how many reacted, whether the viewer did (`mine`) and the names
 * of the others who did, oldest first, at most {@link MAX_REACTION_NAMES} (never the viewer's own, never an id).
 */
export type MessageReaction = { emoji: ReactionId; count: number; mine: boolean; names: string[] };

/** Reactions in the quick set's order, without empty ones; unknown values from older or newer servers are dropped */
export function messageReactions(value: unknown): MessageReaction[] {
    if (!Array.isArray(value)) return [];
    const reactions = value.filter((reaction): reaction is MessageReaction => {
        const candidate = reaction as Partial<Record<keyof MessageReaction, unknown>> | null;
        return typeof candidate === 'object' && candidate !== null && isReactionId(candidate.emoji)
            && typeof candidate.count === 'number' && Number.isInteger(candidate.count) && candidate.count > 0;
    });
    return reactionIds.flatMap(id => {
        const reaction = reactions.find(item => item.emoji === id);
        return reaction ? [{ emoji: id, count: reaction.count, mine: reaction.mine === true,
            names: Array.isArray(reaction.names) ? reaction.names.filter(name => typeof name === 'string') : [] }] : [];
    });
}

/** The reactions as they show at once after the viewer adds (`reacted`) or removes their own, before the API answers */
export function withOwnReaction(reactions: readonly MessageReaction[] | undefined, emoji: ReactionId, reacted: boolean): MessageReaction[] {
    const current = messageReactions(reactions);
    const existing = current.find(reaction => reaction.emoji === emoji);
    if (Boolean(existing?.mine) === reacted) return current;
    const changed = existing
        ? { ...existing, mine: reacted, count: existing.count + (reacted ? 1 : -1) }
        : { emoji, count: 1, mine: true, names: [] };
    return messageReactions([...current.filter(reaction => reaction.emoji !== emoji), changed]);
}

/**
 * Who reacted, in the order a list of names reads: the viewer first (as `you`), then the names, then how many
 * more there are (`others(count)`). Join the result with the language's `Intl.ListFormat`.
 */
export function reactionPeople(reaction: MessageReaction, you: string, others: (count: number) => string) {
    const people = [...(reaction.mine ? [you] : []), ...reaction.names];
    const rest = reaction.count - people.length;
    return rest > 0 ? [...people, others(rest)] : people;
}
