import { z } from 'zod';
import { isReactionId, MAX_MESSAGE_REACTIONS, MAX_REACTION_NAMES, reactionIds, type MessageReaction } from '@uier/toolbar/reactions';
import type { DbComment, DbReaction, DbThreadItem } from '../db/schema';
import { apiErrors } from './http';
import { isValidId } from './validation';
import { displayName } from './visitor';

// Emoji reactions to a thread's messages (the first one and each reply), stored on the message itself, so the
// realtime source and every list read see them with the thread. A reaction is not content: it adds no unread
// activity, history, notification, integration change or content revision, and it never changes `updatedAt`.

/** `POST .../comments/<id>/reactions`: add (`reacted: true`) or remove the reviewer's own reaction to one message */
export const reactionInputSchema = z.object({
    itemId: z.string().refine(isValidId),
    emoji: z.enum(reactionIds),
    reacted: z.boolean()
}).strict();
export type ReactionInput = z.infer<typeof reactionInputSchema>;

/** Who reacts: their author id (`actorAuthorId`, `writerId`) and, for a project's guest, the name they gave */
export type Reactor = { id: string; name?: string };

/** Only well-formed entries of the quick set (old or hand-edited documents may contain anything) */
function storedReactions(item: DbThreadItem): DbReaction[] {
    return (Array.isArray(item.reactions) ? item.reactions : []).flatMap(reaction => {
        if (typeof reaction !== 'object' || reaction === null || !isReactionId(reaction.emoji) || !Array.isArray(reaction.by)) return [];
        const by = reaction.by.filter(person => typeof person === 'object' && person !== null && typeof person.id === 'string');
        return by.length ? [{ emoji: reaction.emoji, by }] : [];
    });
}

/**
 * The comment with the reactor's reaction to one message added or removed, or the same comment when it already
 * is that way (a repeated request changes nothing). A deleted message takes none, and a message holds at most
 * {@link MAX_MESSAGE_REACTIONS} reactions over all its emoji, so the thread's document stays bounded.
 */
export function withReaction(comment: DbComment, input: ReactionInput, reactor: Reactor): DbComment {
    const items = Array.isArray(comment.thread?.items) ? comment.thread.items : [];
    const index = items.findIndex(item => item.id === input.itemId);
    const item = items[index];
    if (!item || item.deletedAt) throw apiErrors.notFound('Message not found.');

    const reactions = storedReactions(item);
    const current = reactions.find(reaction => reaction.emoji === input.emoji);
    if (Boolean(current?.by.some(person => person.id === reactor.id)) === input.reacted) return comment;

    let next: DbReaction[];
    if (input.reacted) {
        if (reactions.reduce((total, reaction) => total + reaction.by.length, 0) >= MAX_MESSAGE_REACTIONS)
            throw apiErrors.invalidRequest('This message has all the reactions it can take.');
        const person: Reactor = reactor.name ? { id: reactor.id, name: reactor.name } : { id: reactor.id };
        next = current
            ? reactions.map(reaction => reaction === current ? { ...reaction, by: [...reaction.by, person] } : reaction)
            : [...reactions, { emoji: input.emoji, by: [person] }];
    } else {
        next = reactions.map(reaction => reaction === current ? { ...reaction, by: reaction.by.filter(person => person.id !== reactor.id) } : reaction)
            .filter(reaction => reaction.by.length);
    }

    const updated: DbThreadItem = { ...item, reactions: next };
    if (!next.length) delete updated.reactions;
    return { ...comment, thread: { ...comment.thread, items: items.map((other, at) => at === index ? updated : other) } };
}

/** The account ids of members who reacted to any message of the comments (`authorNames` loads their names) */
export function reactorUserIds(items: readonly DbThreadItem[]) {
    return items.flatMap(item => storedReactions(item).flatMap(reaction => reaction.by))
        .flatMap(person => person.id.startsWith('user:') ? [person.id.slice('user:'.length)] : []);
}

function reactorName(person: Reactor, names: Map<string, string>) {
    if (person.id.startsWith('user:')) return names.get(person.id.slice('user:'.length)) ?? 'Former member';
    return person.name || displayName(person.id);
}

/**
 * A message's reactions as `viewerId` sees them: in the quick set's order, each with its count, whether the viewer
 * reacted and the names of the others who did (current account names, a guest's given name), never an id.
 * `undefined` for a message without reactions or a deleted one.
 */
export function reactionViews(item: DbThreadItem, viewerId: string | undefined, names: Map<string, string>): MessageReaction[] | undefined {
    if (typeof item.deletedAt === 'string') return undefined;
    const reactions = storedReactions(item);
    const views = reactionIds.flatMap(emoji => {
        const by = reactions.find(reaction => reaction.emoji === emoji)?.by ?? [];
        const others = by.filter(person => !viewerId || person.id !== viewerId);
        return by.length ? [{ emoji, count: by.length, mine: others.length < by.length, names: others.slice(0, MAX_REACTION_NAMES).map(person => reactorName(person, names)) }] : [];
    });
    return views.length ? views : undefined;
}
