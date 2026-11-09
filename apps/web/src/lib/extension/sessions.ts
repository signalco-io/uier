import { z } from 'zod';
import { getAppStore } from '../app/store';
import type { AppDoc } from '../app/model';
import { getUser } from '../app/users';
import { randomToken, sha256Hex, signToken, verifyToken } from '../app/tokens';
import { keyedHash } from '../comments/environment';
import { apiErrors } from '../comments/http';
import { consume, APP_COUNTERS_PARTITION } from '../comments/rateLimits';
import { getCommentsStore } from '../repo/commentsStore';
import { extensionClient, extensionClientIdPattern, extensionClientIds, extensionClientOrigin } from './config';

export const extensionAccessSeconds = 15 * 60;
export const extensionIdleSeconds = 30 * 24 * 60 * 60;
export const extensionAbsoluteSeconds = 365 * 24 * 60 * 60;
export type SessionToken = { id: string; clientId: string; userId: string; extensionOrigin?: string };
export type ExtensionSession = AppDoc & {
    type: 'extension-session'; userId: string; clientId: string; expiresAt: number; ttl: number;
    extensionOrigin?: string;
    // Absent on legacy eight-hour sessions, which cannot be refreshed.
    absoluteExpiresAt?: number; refreshHash?: string;
};
type Refresh = AppDoc & {
    type: 'extension-refresh-token'; userId: string; clientId: string; expiresAt: number;
    attemptHash?: string; successorHash?: string;
};
const refreshPattern = /^uier_ext_rt\.([a-f0-9]{64})\.[A-Za-z0-9_-]{43}$/;
const bearer = (request: Request) => request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
const refreshToken = (id: string, secret = randomToken()) => `uier_ext_rt.${id}.${secret}`;
const refreshDoc = (session: ExtensionSession, token: string): Refresh => ({
    type: 'extension-refresh-token', id: sha256Hex(token), pk: session.pk,
    userId: session.userId, clientId: session.clientId, expiresAt: session.expiresAt,
    ttl: Math.ceil((session.expiresAt - Date.now()) / 1000)
});
function credentials(session: ExtensionSession, refresh: string) {
    const seconds = Math.min(extensionAccessSeconds, Math.ceil((session.expiresAt - Date.now()) / 1000));
    return {
        token: signToken<SessionToken>('extension-session', { id: session.id, userId: session.userId, clientId: session.clientId, extensionOrigin: session.extensionOrigin }, seconds),
        expiresAt: Date.now() + seconds * 1000, refreshToken: refresh, refreshExpiresAt: session.expiresAt
    };
}

export async function createExtensionSession(userId: string, clientId: string, extensionOrigin?: string) {
    const id = sha256Hex(randomToken()), now = Date.now();
    const token = refreshToken(id);
    const session: ExtensionSession = {
        type: 'extension-session', id, pk: `extension-session:${id}`, userId, clientId, extensionOrigin,
        expiresAt: now + extensionIdleSeconds * 1000, absoluteExpiresAt: now + extensionAbsoluteSeconds * 1000,
        refreshHash: sha256Hex(token), ttl: extensionIdleSeconds
    };
    if (!await getAppStore().createAll([session, refreshDoc(session, token)])) throw apiErrors.signInRequired();
    return credentials(session, token);
}

export async function loadExtensionSession(value: SessionToken | null) {
    if (!value || !extensionClientIds().includes(value.clientId)) throw apiErrors.signInRequired();
    const session = (await getAppStore().get<ExtensionSession>(`extension-session:${value.id}`, value.id))?.doc;
    if (!session || session.type !== 'extension-session' || session.expiresAt <= Date.now()
        || (session.absoluteExpiresAt !== undefined && session.absoluteExpiresAt <= Date.now())
        || session.userId !== value.userId || session.clientId !== value.clientId || !await getUser(session.userId))
        throw apiErrors.signInRequired();
    const client = extensionClient(session.clientId);
    if (!client || !extensionClientOrigin(client, session.extensionOrigin)
        || ((client.browser !== 'chrome' || value.extensionOrigin !== undefined) && value.extensionOrigin !== session.extensionOrigin)) throw apiErrors.signInRequired();
    return session;
}
export async function extensionSession(request: Request) {
    return loadExtensionSession(verifyToken<SessionToken>('extension-session', bearer(request)));
}

