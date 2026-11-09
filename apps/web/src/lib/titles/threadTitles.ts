import { afterResponse } from '../afterResponse';
import { withThreadHistory } from '../comments/history';
import { commentAnchor } from '../app/commentAnchor';
import { workspacePk, type DbProject, type DbWorkspace } from '../app/model';
import { getAppStore } from '../app/store';
import type { DbComment, DbCommentKind } from '../db/schema';
import { getCommentsStore, type CommentsStore } from '../repo/commentsStore';
import { AI_TITLE_MODEL, generateAiTitle, isAiTitleConfigured, type AiTitleInput, type AiTitleResult } from './generate';
import { AI_TITLE_CLEANUP, aiTitleSource, needsAiTitle } from './model';
import { aiTitlesEnabled } from './settings';
import type { AiTitleOutcome, AiTitleTrigger } from './telemetry';

/** Most threads one list render or change asks titles for; the rest wait for a later one */
export const AI_TITLE_BATCH = 10;
/** Titles made at once in one batch */
const CONCURRENCY = 3;
/** A batch stops starting calls after this, inside every route's platform limit */
const BATCH_BUDGET_MS = 25_000;
/**
 * A thread with its own expiry (the public project's: 90 days after its last change) gets a title
 * only this soon after a change, so writing one never restarts its retention by more than this.
 */
export const EXPIRING_THREAD_WINDOW_MS = 10 * 60_000;
/** After a declined or unusable answer, the same text is not tried again for a day (on this instance) */
const RETRY_AFTER_ANSWER_MS = 24 * 60 * 60_000;
/** After a timeout or an API failure, a few minutes */
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
/** An API failure pauses titles for listed threads on this instance, so an outage costs nothing per page view */
const PAUSE_AFTER_FAILURE_MS = 5 * 60_000;
const MAX_REMEMBERED = 5_000;
const MAX_WRITE_ATTEMPTS = 4;

type CommentRef = Pick<DbComment, 'domain' | 'id'>;
const keyOf = (comment: CommentRef) => `${comment.domain}\n${comment.id}`;

/**
 * Per server instance: what is being made, texts recently tried without a title and the pause after
 * an API failure. On globalThis: route and page bundles may hold separate copies of this module.
 */
type TitleState = { inFlight: Set<string>; tried: Map<string, { source: string; until: number }>; listedPausedUntil: number };
const stateKey = Symbol.for('uier.ai-titles.state');
const shared = globalThis as typeof globalThis & { [stateKey]?: TitleState };
const state = shared[stateKey] ??= { inFlight: new Set(), tried: new Map(), listedPausedUntil: 0 };
const { inFlight, tried } = state;

function remember(comment: CommentRef, source: string, outcome: AiTitleOutcome, now: number) {
    const transient = outcome === 'timeout' || outcome === 'provider_error';
    const key = keyOf(comment);
    tried.delete(key);
    if (tried.size >= MAX_REMEMBERED) tried.delete(tried.keys().next().value!);
    tried.set(key, { source, until: now + (transient ? RETRY_AFTER_FAILURE_MS : RETRY_AFTER_ANSWER_MS) });
    if (transient) state.listedPausedUntil = now + PAUSE_AFTER_FAILURE_MS;
}

function recentlyTried(comment: DbComment, now: number) {
    const entry = tried.get(keyOf(comment));
    const first = comment.thread?.items?.[0];
    return Boolean(entry && first && entry.source === aiTitleSource(first.text) && entry.until > now);
}

/** A thread that expires on its own, last changed too long ago to write to (see EXPIRING_THREAD_WINDOW_MS) */
function wouldExtendRetention(comment: DbComment, now: number) {
    if (!(typeof comment.ttl === 'number' && comment.ttl > 0)) return false;
    const changed = Date.parse(comment.updatedAt ?? comment.createdAt ?? '');
    return !Number.isFinite(changed) || now - changed > EXPIRING_THREAD_WINDOW_MS;
}

/** The project's setting with its workspace's: one point read */
export async function loadAiTitlesEnabled(project: Pick<DbProject, 'workspaceId' | 'aiTitles'>) {
    const workspace = (await getAppStore().get<DbWorkspace>(workspacePk(project.workspaceId), project.workspaceId))?.doc;
    return aiTitlesEnabled(workspace, project);
}

export type AiTitleWrite = 'written' | 'current' | 'gone' | 'stale' | 'conflict' | Exclude<AiTitleOutcome, 'success'>;

function titleInput(comment: DbComment): AiTitleInput {
    const first = comment.thread.items[0]!;
    const kind: DbCommentKind = comment.kind ?? 'comment';
    const anchor = commentAnchor(comment.position, kind, first.quotedText);
    return { text: first.text, kind, leftOn: anchor.label, selectedText: anchor.type === 'text' ? anchor.text : undefined };
}

