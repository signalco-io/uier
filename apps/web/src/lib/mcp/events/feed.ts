import type { DbProject } from '../../app/model';
import type { DbComment } from '../../db/schema';
import type { NotificationEvent } from '../../notifications/delivery';
import { getCommentsStore, type CommentsStore } from '../../repo/commentsStore';
import type { ProjectActor } from '../../review/actor';
import { canSeeComment, projectPartition } from '../../review/comments';
import { participantNames } from '../../review/dto';
import type { McpIdentity } from '../credentials';
import { eventMatches, mcpEventData, mcpEventId, type McpEventArguments, type McpEventName } from './catalog';

/*
 * A stateless feed of a project's events since a client-held cursor, for `events/poll`, the
 * `list_feedback_events` tool and push streams (`events/stream`, which polls it). Nothing is stored
 * per client. Webhook subscriptions issue cursors in the same format (a watermark only), so a cursor
 * from one delivery mode resumes in another.
 *
 * The cursor is `v1:<watermark>:<from>:<seen>`: every event at or before the watermark was
 * returned or skipped; `from` (from a null cursor) excludes earlier events, keeping those of its
 * own millisecond (at least once); `seen` lists events
 * after the watermark that were already returned. The watermark trails the poll by the settle
 * time, so an event committed late (its time precedes its commit by up to the 30-second request
 * limit) is still returned, and `seen` keeps it from being returned twice.
 */

/** Covers the commit lag and clock skew between the app and storage write times. */
const SETTLE_MS = 60_000;
/** The oldest position a cursor can resume from */
export const REPLAY_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
/** Threads one poll reads; more changes than this start the feed again from now (`truncated`). */
const MAX_THREADS = 1000;
const MAX_SEEN = 200;
export const NEXT_POLL_MS = 30_000;
export const MAX_CURSOR_LENGTH = 8192;

export type FeedCursor = { watermark: number; from?: number; seen: [string, number][] };
type Cursor = FeedCursor;
const shortId = (eventId: string) => eventId.slice(4, 16);
const cursorPattern = /^v1:([0-9a-z]{1,11}):([0-9a-z]{0,11}):((?:[0-9a-f]{12}[0-9a-z]{1,11})(?:,[0-9a-f]{12}[0-9a-z]{1,11})*)?$/;

export function encodeFeedCursor({ watermark, from, seen }: Cursor) {
    return `v1:${watermark.toString(36)}:${from === undefined ? '' : from.toString(36)}:${seen.map(([id, at]) => `${id}${at.toString(36)}`).join(',')}`;
}

/** A parsed cursor, or `null` when it is not one this server issued. */
export function decodeFeedCursor(value: string): Cursor | null {
    const match = value.length <= MAX_CURSOR_LENGTH ? cursorPattern.exec(value) : null;
    if (!match) return null;
    const watermark = parseInt(match[1]!, 36);
    const from = match[2] ? parseInt(match[2], 36) : undefined;
    const seen = match[3] ? match[3].split(',').map(entry => [entry.slice(0, 12), parseInt(entry.slice(12), 36)] as [string, number]) : [];
    if (!Number.isSafeInteger(watermark) || (from !== undefined && !Number.isSafeInteger(from)) || seen.length > MAX_SEEN
        || seen.some(([, at]) => !Number.isSafeInteger(at))) return null;
    return { watermark, from, seen };
}

export class InvalidFeedCursorError extends Error {
    constructor() { super('Use a cursor returned by this feed, or null to start from now.'); this.name = 'InvalidFeedCursorError'; }
}

export type FeedEvent = { eventId: string; name: McpEventName; timestamp: string; data: ReturnType<typeof mcpEventData> };
export type FeedPage = { events: FeedEvent[]; cursor: string; truncated: boolean; hasMore: boolean; nextPollMs: number;
    /** With `positions`: the position before the first event (after the replay limits), and the position after each event */
    start?: string; positions?: string[] };

export type FeedRequest = {
    identity: McpIdentity;
    project: DbProject;
    /** The connection owner's current member actor (from `mcpProject`) */
    actor: ProjectActor;
    names: readonly McpEventName[];
    args: Omit<McpEventArguments, 'projectId'>;
    /** `null` starts from now: no events, a cursor for the next poll */
    cursor: string | null;
    maxEvents: number;
    /** Do not replay events older than this */
    maxAgeMs?: number;
    /** Also return `start` and each event's own position (push delivery sends a cursor with every event) */
    positions?: boolean;
    baseUrl?: string;
    comments?: CommentsStore;
    now?: number;
};