const refreshSchema = z.object({
    clientId: z.string().regex(extensionClientIdPattern), refreshToken: z.string().regex(refreshPattern),
    extensionOrigin: z.string().max(256).optional(),
    attempt: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
}).strict();

/** The worker persists an attempt before sending. An exact retry recovers the same successor,
 * even after suspension or a lost response; a different attempt using a spent token revokes access.
 * Only hashes are stored. The successor is derived with a separate server-keyed purpose.
 */
export async function refreshExtensionSession(input: unknown) {
    const parsed = refreshSchema.safeParse(input);
    if (!parsed.success || !extensionClientIds().includes(parsed.data.clientId)) throw apiErrors.signInRequired();
    const { clientId, refreshToken: token, attempt } = parsed.data;
    const client = extensionClient(clientId)!;
    const extensionOrigin = extensionClientOrigin(client, parsed.data.extensionOrigin);
    if (!extensionOrigin) throw apiErrors.signInRequired();
    const id = refreshPattern.exec(token)![1]!, pk = `extension-session:${id}`, hash = sha256Hex(token);
    const store = getAppStore();
    await consume(getCommentsStore(), APP_COUNTERS_PARTITION, {
        key: `extension-refresh:${id}`, limit: 120, windowSeconds: 3600, reason: 'too_fast', message: 'Too many session renewals. Try again later.'
    });
    for (let retry = 0; retry < 3; retry++) {
        const retained = await store.get<Refresh>(pk, hash);
        const stored = await store.get<ExtensionSession>(pk, id);
        if (!retained || retained.doc.type !== 'extension-refresh-token' || retained.doc.clientId !== clientId
            || !stored || stored.doc.clientId !== clientId) throw apiErrors.signInRequired();
        const current = await loadExtensionSession({ id, clientId, userId: retained.doc.userId, extensionOrigin: stored.doc.extensionOrigin });
        if (!current.absoluteExpiresAt || retained.doc.expiresAt <= Date.now()) throw apiErrors.signInRequired();
        const nextToken = refreshToken(id, Buffer.from(keyedHash('extension-refresh-successor', `${token}\n${attempt}`), 'hex').toString('base64url'));
        if (retained.doc.attemptHash) {
            if (retained.doc.attemptHash !== sha256Hex(attempt)) {
                await store.delete(pk, id);
                throw apiErrors.signInRequired();
            }
            if (current.refreshHash !== retained.doc.successorHash) throw apiErrors.signInRequired();
            // Possession of the refresh credential rebinds the current extension origin;
            // old access/scoped claims stop matching.
            if (current.extensionOrigin !== extensionOrigin) {
                if (!await store.transact([{ kind: 'replace', doc: { ...current, extensionOrigin }, etag: stored.etag }])) continue;
                return credentials({ ...current, extensionOrigin }, nextToken);
            }
            return credentials(current, nextToken);
        }
        if (current.refreshHash !== hash) throw apiErrors.signInRequired();
        const expiresAt = Math.min(Date.now() + extensionIdleSeconds * 1000, current.absoluteExpiresAt);
        const updated: ExtensionSession = { ...current, extensionOrigin, expiresAt, refreshHash: sha256Hex(nextToken), ttl: Math.ceil((expiresAt - Date.now()) / 1000) };
        if (await store.transact([
            { kind: 'replace', doc: updated, etag: stored.etag },
            { kind: 'replace', doc: { ...retained.doc, attemptHash: sha256Hex(attempt), successorHash: updated.refreshHash,
                ttl: Math.ceil((retained.doc.expiresAt - Date.now()) / 1000) }, etag: retained.etag },
            { kind: 'create', doc: refreshDoc(updated, nextToken) }
        ])) return credentials(updated, nextToken);
    }
    throw apiErrors.signInRequired();
}

/** Logout accepts a known refresh credential so it works after access expiry or browser restart.
 * Refresh credentials are never accepted by any review or project endpoint.
 */
export async function revokeExtensionSession(request: Request) {
    const token = bearer(request), id = token && refreshPattern.exec(token)?.[1];
    if (!id) {
        const session = await extensionSession(request);
        await getAppStore().delete(session.pk, session.id);
        return;
    }
    const pk = `extension-session:${id}`;
    const retained = await getAppStore().get<Refresh>(pk, sha256Hex(token!));
    if (!retained || retained.doc.type !== 'extension-refresh-token' || !extensionClientIds().includes(retained.doc.clientId)) throw apiErrors.signInRequired();
    await getAppStore().delete(pk, id);
}