/**
 * Makes and stores the title of one thread from its first message, as it is now. Stores nothing when
 * the thread already has a current title, its first message is deleted, or the model gives no usable
 * title. The write keeps everything else (no `updatedAt`, activity, sync or notification change) and
 * is dropped when the first message changed meanwhile.
 */
export async function makeAiTitle(ref: CommentRef, trigger: AiTitleTrigger, options: {
    service?: (input: AiTitleInput, trigger: AiTitleTrigger) => Promise<AiTitleResult>;
    store?: CommentsStore;
    now?: () => number;
} = {}): Promise<AiTitleWrite> {
    const store = options.store ?? getCommentsStore();
    const now = options.now ?? Date.now;
    const stored = await store.get(ref.domain, ref.id);
    if (!stored) return 'gone';
    if (!needsAiTitle(stored.comment)) return 'current';
    const source = aiTitleSource(stored.comment.thread.items[0]!.text);
    const result = await (options.service ?? generateAiTitle)(titleInput(stored.comment), trigger);
    if (!result.title) {
        remember(ref, source, result.outcome, now());
        return result.outcome as Exclude<AiTitleOutcome, 'success'>;
    }

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const current = attempt === 0 ? stored : await store.get(ref.domain, ref.id);
        if (!current) return 'gone';
        const first = current.comment.thread?.items?.[0];
        if (!first || first.deletedAt || aiTitleSource(first.text) !== source) return 'stale';
        // A member gave it a title meanwhile, or a concurrent title job won while this one awaited the model or ETag
        if (!needsAiTitle(current.comment)) return 'stale';
        const at = new Date(now()).toISOString();
        const write = await store.replace(withThreadHistory(current.comment, { ...current.comment,
            aiTitle: { text: result.title, source, model: AI_TITLE_MODEL, generatedAt: at, cleanup: AI_TITLE_CLEANUP } }, 'system:ai-title', at), current.etag);
        if (write === 'ok') return 'written';
        if (write === 'not_found') return 'gone';
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 25));
    }
    return 'conflict';
}

async function inPool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
        while (next < items.length) await work(items[next++]!);
    }));
}

/**
 * The project threads, in the given order and at most {@link AI_TITLE_BATCH}, that need a title now:
 * not being made or just tried on this instance, and not expiring threads last changed too long ago.
 */
export function aiTitleCandidates(comments: readonly DbComment[], now = Date.now()) {
    const picked: DbComment[] = [];
    for (const comment of comments) {
        if (picked.length >= AI_TITLE_BATCH) break;
        if (!comment?.projectId || inFlight.has(keyOf(comment)) || !needsAiTitle(comment)
            || wouldExtendRetention(comment, now) || recentlyTried(comment, now)) continue;
        picked.push(comment);
    }
    return picked;
}

/**
 * Asks for titles of threads that have none for their first message, once the response is sent:
 * a new thread, a changed one (an edit of the first message makes a new title) or, bounded to
 * {@link AI_TITLE_BATCH} per call, threads a list showed. Nothing happens without an API key, with
 * titles off for the project, outside a request (API specs, the scheduled worker) or for a thread
 * that is being made, was just tried, or would have its expiry restarted. Returns how many it queued.
 */
export function queueAiTitles(project: Pick<DbProject, 'workspaceId' | 'aiTitles'>, comments: readonly DbComment[], trigger: AiTitleTrigger,
    options: { enabled?: boolean } = {}) {
    if (options.enabled === false || !isAiTitleConfigured()) return 0;
    if (trigger === 'shown' && state.listedPausedUntil > Date.now()) return 0;
    const picked = aiTitleCandidates(comments);
    if (!picked.length) return 0;
    const keys = picked.map(keyOf);
    for (const key of keys) inFlight.add(key);
    const release = () => { for (const key of keys) inFlight.delete(key); };
    const scheduled = afterResponse(async () => {
        try {
            const enabled = options.enabled ?? await loadAiTitlesEnabled(project).catch(() => false);
            if (!enabled) return;
            const deadline = Date.now() + BATCH_BUDGET_MS;
            await inPool(picked, CONCURRENCY, async comment => {
                if (Date.now() > deadline || (trigger === 'shown' && state.listedPausedUntil > Date.now())) return;
                try {
                    await makeAiTitle(comment, trigger);
                } catch (error) {
                    // No identifiers, text or payloads in logs. The thread keeps its first line.
                    console.warn(`[ai-titles] A title was not saved (${error instanceof Error ? error.name : 'Error'}).`);
                }
            });
        } finally {
            release();
        }
    });
    if (!scheduled) release();
    return scheduled ? picked.length : 0;
}