function fresh(now: number, truncated: boolean, positions?: boolean): FeedPage {
    const cursor = encodeFeedCursor({ watermark: now - SETTLE_MS, from: now, seen: [] });
    return { events: [], cursor, truncated, hasMore: false, nextPollMs: NEXT_POLL_MS, ...(positions ? { start: cursor, positions: [] } : {}) };
}

/** A cursor that resumes after every event up to `watermark` (the form webhook subscriptions issue). */
export const watermarkCursor = (watermark: number) => encodeFeedCursor({ watermark: Math.max(0, Math.floor(watermark)), seen: [] });

/** Events after the cursor that the connection owner can see now, oldest first, at most `maxEvents`. */
export async function pollProjectEvents(request: FeedRequest): Promise<FeedPage> {
    const now = request.now ?? Date.now();
    if (request.cursor === null) return fresh(now, false, request.positions);
    const cursor = decodeFeedCursor(request.cursor);
    if (!cursor) throw new InvalidFeedCursorError();
    let truncated = false;
    let floor = cursor.watermark;
    if (floor < now - REPLAY_LIMIT_MS) { floor = now - REPLAY_LIMIT_MS; truncated = true; }
    if (request.maxAgeMs !== undefined && floor < now - request.maxAgeMs) { floor = now - request.maxAgeMs; truncated = true; }
    const seenBefore = cursor.seen.filter(([, at]) => at > floor);
    const changed = await (request.comments ?? getCommentsStore()).listChangedSince(projectPartition(request.project.id), floor - SETTLE_MS, MAX_THREADS);
    // Too much changed to read in one request: start again from now. The client re-reads state with tools.
    if (changed.length >= MAX_THREADS) return fresh(now, true, request.positions);

    const seen = new Set(seenBefore.map(([id]) => id));
    const candidates: { eventId: string; at: number; name: McpEventName; comment: DbComment; event: NotificationEvent }[] = [];
    for (const { comment } of changed) {
        if (!canSeeComment(comment, request.actor)) continue;
        for (const event of comment.notificationEvents ?? []) {
            const at = Date.parse(event.at);
            // Never echo the connection's own changes: an agent would loop on its replies.
            if (!(at > floor) || (cursor.from !== undefined && at < cursor.from) || event.agent?.credentialId === request.identity.connection.id) continue;
            for (const name of request.names) {
                if (!eventMatches(name, { projectId: request.project.id, ...request.args }, event, comment.id, request.identity.user.id)) continue;
                const eventId = mcpEventId(request.project.id, comment.id, event, name);
                if (!seen.has(shortId(eventId))) candidates.push({ eventId, at, name, comment, event });
            }
        }
    }
    // Time, then a thread's own activity order: events of one millisecond keep their thread's sequence.
    candidates.sort((a, b) => a.at - b.at || a.comment.id.localeCompare(b.comment.id) || a.event.sequence - b.event.sequence
        || a.eventId.localeCompare(b.eventId));
    const returned = candidates.slice(0, request.maxEvents);

    // The position after the first `count` candidates. The watermark advances to the settle line,
    // never past an event not returned yet.
    const position = (count: number) => {
        const next = candidates[count];
        let watermark = Math.max(floor, Math.min(now - SETTLE_MS, next ? next.at - 1 : Infinity));
        let kept = [...seenBefore, ...candidates.slice(0, count).map(entry => [shortId(entry.eventId), entry.at] as [string, number])]
            .filter(([, at]) => at > watermark).sort((a, b) => a[1] - b[1]);
        let skipped = false;
        if (kept.length > MAX_SEEN) {
            // A burst beyond the cursor's capacity: move the watermark past the oldest entries.
            watermark = kept[kept.length - MAX_SEEN - 1]![1];
            kept = kept.filter(([, at]) => at > watermark);
            if (next && next.at <= watermark) skipped = true;
        }
        const from = cursor.from !== undefined && cursor.from > watermark ? cursor.from : undefined;
        return { cursor: encodeFeedCursor({ watermark, from, seen: kept }), skipped };
    };
    const end = position(returned.length);
    if (end.skipped) truncated = true;
    const participants = returned.length ? await participantNames(request.project) : new Map<string, string>();
    return {
        events: returned.map(entry => ({ eventId: entry.eventId, name: entry.name, timestamp: entry.event.at,
            data: mcpEventData(entry.name, request.project, entry.comment, entry.event, participants, request.baseUrl) })),
        cursor: end.cursor, truncated, hasMore: candidates.length > returned.length, nextPollMs: NEXT_POLL_MS,
        ...(request.positions ? { start: encodeFeedCursor({ watermark: floor, from: cursor.from !== undefined && cursor.from > floor ? cursor.from : undefined, seen: seenBefore }),
            positions: returned.map((_, index) => position(index + 1).cursor) } : {})
    };
}
