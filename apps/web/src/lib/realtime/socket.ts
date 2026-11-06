import type { WebSocket, RawData } from 'ws';
import { getCommentsStore } from '../repo/commentsStore';
import { canSeeComment } from '../review/comments';
import { isVisible } from '../comments/visibility';
import { actorAuthorId } from '../review/actor';
import { authorizeRealtime, readRealtimeTicket, type RealtimeClaims } from './tickets';
import { createRealtimeSources, REALTIME_INTERVAL_MS, visibleRevision, type RealtimeSource } from './source';

const sourceFor = createRealtimeSources(domain => getCommentsStore().listRealtime(domain));

/** Vercel and the local test bridge use the same authenticated socket session. */
export function acceptRealtimeSocket(socket: WebSocket, origin: string, apiOrigin: string) {
    let ended = false;
    let started = false;
    let source: RealtimeSource | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (code = 1000) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearTimeout(lifetime);
        source?.release();
        socket.close(code);
    };
    const lifetime = setTimeout(() => finish(1012), 240_000);
    timer = setTimeout(() => finish(1008), 5_000);
    socket.on('close', () => finish());
    socket.on('error', () => finish(1011));
    // Reads are the only protocol operation. Clients cannot write comments or choose partitions.
    socket.on('message', (data: RawData, binary: boolean) => {
        if (ended) return;
        if (started || binary || data.toString().length > 2048) { finish(1008); return; }
        started = true;
        clearTimeout(timer);
        let claims: (RealtimeClaims & { exp: number }) | null;
        try {
            const frame = JSON.parse(data.toString()) as { type?: unknown; token?: unknown } | null;
            claims = frame?.type === 'subscribe' && typeof frame.token === 'string'
                ? readRealtimeTicket(frame.token, origin, apiOrigin) : null;
        } catch { claims = null; }
        if (!claims) { finish(1008); return; }
        source = sourceFor(claims.domain);
        let revision: string | undefined;
        const poll = async () => {
            try {
                if (ended) return;
                if (claims.exp * 1000 <= Date.now()) { finish(1008); return; }
                // Authorization is current before every notification, even if the rows are shared.
                const actor = await authorizeRealtime(claims);
                const comments = await source!.read();
                if (ended) return;
                const next = visibleRevision(comments, comment => claims.audience === 'showcase'
                    ? isVisible(comment, { visitor: { authorId: actorAuthorId(actor) } }) : canSeeComment(comment, actor));
                if (revision === undefined || revision !== next) {
                    if (socket.bufferedAmount > 16_384) { finish(1013); return; }
                    socket.send(JSON.stringify({ type: revision === undefined ? 'ready' : 'comments.changed' }));
                    revision = next;
                }
                timer = setTimeout(() => { void poll(); }, REALTIME_INTERVAL_MS);
            } catch {
                // No identity, token, project, database payload or private thread in logs/frames.
                console.warn('[realtime] Subscription ended during authorization or storage read.');
                finish(1008);
            }
        };
        void poll();
    });
}
